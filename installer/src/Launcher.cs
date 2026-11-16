using System;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

// City Square POS launcher.
//
// Usage:
//   CitySquarePOS.exe staff            start services, open the staff login
//   CitySquarePOS.exe waiter           start services, open the waiter PIN login
//   CitySquarePOS.exe staff --no-browser
//   CitySquarePOS.exe stop             stop the app server and database
//   CitySquarePOS.exe uninstall        remove shortcuts, registry entry and files
//
// The two apps installed on the desktop are shortcuts to this same launcher
// with the "staff" and "waiter" arguments.
static class Program
{
    private static readonly string Root =
        AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);

    private static string appPort = "3000";
    private static string dbPort = "55432";
    private static string dbUser = "citysquare";
    private static string dbPassword = "citysquare";
    private static string dbName = "citysquare";
    private static string jwtSecret = "";
    private static bool quiet = false;
    // Empty when this PC is the main server. Set on terminal installs; the
    // launcher then uses the server over LAN/Wi-Fi instead of starting a
    // local database and backend.
    private static string serverUrl = "";
    // The main server serves HTTPS with a self-signed certificate stored in
    // data\tls. Terminals keep the server's public certificate next to it.
    private static bool tlsEnabled = false;
    private static string tlsPfxPath = "";
    private static string tlsPfxPassword = "";
    private static string tlsCertPublic = "";
    private static string redirectPort = "";
    private static string trustedThumbprint = "";

    private static string DataDir { get { return Path.Combine(Root, "data", "pgdata"); } }
    private static string LogsDir { get { return Path.Combine(Root, "logs"); } }
    private static string BackendDir { get { return Path.Combine(Root, "app", "backend"); } }
    private static string FrontendDir { get { return Path.Combine(Root, "app", "frontend", "dist"); } }
    private static string NodeExe { get { return Path.Combine(Root, "runtime", "node", "node.exe"); } }
    private static string PgCtl { get { return Path.Combine(Root, "runtime", "pgsql", "bin", "pg_ctl.exe"); } }

    private static string DbUrl
    {
        get
        {
            return "postgresql://" + dbUser + ":" + dbPassword + "@127.0.0.1:" + dbPort + "/" + dbName;
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        LoadConfig();
        InstallCertificatePolicy();
        string mode = args.Length > 0 ? args[0].ToLowerInvariant() : "staff";

        try
        {
            if (mode == "uninstall")
            {
                ForgetCertificate();
                Uninstall();
                return 0;
            }
            if (mode == "stop")
            {
                if (serverUrl.Length == 0)
                {
                    StopBackend();
                    StopPostgres();
                }
                return 0;
            }

            foreach (string arg in args)
            {
                if (arg.StartsWith("--server=", StringComparison.OrdinalIgnoreCase))
                {
                    serverUrl = arg.Substring("--server=".Length).Trim().TrimEnd('/');
                }
            }

            UpgradeLegacyServerUrl();

            bool openBrowser = Array.IndexOf(args, "--no-browser") < 0;
            quiet = !openBrowser;
            string path = mode == "waiter" ? "/w/login" : "/login";
            bool secure = tlsEnabled ||
                serverUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
            string scheme = secure ? "https" : "http";
            string baseUrl = serverUrl.Length > 0
                ? serverUrl
                : scheme + "://127.0.0.1:" + appPort;

            if (serverUrl.Length == 0)
            {
                if (!PortOpen(ParseInt(dbPort, 55432)))
                {
                    StartPostgres();
                }
                if (!HttpOk(baseUrl + "/api/health", 1500))
                {
                    StartBackend();
                }
            }
            if (!WaitHttp(baseUrl + "/api/health", serverUrl.Length > 0 ? 20000 : 45000))
            {
                if (serverUrl.Length > 0)
                {
                    Fail("Cannot reach the main server at " + serverUrl + ".\n\n" +
                        "Check that the main PC is switched on and on the same network, " +
                        "that the app is allowed through Windows Firewall on the main PC, " +
                        "and that the address is correct.\n\n" +
                        "If the browser reaches the server but this app does not, run " +
                        "Setup again on this PC so the server's HTTPS certificate is " +
                        "trusted.\n\n" +
                        "The address is stored in config.ini (server_url).");
                }
                else
                {
                    Fail("The server did not start.\n\nSee " + Path.Combine(LogsDir, "backend.log"));
                }
                return 1;
            }
            if (openBrowser)
            {
                LogLaunch("open " + baseUrl + path);
                OpenAppWindow(baseUrl + path);
            }
            else
            {
                LogLaunch("ready " + baseUrl + path + " (browser not opened)");
            }
            return 0;
        }
        catch (Exception ex)
        {
            Fail(ex.Message);
            return 1;
        }
    }

    private static void LoadConfig()
    {
        string file = Path.Combine(Root, "config.ini");
        if (File.Exists(file))
        {
            foreach (string raw in File.ReadAllLines(file))
            {
                string line = raw.Trim();
                int eq = line.IndexOf('=');
                if (eq <= 0) continue;
                string key = line.Substring(0, eq).Trim().ToLowerInvariant();
                string value = line.Substring(eq + 1).Trim();
                switch (key)
                {
                    case "app_port": appPort = value; break;
                    case "db_port": dbPort = value; break;
                    case "db_user": dbUser = value; break;
                    case "db_password": dbPassword = value; break;
                    case "db_name": dbName = value; break;
                    case "jwt_secret": jwtSecret = value; break;
                    case "server_url": serverUrl = value.TrimEnd('/'); break;
                    case "tls_enabled": tlsEnabled = value == "1" ||
                        value.Equals("true", StringComparison.OrdinalIgnoreCase); break;
                    case "tls_pfx": tlsPfxPath = value; break;
                    case "tls_pfx_password": tlsPfxPassword = value; break;
                    case "tls_cert_public": tlsCertPublic = value; break;
                    case "redirect_port": redirectPort = value; break;
                }
            }
        }

        if (tlsCertPublic.Length == 0)
        {
            string fallback = Path.Combine(Root, "data", "tls", "server.cer");
            if (File.Exists(fallback)) tlsCertPublic = fallback;
        }
        if (tlsCertPublic.Length > 0 && File.Exists(tlsCertPublic))
        {
            try
            {
                using (X509Certificate2 certificate = new X509Certificate2(tlsCertPublic))
                {
                    trustedThumbprint = certificate.Thumbprint;
                }
            }
            catch
            {
                trustedThumbprint = "";
            }
        }
    }

    private static void InstallCertificatePolicy()
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        ServicePointManager.ServerCertificateValidationCallback =
            delegate(object sender, X509Certificate certificate, X509Chain chain,
                SslPolicyErrors errors)
            {
                if (errors == SslPolicyErrors.None) return true;
                if (certificate == null) return false;
                if (trustedThumbprint.Length > 0)
                {
                    return string.Equals(certificate.GetCertHashString(),
                        trustedThumbprint, StringComparison.OrdinalIgnoreCase);
                }
                // No stored certificate yet (a terminal installed while the
                // server was unreachable). Accept the self-signed certificate
                // for this health probe on a local address; the browser still
                // enforces trust when it opens the app.
                try
                {
                    Uri uri = new Uri(serverUrl.Length > 0
                        ? serverUrl
                        : "http://127.0.0.1:" + appPort);
                    IPAddress address;
                    if (IPAddress.TryParse(uri.Host, out address))
                    {
                        return IPAddress.IsLoopback(address) || IsPrivate(address);
                    }
                    return true;
                }
                catch
                {
                    return false;
                }
            };
    }

    private static bool IsPrivate(IPAddress address)
    {
        byte[] bytes = address.GetAddressBytes();
        if (bytes.Length != 4) return address.IsIPv6LinkLocal;
        return bytes[0] == 10 ||
            (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
            (bytes[0] == 192 && bytes[1] == 168);
    }

    /** Terminals installed before HTTPS keep http:// in config.ini. */
    private static void UpgradeLegacyServerUrl()
    {
        if (serverUrl.Length == 0) return;
        if (!serverUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) return;
        string candidate = "https://" + serverUrl.Substring("http://".Length);
        if (WaitHttp(candidate + "/api/health", 8000))
        {
            LogLaunch("server upgraded to HTTPS: " + candidate);
            serverUrl = candidate;
            return;
        }
        LogLaunch("server did not answer over HTTPS; keeping " + serverUrl);
    }

    private static void ForgetCertificate()
    {
        string cer = tlsCertPublic.Length > 0
            ? tlsCertPublic
            : Path.Combine(Root, "data", "tls", "server.cer");
        if (!File.Exists(cer)) return;
        try
        {
            string thumbprint = trustedThumbprint;
            if (thumbprint.Length == 0)
            {
                using (X509Certificate2 certificate = new X509Certificate2(cer))
                {
                    thumbprint = certificate.Thumbprint;
                }
            }
            if (thumbprint.Length == 0) return;
            string output;
            Run(Path.Combine(Environment.SystemDirectory, "certutil.exe"),
                "-user -delstore Root " + thumbprint, null, 30000, out output);
            LogLaunch("certificate trust removed");
        }
        catch
        {
            // The certificate is public; leaving it behind is harmless.
        }
    }

    private static void StartPostgres()
    {
        if (!File.Exists(Path.Combine(DataDir, "PG_VERSION")))
        {
            throw new Exception("The database has not been initialised. Please run the installer again.");
        }
        Directory.CreateDirectory(LogsDir);
        string log = Path.Combine(LogsDir, "postgres.log");
        string args = "-D \"" + DataDir + "\" -l \"" + log + "\" -o \"-p " + dbPort + "\" -w start";
        string output;
        int code = Run(PgCtl, args, Root, 60000, out output);
        if (code != 0)
        {
            throw new Exception("Could not start the database.\n\n" + output);
        }
        WaitPort(ParseInt(dbPort, 55432), 15000);
    }

    private static void StopPostgres()
    {
        if (!File.Exists(Path.Combine(DataDir, "PG_VERSION"))) return;
        string output;
        Run(PgCtl, "-D \"" + DataDir + "\" -m fast -w stop", Root, 30000, out output);
    }

    private static void StartBackend()
    {
        if (!File.Exists(NodeExe))
        {
            throw new Exception("The bundled runtime is missing. Please run the installer again.");
        }
        if (!File.Exists(Path.Combine(BackendDir, "dist", "main.js")))
        {
            throw new Exception("The application files are missing. Please run the installer again.");
        }

        Directory.CreateDirectory(LogsDir);
        string logPath = Path.Combine(LogsDir, "backend.log");
        RotateLog(logPath);

        string mainJs = Path.Combine(BackendDir, "dist", "main.js");
        ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "cmd.exe"));
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WorkingDirectory = BackendDir;
        psi.Arguments = "/c \"\"" + NodeExe + "\" \"" + mainJs + "\" >> \"" + logPath + "\" 2>&1\"";
        psi.EnvironmentVariables["PORT"] = appPort;
        psi.EnvironmentVariables["DATABASE_URL"] = DbUrl;
        psi.EnvironmentVariables["NODE_ENV"] = "production";
        psi.EnvironmentVariables["FRONTEND_DIR"] = FrontendDir;
        psi.EnvironmentVariables["BACKUP_DIR"] = Path.Combine(Root, "data", "backups");
        psi.EnvironmentVariables["PG_BIN"] = Path.Combine(Root, "runtime", "pgsql", "bin");
        string corsScheme = tlsEnabled ? "https" : "http";
        psi.EnvironmentVariables["CORS_ORIGINS"] =
            corsScheme + "://127.0.0.1:" + appPort + "," +
            corsScheme + "://localhost:" + appPort;
        if (tlsEnabled)
        {
            psi.EnvironmentVariables["TLS_PFX_PATH"] = tlsPfxPath;
            psi.EnvironmentVariables["TLS_PFX_PASSPHRASE"] = tlsPfxPassword;
            psi.EnvironmentVariables["TLS_CERT_PUBLIC_PATH"] = tlsCertPublic;
            if (redirectPort.Length > 0)
            {
                psi.EnvironmentVariables["HTTP_REDIRECT_PORT"] = redirectPort;
            }
        }
        if (jwtSecret.Length > 0)
        {
            psi.EnvironmentVariables["JWT_SECRET"] = jwtSecret;
            psi.EnvironmentVariables["PIN_PEPPER"] = jwtSecret;
        }
        Process.Start(psi);
    }

    private static void StopBackend()
    {
        try
        {
            string marker = Path.Combine(Root, "app", "backend").ToLowerInvariant();
            using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'"))
            {
                foreach (ManagementObject process in searcher.Get())
                {
                    object commandLine = process["CommandLine"];
                    string text = commandLine == null ? "" : commandLine.ToString().ToLowerInvariant();
                    if (text.IndexOf(marker) < 0) continue;
                    try
                    {
                        Process.GetProcessById(Convert.ToInt32(process["ProcessId"])).Kill();
                    }
                    catch
                    {
                        // Already exited.
                    }
                }
            }
        }
        catch
        {
            // WMI unavailable — nothing else we can safely kill.
        }
    }

    private static void RotateLog(string path)
    {
        try
        {
            FileInfo info = new FileInfo(path);
            if (info.Exists && info.Length > 5 * 1024 * 1024)
            {
                string old = path + ".old";
                if (File.Exists(old)) File.Delete(old);
                File.Move(path, old);
            }
        }
        catch
        {
            // Log rotation is best effort.
        }
    }

    private static void OpenAppWindow(string url)
    {
        string[] candidates = new string[]
        {
            CombineProgramFiles(true, "Microsoft\\Edge\\Application\\msedge.exe"),
            CombineProgramFiles(false, "Microsoft\\Edge\\Application\\msedge.exe"),
            CombineProgramFiles(true, "Google\\Chrome\\Application\\chrome.exe"),
            CombineProgramFiles(false, "Google\\Chrome\\Application\\chrome.exe"),
        };

        foreach (string browser in candidates)
        {
            if (browser == null || !File.Exists(browser)) continue;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(browser);
                psi.UseShellExecute = false;
                psi.Arguments = "--app=" + url + " --window-size=1400,900";
                Process.Start(psi);
                return;
            }
            catch
            {
                // Try the next browser.
            }
        }

        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    private static string CombineProgramFiles(bool x86, string relative)
    {
        string baseDir = Environment.GetFolderPath(
            x86 ? Environment.SpecialFolder.ProgramFilesX86 : Environment.SpecialFolder.ProgramFiles);
        if (string.IsNullOrEmpty(baseDir)) return null;
        return Path.Combine(baseDir, relative);
    }

    private static void Uninstall()
    {
        StopBackend();
        StopPostgres();

        DeleteShortcut(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            "City Square POS (Staff)");
        DeleteShortcut(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            "City Square POS (Waiter)");

        string startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs), "City Square POS");
        try
        {
            if (Directory.Exists(startMenu)) Directory.Delete(startMenu, true);
        }
        catch
        {
            // Best effort.
        }

        try
        {
            Registry.CurrentUser.DeleteSubKeyTree(
                "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CitySquarePOS", false);
        }
        catch
        {
            // Best effort.
        }

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(
                Path.Combine(Environment.SystemDirectory, "cmd.exe"));
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.Arguments = "/c ping 127.0.0.1 -n 4 > nul & rmdir /s /q \"" + Root + "\"";
            Process.Start(psi);
        }
        catch
        {
            // If the folder cannot be removed the user can delete it manually.
        }

        MessageBox.Show("City Square POS has been removed.", "City Square POS",
            MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private static void DeleteShortcut(string folder, string name)
    {
        try
        {
            string path = Path.Combine(folder, name + ".lnk");
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // Best effort.
        }
    }

    private static bool PortOpen(int port)
    {
        try
        {
            using (TcpClient client = new TcpClient())
            {
                IAsyncResult result = client.BeginConnect("127.0.0.1", port, null, null);
                if (!result.AsyncWaitHandle.WaitOne(500)) return false;
                client.EndConnect(result);
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    private static bool WaitPort(int port, int timeoutMs)
    {
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            if (PortOpen(port)) return true;
            Thread.Sleep(300);
        }
        return false;
    }

    private static bool HttpOk(string url, int timeoutMs)
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.Timeout = timeoutMs;
            request.Proxy = null;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                return (int)response.StatusCode >= 200 && (int)response.StatusCode < 300;
            }
        }
        catch
        {
            return false;
        }
    }

    private static bool WaitHttp(string url, int timeoutMs)
    {
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            if (HttpOk(url, 1500)) return true;
            Thread.Sleep(500);
        }
        return false;
    }

    private static int Run(string exe, string args, string workingDir, int timeoutMs, out string output)
    {
        ProcessStartInfo psi = new ProcessStartInfo(exe, args);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        if (workingDir != null) psi.WorkingDirectory = workingDir;

        using (Process process = Process.Start(psi))
        {
            StringBuilder text = new StringBuilder();
            DataReceivedEventHandler sink = delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null)
                {
                    lock (text) text.AppendLine(e.Data);
                }
            };
            process.OutputDataReceived += sink;
            process.ErrorDataReceived += sink;
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            if (!process.WaitForExit(timeoutMs))
            {
                try { process.Kill(); } catch { }
                output = "Timed out.";
                return -1;
            }
            output = text.ToString();
            return process.ExitCode;
        }
    }

    private static int ParseInt(string value, int fallback)
    {
        int parsed;
        return int.TryParse(value, out parsed) ? parsed : fallback;
    }

    private static void LogLaunch(string message)
    {
        try
        {
            Directory.CreateDirectory(LogsDir);
            File.AppendAllText(Path.Combine(LogsDir, "launcher.log"),
                DateTime.Now.ToString() + " " + message + "\r\n");
        }
        catch
        {
            // Diagnostics must never block the launch.
        }
    }

    private static void Fail(string message)
    {
        if (quiet)
        {
            try
            {
                Directory.CreateDirectory(LogsDir);
                File.AppendAllText(Path.Combine(LogsDir, "launcher.log"),
                    DateTime.Now.ToString() + " " + message.Replace("\n", " ") + "\r\n");
            }
            catch
            {
                // Nothing else we can do.
            }
            return;
        }
        MessageBox.Show(message, "City Square POS", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
