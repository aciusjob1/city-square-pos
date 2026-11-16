using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

// City Square POS setup.
//
// The installer carries a zip payload appended to its own executable.
// Installing copies the app, bundled Node runtime and PostgreSQL into
// %LOCALAPPDATA%\Programs\CitySquarePOS, initialises the database, then
// creates two desktop apps:
//   - City Square POS (Staff)  -> /login
//   - City Square POS (Waiter) -> /w/login
//
// Silent usage:
//   CitySquarePOS-Setup.exe /S /DIR="C:\path" /PORT=3010 /DBPORT=55433
//   CitySquarePOS-Setup.exe /S /SERVER=192.168.1.20:3000      (terminal install)
static class SetupProgram
{
    public const string Version = "1.0.0";
    public const string Publisher = "Acius Job Missingo";

    private static string installDir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "CitySquarePOS");
    private static string appPort = "3000";
    private static string dbPort = "55432";
    private static string dbUser = "citysquare";
    private static string dbPassword = "citysquare";
    private static string dbName = "citysquare";
    private static string jwtSecret = "";
    private static bool silent = false;
    private static bool createShortcuts = true;
    private static bool writeRegistry = true;
    private static string launchMode = "none";
    private static bool appPortExplicit = false;
    private static bool dbPortExplicit = false;
    // Empty means this PC hosts the server. Non-empty means this PC is a
    // terminal that connects to the main server over LAN/Wi-Fi.
    private static string serverUrl = "";
    private static bool serverUrlExplicit = false;
    // The server PC stores a self-signed certificate and serves HTTPS on
    // app_port; terminals just point at its https:// address.
    private static bool tlsEnabled = true;
    private static string tlsPfxPath = "";
    private static string tlsPfxPassword = "";
    private static string tlsCertPath = "";
    private static string redirectPort = "";

    private static string SetupLog
    {
        get { return Path.Combine(Path.GetTempPath(), "city-square-pos-setup.log"); }
    }

    private static void Log(string message)
    {
        try
        {
            File.AppendAllText(SetupLog, DateTime.Now.ToString("HH:mm:ss.fff") + " " + message + "\r\n");
        }
        catch
        {
            // Logging must never break the install.
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Log("start: " + string.Join(" ", args));
        try
        {
            ParseArgs(args);
            ReuseExistingSecret();
            if (silent)
            {
                RunInstall(null);
                return 0;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
            return 0;
        }
        catch (Exception ex)
        {
            Log("failed: " + ex);
            string log = Path.Combine(Path.GetTempPath(), "city-square-pos-setup.log");
            try
            {
                File.WriteAllText(log, DateTime.Now.ToString() + "\r\n" + ex.ToString());
            }
            catch
            {
                // Ignore logging failures.
            }
            if (!silent)
            {
                MessageBox.Show("Installation failed.\r\n\r\n" + ex.Message,
                    "City Square POS Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            return 1;
        }
    }

    private static void ParseArgs(string[] args)
    {
        foreach (string raw in args)
        {
            if (raw == null) continue;
            string arg = raw.Trim();
            string upper = arg.ToUpperInvariant();
            if (upper == "/S" || upper == "/SILENT" || upper == "-SILENT")
            {
                silent = true;
            }
            else if (upper == "/NOSHORTCUTS")
            {
                createShortcuts = false;
            }
            else if (upper == "/NOREG")
            {
                writeRegistry = false;
            }
            else if (upper.StartsWith("/DIR="))
            {
                installDir = arg.Substring(5).Trim('"');
            }
            else if (upper.StartsWith("/PORT="))
            {
                appPort = arg.Substring(6).Trim('"');
                appPortExplicit = true;
            }
            else if (upper.StartsWith("/DBPORT="))
            {
                dbPort = arg.Substring(8).Trim('"');
                dbPortExplicit = true;
            }
            else if (upper.StartsWith("/LAUNCH="))
            {
                launchMode = arg.Substring(8).Trim('"').ToLowerInvariant();
            }
            else if (upper.StartsWith("/SERVER="))
            {
                string value = arg.Substring(8).Trim('"').Trim();
                serverUrl = value.Length == 0 ? "" : NormalizeServerUrl(value);
                serverUrlExplicit = true;
            }
        }
        installDir = Path.GetFullPath(installDir);
    }

    public static bool IsTerminal
    {
        get { return serverUrl.Length > 0; }
    }

    public static string ServerUrl
    {
        get { return serverUrl; }
    }

    /// <summary>
    /// Accepts "192.168.1.20", "192.168.1.20:3000" or "https://192.168.1.20:3000"
    /// and returns a canonical URL without a trailing slash. A bare address
    /// becomes https:// — type http:// only for an older server without TLS.
    /// </summary>
    private static string NormalizeServerUrl(string raw)
    {
        string value = raw.Trim().TrimEnd('/');
        if (value.IndexOf(' ') >= 0)
        {
            throw new Exception("The main server address must not contain spaces.");
        }
        if (value.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            value.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            // Keep as typed.
        }
        else
        {
            value = "https://" + value;
        }

        Uri parsed;
        if (!Uri.TryCreate(value, UriKind.Absolute, out parsed) ||
            (parsed.Scheme != "http" && parsed.Scheme != "https") ||
            parsed.Host.Length == 0)
        {
            throw new Exception("Enter the main server address, for example 192.168.1.20:3000.");
        }
        if (parsed.IsDefaultPort)
        {
            throw new Exception("Include the port number, for example 192.168.1.20:3000. " +
                "The server PC shows its exact address after installation.");
        }
        return value.TrimEnd('/');
    }

    /// <summary>LAN address of this PC, used to tell the owner what to type on terminals.</summary>
    public static string PrimaryLanAddress()
    {
        try
        {
            foreach (NetworkInterface nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                foreach (UnicastIPAddressInformation ip in nic.GetIPProperties().UnicastAddresses)
                {
                    if (ip.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    string text = ip.Address.ToString();
                    if (text.StartsWith("169.254.")) continue;
                    return text;
                }
            }
        }
        catch
        {
            // Fall through to localhost when the network stack is unavailable.
        }
        return "127.0.0.1";
    }

    public static string ServerAddressHint()
    {
        return (tlsEnabled ? "https://" : "http://") + PrimaryLanAddress() + ":" + appPort;
    }

    /** Every LAN address this PC currently has, primary first. */
    private static List<string> LanAddresses()
    {
        List<string> result = new List<string>();
        string primary = PrimaryLanAddress();
        if (primary != "127.0.0.1") result.Add(primary);
        try
        {
            foreach (NetworkInterface nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                foreach (UnicastIPAddressInformation ip in nic.GetIPProperties().UnicastAddresses)
                {
                    if (ip.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    string text = ip.Address.ToString();
                    if (text.StartsWith("169.254.")) continue;
                    if (!result.Contains(text)) result.Add(text);
                }
            }
        }
        catch
        {
            // PrimaryLanAddress already covers the common case.
        }
        return result;
    }

    private static void ReuseExistingSecret()
    {
        // Upgrades must keep the signing secret: changing it invalidates
        // sessions and, through PIN_PEPPER, every waiter PIN.
        string config = Path.Combine(installDir, "config.ini");
        if (!File.Exists(config)) return;
        foreach (string raw in File.ReadAllLines(config))
        {
            string line = raw.Trim();
            if (line.StartsWith("jwt_secret=", StringComparison.OrdinalIgnoreCase))
            {
                string secret = line.Substring("jwt_secret=".Length).Trim();
                if (secret.Length >= 32) jwtSecret = secret;
            }
            else if (!serverUrlExplicit &&
                line.StartsWith("server_url=", StringComparison.OrdinalIgnoreCase))
            {
                string value = line.Substring("server_url=".Length).Trim();
                if (value.Length > 0) serverUrl = NormalizeServerUrl(value);
            }
        }
    }

    private static void ReuseExistingTls()
    {
        // Upgrades keep the certificate, so devices that already trust it do
        // not have to install a new one.
        string config = Path.Combine(installDir, "config.ini");
        if (!File.Exists(config)) return;
        string pfx = "";
        string pass = "";
        string cer = "";
        foreach (string raw in File.ReadAllLines(config))
        {
            string line = raw.Trim();
            int eq = line.IndexOf('=');
            if (eq <= 0) continue;
            string key = line.Substring(0, eq).Trim().ToLowerInvariant();
            string value = line.Substring(eq + 1).Trim();
            if (key == "tls_pfx") pfx = value;
            else if (key == "tls_pfx_password") pass = value;
            else if (key == "tls_cert_public") cer = value;
        }
        if (pfx.Length == 0 || pass.Length == 0 || cer.Length == 0) return;
        if (!File.Exists(pfx) || !File.Exists(cer)) return;
        tlsPfxPath = pfx;
        tlsPfxPassword = pass;
        tlsCertPath = cer;
        tlsEnabled = true;
    }

    private static void EnsureTlsCertificate()
    {
        try
        {
            string dir = Path.Combine(installDir, "data", "tls");
            string pfx = Path.Combine(dir, "citysquare.pfx");
            string cer = Path.Combine(dir, "citysquare.cer");
            Directory.CreateDirectory(dir);

            if (tlsEnabled && tlsPfxPassword.Length > 0 &&
                File.Exists(pfx) && File.Exists(cer))
            {
                tlsPfxPath = pfx;
                tlsCertPath = cer;
                TrustCertificate(cer);
                Log("reusing existing TLS certificate");
                return;
            }

            try
            {
                if (File.Exists(pfx)) File.Delete(pfx);
                if (File.Exists(cer)) File.Delete(cer);
            }
            catch
            {
                // Export below overwrites in place when the delete is refused.
            }

            string password = RandomSecret().Substring(0, 40);
            string scriptPath = Path.Combine(Path.GetTempPath(), "city-square-pos-cert.ps1");
            File.WriteAllText(scriptPath, BuildCertificateScript(pfx, cer, password),
                new UTF8Encoding(false));
            string output;
            int code = Run(PowerShellPath(),
                "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + scriptPath + "\"",
                null, null, 120000, out output);
            try { File.Delete(scriptPath); } catch { }
            Log("certificate script exit=" + code + " " + output.Trim());

            if (code != 0 || !File.Exists(pfx) || !File.Exists(cer))
            {
                tlsEnabled = false;
                Log("TLS certificate generation failed; continuing over HTTP");
                return;
            }

            tlsPfxPath = pfx;
            tlsPfxPassword = password;
            tlsCertPath = cer;
            tlsEnabled = true;
            TrustCertificate(cer);
        }
        catch (Exception ex)
        {
            tlsEnabled = false;
            Log("TLS setup failed: " + ex.Message);
        }
    }

    private static string BuildCertificateScript(string pfx, string cer, string password)
    {
        List<string> names = new List<string>();
        names.Add("DNS=localhost");
        if (Environment.MachineName.Length > 0) names.Add("DNS=" + Environment.MachineName);
        names.Add("IPAddress=127.0.0.1");
        foreach (string ip in LanAddresses()) names.Add("IPAddress=" + ip);
        string san = string.Join("&", names.ToArray());

        StringBuilder script = new StringBuilder();
        script.AppendLine("$ErrorActionPreference = 'Stop'");
        script.AppendLine("$cert = New-SelfSignedCertificate -Type Custom -Subject " +
            PsQuote("CN=City Square POS") +
            " -CertStoreLocation 'Cert:\\CurrentUser\\My' -KeyAlgorithm RSA -KeyLength 2048" +
            " -HashAlgorithm SHA256 -KeyExportPolicy Exportable" +
            " -KeyUsage DigitalSignature,KeyEncipherment" +
            " -TextExtension @('2.5.29.17={text}" + san + "','2.5.29.37={text}1.3.6.1.5.5.7.3.1')" +
            " -NotAfter (Get-Date).AddYears(10)");
        script.AppendLine("$password = ConvertTo-SecureString -String " + PsQuote(password) +
            " -Force -AsPlainText");
        script.AppendLine("Export-PfxCertificate -Cert $cert -FilePath " + PsQuote(pfx) +
            " -Password $password | Out-Null");
        script.AppendLine("Export-Certificate -Cert $cert -FilePath " + PsQuote(cer) +
            " -Type CERT | Out-Null");
        script.AppendLine("Remove-Item -Path ('Cert:\\CurrentUser\\My\\' + $cert.Thumbprint)" +
            " -Force -ErrorAction SilentlyContinue");
        return script.ToString();
    }

    private static string PsQuote(string value)
    {
        return "'" + value.Replace("'", "''") + "'";
    }

    private static string PowerShellPath()
    {
        string path = Path.Combine(Environment.SystemDirectory,
            "WindowsPowerShell", "v1.0", "powershell.exe");
        return File.Exists(path) ? path : "powershell.exe";
    }

    /** Current user's Trusted Root store; browsers on this PC then accept the cert. */
    private static void TrustCertificate(string cerPath)
    {
        try
        {
            string output;
            int code = Run(Path.Combine(Environment.SystemDirectory, "certutil.exe"),
                "-user -f -addstore Root \"" + cerPath + "\"", null, null, 60000, out output);
            Log("certificate trust exit=" + code + " " + output.Trim());
        }
        catch (Exception ex)
        {
            Log("certificate trust failed: " + ex.Message);
        }
    }

    /** Terminal installs pull the server's public certificate and trust it. */
    private static void FetchServerCertificate()
    {
        if (!serverUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return;
        string target = Path.Combine(installDir, "data", "tls", "server.cer");
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            if (File.Exists(target)) File.Delete(target);

            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            ServicePointManager.ServerCertificateValidationCallback =
                delegate(object sender, X509Certificate certificate, X509Chain chain,
                    SslPolicyErrors errors) { return true; };

            using (WebClient client = new WebClient())
            {
                client.Proxy = null;
                client.DownloadFile(serverUrl + "/api/tls/certificate", target);
            }

            using (X509Certificate2 probe = new X509Certificate2(target))
            {
                Log("server certificate stored (" + probe.Thumbprint + ")");
            }
            TrustCertificate(target);
        }
        catch (Exception ex)
        {
            Log("server certificate fetch skipped: " + ex.Message);
            try { if (File.Exists(target)) File.Delete(target); } catch { }
        }
        finally
        {
            ServicePointManager.ServerCertificateValidationCallback = null;
        }
    }

    public static void RunInstall(Action<string, int> progress)
    {
        Log("install dir=" + installDir + " appPort=" + appPort + " dbPort=" + dbPort +
            " shortcuts=" + createShortcuts + " registry=" + writeRegistry + " launch=" + launchMode +
            " server=" + (IsTerminal ? serverUrl : "(this PC)"));
        if (jwtSecret.Length == 0)
        {
            jwtSecret = RandomSecret();
        }

        Report(progress, "Preparing installation folder…", 2);
        Directory.CreateDirectory(installDir);

        Report(progress, "Closing a running copy…", 4);
        StopExistingInstall();

        Report(progress, "Extracting City Square POS…", 6);
        ExtractPayload(installDir, progress);
        Log("payload extracted");

        Report(progress, "Checking the bundled runtime…", 47);
        VerifyPayload();

        if (IsTerminal)
        {
            // Terminals keep no database and start no local services; they use
            // the main server over LAN/Wi-Fi.
            Report(progress, "Writing configuration…", 48);
            WriteConfig();
            Report(progress, "Fetching the server certificate…", 49);
            FetchServerCertificate();
            Log("terminal configuration written (server " + serverUrl + ")");
        }
        else
        {
            ChoosePorts();
            ReuseExistingTls();

            Report(progress, "Securing the connection…", 48);
            EnsureTlsCertificate();
            if (tlsEnabled) ChooseRedirectPort();

            Report(progress, "Writing configuration…", 50);
            WriteConfig();
            WriteBackendEnv();
            Log("configuration written (tls=" + tlsEnabled + " redirect=" + redirectPort + ")");

            Report(progress, "Initialising the database…", 54);
            EnsureDatabase(progress);
            Log("database ready");

            Report(progress, "Allowing terminals through the firewall…", 88);
            OpenFirewallPort();
        }

        Report(progress, "Creating apps and shortcuts…", 90);
        if (createShortcuts) CreateShortcuts();
        if (writeRegistry) RegisterUninstaller();
        Log("shortcuts/registry done");

        Report(progress, "Finished", 100);

        if (launchMode == "staff" || launchMode == "waiter")
        {
            Process.Start(Path.Combine(installDir, "CitySquarePOS.exe"), launchMode);
        }
    }

    private static void Report(Action<string, int> progress, string message, int percent)
    {
        if (progress != null) progress(message, percent);
    }

    private static string LauncherPath
    {
        get { return Path.Combine(installDir, "CitySquarePOS.exe"); }
    }

    private static string DataDir
    {
        get { return Path.Combine(installDir, "data", "pgdata"); }
    }

    private static string PgBin
    {
        get { return Path.Combine(installDir, "runtime", "pgsql", "bin"); }
    }

    private static string NodeExe
    {
        get { return Path.Combine(installDir, "runtime", "node", "node.exe"); }
    }

    private static string BackendDir
    {
        get { return Path.Combine(installDir, "app", "backend"); }
    }

    private static string DbUrl
    {
        get
        {
            return "postgresql://" + dbUser + ":" + dbPassword + "@127.0.0.1:" + dbPort + "/" + dbName;
        }
    }

    private static void StopExistingInstall()
    {
        try
        {
            if (File.Exists(LauncherPath))
            {
                ProcessStartInfo psi = new ProcessStartInfo(LauncherPath, "stop");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                using (Process process = Process.Start(psi))
                {
                    process.WaitForExit(20000);
                }
            }
        }
        catch
        {
            // A stale install that cannot be stopped will fail later with a clear error.
        }
    }

    private static void VerifyPayload()
    {
        string[] required = new string[]
        {
            NodeExe,
            Path.Combine(PgBin, "initdb.exe"),
            Path.Combine(PgBin, "pg_ctl.exe"),
            Path.Combine(PgBin, "pg_dump.exe"),
            Path.Combine(PgBin, "vcruntime140.dll"),
            Path.Combine(PgBin, "msvcp140.dll"),
            Path.Combine(BackendDir, "dist", "main.js"),
            Path.Combine(installDir, "app", "frontend", "dist", "index.html"),
        };
        foreach (string file in required)
        {
            if (!File.Exists(file))
            {
                throw new Exception("The installer is incomplete; missing:\r\n" + file);
            }
        }
    }

    private static void ChoosePorts()
    {
        // A clean PC usually has 3000/55432 free. If not, move to the next
        // free port instead of failing the installation.
        if (!appPortExplicit)
        {
            int preferred = ToInt(appPort, 3000);
            int chosen = FindFreePort(preferred, preferred + 200);
            if (chosen != preferred) Log("app port " + preferred + " busy, using " + chosen);
            appPort = chosen.ToString();
        }
        if (!dbPortExplicit)
        {
            int preferred = ToInt(dbPort, 55432);
            int chosen = FindFreePort(preferred, preferred + 200);
            if (chosen != preferred) Log("db port " + preferred + " busy, using " + chosen);
            dbPort = chosen.ToString();
        }
    }

    private static void ChooseRedirectPort()
    {
        // Plain-http visitors to the old address are bounced to https. The
        // port stays out of the way of app and database ports.
        int app = ToInt(appPort, 3000);
        int db = ToInt(dbPort, 55432);
        int candidate = app <= 65400 ? app + 80 : 8443;
        for (int i = 0; i < 300; i++, candidate++)
        {
            if (candidate > 65500) candidate = 8080;
            if (candidate == app || candidate == db) continue;
            if (!PortOpen(candidate)) break;
        }
        redirectPort = candidate.ToString();
        Log("redirect port " + redirectPort);
    }

    private static int FindFreePort(int start, int limit)
    {
        for (int port = start; port <= limit; port++)
        {
            if (!PortOpen(port)) return port;
        }
        throw new Exception("No free TCP port was found between " + start + " and " + limit + ".");
    }

    private static void ExtractPayload(string destination, Action<string, int> progress)
    {
        string exePath = Application.ExecutablePath;
        long zipStart = FindZipStart(exePath);
        string root = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar)
            + Path.DirectorySeparatorChar;

        using (FileStream file = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            using (SubStream sub = new SubStream(file, zipStart, file.Length - zipStart))
            {
                using (ZipArchive archive = new ZipArchive(sub, ZipArchiveMode.Read))
                {
                    int total = archive.Entries.Count;
                    int index = 0;
                    string lastDir = null;
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        index++;
                        string target = Path.GetFullPath(
                            Path.Combine(destination, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                        if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new Exception("The installer payload contains an unsafe path.");
                        }

                        if (entry.FullName.EndsWith("/"))
                        {
                            Directory.CreateDirectory(target);
                        }
                        else
                        {
                            string directory = Path.GetDirectoryName(target);
                            if (directory != lastDir)
                            {
                                Directory.CreateDirectory(directory);
                                lastDir = directory;
                            }
                            entry.ExtractToFile(target, true);
                        }

                        if (total > 0 && index % 64 == 0)
                        {
                            Report(progress, "Extracting City Square POS…",
                                6 + (int)(42L * index / total));
                        }
                    }
                }
            }
        }
    }

    private static long FindZipStart(string exePath)
    {
        using (FileStream file = new FileStream(exePath, FileMode.Open, FileAccess.Read))
        {
            long length = file.Length;
            int tailLength = (int)Math.Min(66000, length);
            byte[] buffer = new byte[tailLength];
            file.Seek(length - tailLength, SeekOrigin.Begin);
            file.Read(buffer, 0, tailLength);

            for (int i = tailLength - 22; i >= 0; i--)
            {
                if (buffer[i] != 0x50 || buffer[i + 1] != 0x4b ||
                    buffer[i + 2] != 0x05 || buffer[i + 3] != 0x06)
                {
                    continue;
                }
                int centralSize = BitConverter.ToInt32(buffer, i + 12);
                int centralOffset = BitConverter.ToInt32(buffer, i + 16);
                long start = length - tailLength + i - centralSize - centralOffset;
                if (start > 0 && start < length) return start;
            }
        }
        throw new Exception("The installer payload is missing or damaged.");
    }

    private static void WriteConfig()
    {
        StringBuilder config = new StringBuilder();
        config.AppendLine("version=" + Version);
        config.AppendLine("app_port=" + appPort);
        config.AppendLine("db_port=" + dbPort);
        config.AppendLine("db_user=" + dbUser);
        config.AppendLine("db_password=" + dbPassword);
        config.AppendLine("db_name=" + dbName);
        config.AppendLine("jwt_secret=" + jwtSecret);
        config.AppendLine("server_url=" + serverUrl);
        config.AppendLine("tls_enabled=" + (tlsEnabled && !IsTerminal ? "1" : "0"));
        config.AppendLine("tls_pfx=" + tlsPfxPath);
        config.AppendLine("tls_pfx_password=" + tlsPfxPassword);
        config.AppendLine("tls_cert_public=" + tlsCertPath);
        config.AppendLine("redirect_port=" + (tlsEnabled ? redirectPort : ""));
        File.WriteAllText(Path.Combine(installDir, "config.ini"), config.ToString());
    }

    private static string CorsOrigins()
    {
        string scheme = tlsEnabled ? "https" : "http";
        return scheme + "://127.0.0.1:" + appPort + "," +
            scheme + "://localhost:" + appPort;
    }

    private static void OpenFirewallPort()
    {
        // Terminals reach this PC over LAN/Wi-Fi; without an inbound rule the
        // Windows firewall drops their requests. This needs administrator
        // rights, so failure is logged and the install still succeeds.
        OpenFirewallRule("City Square POS", appPort);
        if (tlsEnabled && redirectPort.Length > 0)
        {
            OpenFirewallRule("City Square POS (HTTP redirect)", redirectPort);
        }
    }

    private static void OpenFirewallRule(string name, string port)
    {
        try
        {
            string output;
            int code = Run(Path.Combine(Environment.SystemDirectory, "netsh.exe"),
                "advfirewall firewall add rule name=\"" + name + "\" " +
                "dir=in action=allow protocol=TCP localport=" + port,
                null, null, 30000, out output);
            Log("firewall rule port " + port + " exit=" + code + " " + output.Trim());
        }
        catch (Exception ex)
        {
            Log("firewall rule failed: " + ex.Message);
        }
    }

    private static void WriteBackendEnv()
    {
        string tls = tlsEnabled
            ? "TLS_PFX_PATH=" + tlsPfxPath + "\r\n" +
              "TLS_PFX_PASSPHRASE=" + tlsPfxPassword + "\r\n" +
              "TLS_CERT_PUBLIC_PATH=" + tlsCertPath + "\r\n" +
              "HTTP_REDIRECT_PORT=" + redirectPort + "\r\n"
            : "";
        string env =
            "DATABASE_URL=" + DbUrl + "\r\n" +
            "JWT_SECRET=" + jwtSecret + "\r\n" +
            "PIN_PEPPER=" + jwtSecret + "\r\n" +
            "JWT_EXPIRES_IN=12h\r\n" +
            "PORT=" + appPort + "\r\n" +
            "NODE_ENV=production\r\n" +
            "CORS_ORIGINS=" + CorsOrigins() + "\r\n" +
            tls +
            "FRONTEND_DIR=" + Path.Combine(installDir, "app", "frontend", "dist") + "\r\n" +
            "BACKUP_DIR=" + Path.Combine(installDir, "data", "backups") + "\r\n" +
            "PG_BIN=" + PgBin + "\r\n";
        File.WriteAllText(Path.Combine(BackendDir, ".env"), env);
    }

    private static void EnsureDatabase(Action<string, int> progress)
    {
        if (File.Exists(Path.Combine(DataDir, "PG_VERSION")))
        {
            return;
        }

        Directory.CreateDirectory(Path.Combine(installDir, "data"));
        Directory.CreateDirectory(Path.Combine(installDir, "logs"));
        string pgLog = Path.Combine(installDir, "logs", "postgres.log");
        string output;

        Report(progress, "Creating the database cluster…", 56);
        int code = Run(Path.Combine(PgBin, "initdb.exe"),
            "-D \"" + DataDir + "\" -U " + dbUser + " -A trust -E UTF8 --locale=C",
            installDir, null, 180000, out output);
        Log("initdb exit=" + code);
        if (code != 0) throw new Exception("Could not create the database.\r\n\r\n" + output);

        if (PortOpen(ToInt(dbPort, 55432)))
        {
            throw new Exception("Port " + dbPort + " is already in use. Close the other " +
                "service or install with a different database port.");
        }

        Report(progress, "Starting PostgreSQL…", 64);
        code = Run(Path.Combine(PgBin, "pg_ctl.exe"),
            "-D \"" + DataDir + "\" -l \"" + pgLog + "\" -o \"-p " + dbPort + "\" -w start",
            installDir, null, 90000, out output);
        Log("pg start exit=" + code);
        if (code != 0) throw new Exception("Could not start PostgreSQL.\r\n\r\n" + output);

        try
        {
            if (!WaitPort(ToInt(dbPort, 55432), 20000))
            {
                throw new Exception("PostgreSQL did not accept connections.");
            }

            Report(progress, "Creating the application database…", 70);
            code = Run(Path.Combine(PgBin, "createdb.exe"),
                "-h 127.0.0.1 -p " + dbPort + " -U " + dbUser + " " + dbName,
                installDir, null, 60000, out output);
            Log("createdb exit=" + code);
            if (code != 0) throw new Exception("Could not create the database.\r\n\r\n" + output);

            Run(Path.Combine(PgBin, "psql.exe"),
                "-h 127.0.0.1 -p " + dbPort + " -U " + dbUser + " -d " + dbName +
                " -c \"ALTER USER " + dbUser + " WITH PASSWORD '" + dbPassword + "'\"",
                installDir, null, 60000, out output);

            Report(progress, "Applying database migrations…", 76);
            Dictionary<string, string> env = BackendEnvironment();
            string knex = Path.Combine(BackendDir, "node_modules", "knex", "bin", "cli.js");
            code = Run(NodeExe,
                "\"" + knex + "\" migrate:latest --knexfile \"" + Path.Combine(BackendDir, "knexfile.js") + "\"",
                BackendDir, env, 300000, out output);
            Log("migrate exit=" + code);
            if (code != 0) throw new Exception("Database migrations failed.\r\n\r\n" + output);

            Report(progress, "Loading default data…", 84);
            code = Run(NodeExe,
                "\"" + knex + "\" seed:run --knexfile \"" + Path.Combine(BackendDir, "knexfile.js") + "\"",
                BackendDir, env, 300000, out output);
            Log("seed exit=" + code);
            if (code != 0) throw new Exception("Loading default data failed.\r\n\r\n" + output);
        }
        finally
        {
            Run(Path.Combine(PgBin, "pg_ctl.exe"),
                "-D \"" + DataDir + "\" -m fast -w stop", installDir, null, 60000, out output);
        }
    }

    private static Dictionary<string, string> BackendEnvironment()
    {
        Dictionary<string, string> env = new Dictionary<string, string>();
        env["DATABASE_URL"] = DbUrl;
        env["NODE_ENV"] = "production";
        env["JWT_SECRET"] = jwtSecret;
        env["PIN_PEPPER"] = jwtSecret;
        env["PORT"] = appPort;
        env["CORS_ORIGINS"] = CorsOrigins();
        env["FRONTEND_DIR"] = Path.Combine(installDir, "app", "frontend", "dist");
        return env;
    }

    private static void CreateShortcuts()
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        CreateShortcut(Path.Combine(desktop, "City Square POS (Staff).lnk"),
            LauncherPath, "staff", "City Square POS — staff login");
        CreateShortcut(Path.Combine(desktop, "City Square POS (Waiter).lnk"),
            LauncherPath, "waiter", "City Square POS — waiter PIN login");

        string startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs), "City Square POS");
        Directory.CreateDirectory(startMenu);
        CreateShortcut(Path.Combine(startMenu, "City Square POS (Staff).lnk"),
            LauncherPath, "staff", "City Square POS — staff login");
        CreateShortcut(Path.Combine(startMenu, "City Square POS (Waiter).lnk"),
            LauncherPath, "waiter", "City Square POS — waiter PIN login");
        CreateShortcut(Path.Combine(startMenu, "Uninstall City Square POS.lnk"),
            LauncherPath, "uninstall", "Remove City Square POS");
    }

    private static void CreateShortcut(string linkPath, string target, string arguments, string description)
    {
        try
        {
            object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            object shortcut = shell.GetType().InvokeMember(
                "CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { linkPath });
            Type type = shortcut.GetType();
            type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
            type.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { arguments });
            type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut,
                new object[] { Path.GetDirectoryName(target) });
            type.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
            type.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut,
                new object[] { target + ",0" });
            type.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }
        catch
        {
            // Shortcut creation is best effort; the installed folder still works.
        }
    }

    private static void RegisterUninstaller()
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(
                "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CitySquarePOS"))
            {
                if (key == null) return;
                key.SetValue("DisplayName", "City Square POS");
                key.SetValue("DisplayVersion", Version);
                key.SetValue("Publisher", Publisher);
                key.SetValue("InstallLocation", installDir);
                key.SetValue("DisplayIcon", LauncherPath + ",0");
                key.SetValue("UninstallString", "\"" + LauncherPath + "\" uninstall");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }
        catch
        {
            // Not fatal.
        }
    }

    private static string RandomSecret()
    {
        byte[] bytes = new byte[48];
        using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider())
        {
            rng.GetBytes(bytes);
        }
        StringBuilder text = new StringBuilder(bytes.Length * 2);
        foreach (byte b in bytes) text.Append(b.ToString("x2"));
        return text.ToString();
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

    private static bool PortOpen(int port)
    {
        try
        {
            using (TcpClient client = new TcpClient())
            {
                IAsyncResult result = client.BeginConnect("127.0.0.1", port, null, null);
                if (!result.AsyncWaitHandle.WaitOne(400)) return false;
                client.EndConnect(result);
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    private static int Run(string exe, string args, string workingDir,
        Dictionary<string, string> environment, int timeoutMs, out string output)
    {
        ProcessStartInfo psi = new ProcessStartInfo(exe, args);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        if (workingDir != null) psi.WorkingDirectory = workingDir;
        if (environment != null)
        {
            foreach (KeyValuePair<string, string> pair in environment)
            {
                psi.EnvironmentVariables[pair.Key] = pair.Value;
            }
        }

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

    private static int ToInt(string value, int fallback)
    {
        int parsed;
        return int.TryParse(value, out parsed) ? parsed : fallback;
    }

    // ZipArchive needs a seekable stream that starts at the appended payload.
    private sealed class SubStream : Stream
    {
        private readonly Stream inner;
        private readonly long start;
        private readonly long length;
        private long position;

        public SubStream(Stream inner, long start, long length)
        {
            this.inner = inner;
            this.start = start;
            this.length = length;
        }

        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return length; } }

        public override long Position
        {
            get { return position; }
            set { position = value; }
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            long remaining = length - position;
            if (remaining <= 0) return 0;
            if (count > remaining) count = (int)remaining;
            inner.Position = start + position;
            int read = inner.Read(buffer, offset, count);
            position += read;
            return read;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            long next;
            switch (origin)
            {
                case SeekOrigin.Begin: next = offset; break;
                case SeekOrigin.Current: next = position + offset; break;
                default: next = length + offset; break;
            }
            if (next < 0) next = 0;
            if (next > length) next = length;
            position = next;
            return position;
        }

        public override void Flush() { }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    }
}

sealed class SetupForm : Form
{
    private readonly Label statusLabel;
    private readonly ProgressBar progressBar;
    private readonly Button installButton;
    private readonly CheckBox launchCheck;
    private readonly TextBox pathBox;
    private readonly RadioButton serverRadio;
    private readonly RadioButton terminalRadio;
    private readonly TextBox serverBox;
    private readonly Label serverHint;

    public SetupForm()
    {
        Text = "City Square POS Setup";
        ClientSize = new Size(560, 448);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.White;

        try
        {
            using (Stream stream = Assembly.GetExecutingAssembly()
                .GetManifestResourceStream("Setup.Logo.png"))
            {
                if (stream != null)
                {
                    Image logoImage = Image.FromStream(stream);
                    PictureBox logo = new PictureBox();
                    logo.Image = logoImage;
                    logo.SizeMode = PictureBoxSizeMode.Zoom;
                    logo.Size = new Size(56, 56);
                    logo.Location = new Point(478, 14);
                    logo.BackColor = Color.White;
                    Controls.Add(logo);
                    using (Bitmap small = new Bitmap(logoImage, new Size(32, 32)))
                    {
                        Icon = Icon.FromHandle(small.GetHicon());
                    }
                }
            }
        }
        catch
        {
            // Branding must never block the install.
        }

        Label title = new Label();
        title.Text = "City Square POS";
        title.Font = new Font("Segoe UI", 18F, FontStyle.Bold);
        title.AutoSize = true;
        title.Location = new Point(24, 20);
        Controls.Add(title);

        Label subtitle = new Label();
        subtitle.Text = "Restaurant point-of-sale · version " + SetupProgram.Version +
            "\r\nUse one PC as the main server and the others as terminals.\r\n" +
            "Installs two apps: Staff login and Waiter login.";
        subtitle.Font = new Font("Segoe UI", 9.5F);
        subtitle.ForeColor = Color.FromArgb(75, 85, 99);
        subtitle.AutoSize = true;
        subtitle.Location = new Point(26, 54);
        Controls.Add(subtitle);

        Label pathLabel = new Label();
        pathLabel.Text = "Install folder";
        pathLabel.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
        pathLabel.AutoSize = true;
        pathLabel.Location = new Point(26, 108);
        Controls.Add(pathLabel);

        pathBox = new TextBox();
        pathBox.Text = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "CitySquarePOS");
        pathBox.Location = new Point(26, 130);
        pathBox.Width = 508;
        Controls.Add(pathBox);

        Label roleLabel = new Label();
        roleLabel.Text = "This PC's role";
        roleLabel.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
        roleLabel.AutoSize = true;
        roleLabel.Location = new Point(26, 168);
        Controls.Add(roleLabel);

        serverRadio = new RadioButton();
        serverRadio.Text = "Main server — keeps the database and runs the app";
        serverRadio.Checked = true;
        serverRadio.AutoSize = true;
        serverRadio.Location = new Point(26, 190);
        serverRadio.CheckedChanged += RoleChanged;
        Controls.Add(serverRadio);

        terminalRadio = new RadioButton();
        terminalRadio.Text = "Terminal — connects to the main server over LAN or Wi-Fi";
        terminalRadio.AutoSize = true;
        terminalRadio.Location = new Point(26, 212);
        terminalRadio.CheckedChanged += RoleChanged;
        Controls.Add(terminalRadio);

        serverBox = new TextBox();
        serverBox.Location = new Point(26, 240);
        serverBox.Width = 508;
        serverBox.Enabled = false;
        Controls.Add(serverBox);

        serverHint = new Label();
        serverHint.Text = "The main PC shows its address after installation, e.g. https://192.168.1.20:3000";
        serverHint.Font = new Font("Segoe UI", 8.5F);
        serverHint.ForeColor = Color.FromArgb(107, 114, 128);
        serverHint.AutoSize = true;
        serverHint.Location = new Point(26, 264);
        Controls.Add(serverHint);

        launchCheck = new CheckBox();
        launchCheck.Text = "Open the Staff app when installation finishes";
        launchCheck.Checked = true;
        launchCheck.AutoSize = true;
        launchCheck.Location = new Point(26, 294);
        Controls.Add(launchCheck);

        progressBar = new ProgressBar();
        progressBar.Location = new Point(26, 326);
        progressBar.Width = 508;
        progressBar.Height = 16;
        Controls.Add(progressBar);

        statusLabel = new Label();
        statusLabel.Text = "Ready to install.";
        statusLabel.ForeColor = Color.FromArgb(75, 85, 99);
        statusLabel.AutoSize = true;
        statusLabel.Location = new Point(26, 350);
        Controls.Add(statusLabel);

        installButton = new Button();
        installButton.Text = "Install";
        installButton.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
        installButton.BackColor = Color.FromArgb(37, 99, 235);
        installButton.ForeColor = Color.White;
        installButton.FlatStyle = FlatStyle.Flat;
        installButton.FlatAppearance.BorderSize = 0;
        installButton.Size = new Size(120, 38);
        installButton.Location = new Point(414, 390);
        installButton.Click += InstallClick;
        Controls.Add(installButton);

        Button cancel = new Button();
        cancel.Text = "Close";
        cancel.Size = new Size(100, 38);
        cancel.Location = new Point(302, 390);
        cancel.Click += delegate { Close(); };
        Controls.Add(cancel);
    }

    private void RoleChanged(object sender, EventArgs e)
    {
        bool terminal = terminalRadio.Checked;
        serverBox.Enabled = terminal;
        serverHint.Enabled = terminal;
        launchCheck.Text = terminal
            ? "Open the Waiter app when installation finishes"
            : "Open the Staff app when installation finishes";
    }

    private void InstallClick(object sender, EventArgs e)
    {
        string chosen = pathBox.Text.Trim();
        if (chosen.Length == 0)
        {
            MessageBox.Show("Choose an install folder.", "City Square POS Setup");
            return;
        }

        bool terminal = terminalRadio.Checked;
        string serverAddress = serverBox.Text.Trim();
        if (terminal)
        {
            if (serverAddress.Length == 0)
            {
                MessageBox.Show(
                    "Enter the main server address, for example 192.168.1.20:3000.\r\n\r\n" +
                    "Run Setup on the main server PC first — it shows the exact address " +
                    "to use here when it finishes.",
                    "City Square POS Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                serverBox.Focus();
                return;
            }
            try
            {
                typeof(SetupProgram).GetMethod("NormalizeServerUrl",
                    BindingFlags.NonPublic | BindingFlags.Static)
                    .Invoke(null, new object[] { serverAddress });
            }
            catch (TargetInvocationException ex)
            {
                MessageBox.Show(ex.InnerException == null ? ex.Message : ex.InnerException.Message,
                    "City Square POS Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                serverBox.Focus();
                return;
            }
        }

        installButton.Enabled = false;
        launchCheck.Enabled = false;
        pathBox.Enabled = false;
        serverRadio.Enabled = false;
        terminalRadio.Enabled = false;
        serverBox.Enabled = false;
        progressBar.Style = ProgressBarStyle.Continuous;
        progressBar.Value = 0;

        SetArguments(chosen, launchCheck.Checked ? (terminal ? "waiter" : "staff") : "none",
            terminal ? serverAddress : "");

        Thread worker = new Thread(delegate()
        {
            try
            {
                SetupProgram.RunInstall(Report);
                BeginInvoke(new Action(delegate
                {
                    statusLabel.Text = "Installation complete.";
                    MessageBox.Show(
                        terminal
                            ? "City Square POS is installed as a terminal.\r\n\r\n" +
                              "This PC connects to the main server at:\r\n" +
                              SetupProgram.ServerUrl + "\r\n\r\n" +
                              "Two apps are now on your desktop:\r\n" +
                              "• City Square POS (Staff)\r\n" +
                              "• City Square POS (Waiter)\r\n\r\n" +
                              "The main server PC must be switched on and on the same " +
                              "network. The connection is encrypted (HTTPS)."
                            : "City Square POS is installed as the main server.\r\n\r\n" +
                              "Address for the other PCs (terminals):\r\n" +
                              SetupProgram.ServerAddressHint() + "\r\n\r\n" +
                              "Two apps are now on your desktop:\r\n" +
                              "• City Square POS (Staff)\r\n" +
                              "• City Square POS (Waiter)\r\n\r\n" +
                              "On each other PC, run Setup and choose Terminal, then " +
                              "enter the address above. The connection is encrypted " +
                              "(HTTPS) and this server's certificate is trusted on " +
                              "this PC automatically.\r\n\r\n" +
                              "If a terminal cannot connect, allow City Square POS " +
                              "through Windows Firewall on this PC.",
                        "City Square POS Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    Close();
                }));
            }
            catch (Exception ex)
            {
                BeginInvoke(new Action(delegate
                {
                    statusLabel.Text = "Installation failed.";
                    MessageBox.Show("Installation failed.\r\n\r\n" + ex.Message,
                        "City Square POS Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    installButton.Enabled = true;
                    launchCheck.Enabled = true;
                    pathBox.Enabled = true;
                    serverRadio.Enabled = true;
                    terminalRadio.Enabled = true;
                    serverBox.Enabled = terminalRadio.Checked;
                }));
            }
        });
        worker.IsBackground = true;
        worker.Start();
    }

    private static void SetArguments(string chosenDir, string launch, string server)
    {
        // Silent parser is reused so the path/launch choice follows one code path.
        // /SERVER= is always passed so switching an existing terminal back to
        // server drops the stored terminal address.
        string[] args = new string[]
        {
            "/SILENT", "/DIR=" + chosenDir, "/LAUNCH=" + launch, "/SERVER=" + server,
        };
        typeof(SetupProgram).GetMethod("ParseArgs", BindingFlags.NonPublic | BindingFlags.Static)
            .Invoke(null, new object[] { args });
    }

    private void Report(string message, int percent)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(delegate { Report(message, percent); }));
            return;
        }
        statusLabel.Text = message;
        progressBar.Value = Math.Max(0, Math.Min(100, percent));
    }
}
