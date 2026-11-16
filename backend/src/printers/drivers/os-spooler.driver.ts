import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { PrinterDriver, PrintPayload } from './printer-driver.interface';

const execFileAsync = promisify(execFile);

// Raw bytes through the Windows spooler: Add-Type compiles a tiny Win32
// winspool helper, then pushes the file as a RAW datatype job. This is the
// same path POS applications use; it does not route text through the driver's
// page renderer, so ESC/POS commands reach the printer intact.
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;

public class CitySquareRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOC_INFO_1
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr handle);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool StartDocPrinter(IntPtr handle, int level,
        [In, MarshalAs(UnmanagedType.LPStruct)] DOC_INFO_1 info);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr handle);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr handle);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr handle);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);

    public static bool Send(string printerName, byte[] payload)
    {
        IntPtr handle;
        if (!OpenPrinter(printerName, out handle, IntPtr.Zero))
            throw new Exception("OpenPrinter failed for '" + printerName + "' (error " + Marshal.GetLastWin32Error() + ")");

        try
        {
            DOC_INFO_1 info = new DOC_INFO_1();
            info.pDocName = "City Square Ticket";
            info.pDataType = "RAW";
            if (!StartDocPrinter(handle, 1, info))
                throw new Exception("StartDocPrinter failed (error " + Marshal.GetLastWin32Error() + ")");
            try
            {
                if (!StartPagePrinter(handle))
                    throw new Exception("StartPagePrinter failed (error " + Marshal.GetLastWin32Error() + ")");
                try
                {
                    IntPtr buffer = Marshal.AllocCoTaskMem(payload.Length);
                    try
                    {
                        Marshal.Copy(payload, 0, buffer, payload.Length);
                        int written;
                        if (!WritePrinter(handle, buffer, payload.Length, out written))
                            throw new Exception("WritePrinter failed (error " + Marshal.GetLastWin32Error() + ")");
                    }
                    finally
                    {
                        Marshal.FreeCoTaskMem(buffer);
                    }
                }
                finally
                {
                    EndPagePrinter(handle);
                }
            }
            finally
            {
                EndDocPrinter(handle);
            }
        }
        finally
        {
            ClosePrinter(handle);
        }
        return true;
    }
}
'@
Add-Type -TypeDefinition $source
$bytes = [System.IO.File]::ReadAllBytes($env:CSPOS_PRINT_FILE)
[CitySquareRawPrinter]::Send($env:CSPOS_PRINTER_NAME, $bytes) | Out-Null
`;

/**
 * Prints through printers managed by the operating system:
 *   - Windows: raw spooler job (winspool)
 *   - Linux/macOS: CUPS `lp -o raw`
 * For Windows entries the `name` column holds the installed printer name.
 */
export class OsSpoolerDriver implements PrinterDriver {
  readonly name = 'os-spooler';

  async print(job: PrintPayload): Promise<void> {
    const printerName = (job.osPrinterName ?? '').trim();
    if (!printerName) throw new Error('OS printer has no printer name configured');

    const file = join(tmpdir(), `cspos-print-${randomUUID()}.prn`);
    await fs.writeFile(file, job.data);
    try {
      if (process.platform === 'win32') {
        await this.printWindows(printerName, file);
      } else {
        await this.printCups(printerName, file);
      }
    } finally {
      await fs.unlink(file).catch(() => undefined);
    }
  }

  private async printWindows(printerName: string, file: string): Promise<void> {
    try {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SCRIPT],
        {
          timeout: 30000,
          windowsHide: true,
          env: { ...process.env, CSPOS_PRINTER_NAME: printerName, CSPOS_PRINT_FILE: file },
        },
      );
    } catch (error: any) {
      const detail = String(error?.stderr ?? error?.message ?? error).trim().split(/\r?\n/)[0];
      throw new Error(`Windows spooler rejected "${printerName}": ${detail}`);
    }
  }

  private async printCups(printerName: string, file: string): Promise<void> {
    try {
      await execFileAsync('lp', ['-d', printerName, '-o', 'raw', file], { timeout: 20000 });
    } catch (error: any) {
      const detail = String(error?.stderr ?? error?.message ?? error).trim().split(/\r?\n/)[0];
      throw new Error(`CUPS rejected "${printerName}": ${detail}`);
    }
  }
}
