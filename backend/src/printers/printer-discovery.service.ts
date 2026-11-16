import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WINDOWS_STATUS: Record<number, string> = {
  1: 'Other',
  2: 'Unknown',
  3: 'Idle',
  4: 'Printing',
  5: 'Warmup',
  6: 'Stopped',
  7: 'Offline',
};

export interface DiscoveredPrinter {
  name: string;
  driver: string | null;
  portName: string | null;
  status: string;
  isDefault: boolean;
}

export interface DiscoveryResult {
  printers: DiscoveredPrinter[];
  platform: string;
  warning?: string;
}

/**
 * Enumerates printers installed on the machine running the backend.
 * Windows uses the WMI/CIM printer list; Linux/macOS use CUPS via lpstat.
 * Discovery never changes anything — it only reports what the OS exposes.
 */
@Injectable()
export class PrinterDiscoveryService {
  private readonly logger = new Logger(PrinterDiscoveryService.name);

  async discover(): Promise<DiscoveryResult> {
    try {
      const printers =
        process.platform === 'win32'
          ? await this.discoverWindows()
          : await this.discoverCups();
      return { printers, platform: process.platform };
    } catch (e: any) {
      this.logger.warn(`Printer discovery failed: ${e?.message ?? e}`);
      return {
        printers: [],
        platform: process.platform,
        warning:
          'Could not list printers installed on this computer. On Windows this needs PowerShell; on Linux/macOS it needs CUPS (lpstat).',
      };
    }
  }

  private async discoverWindows(): Promise<DiscoveredPrinter[]> {
    const script =
      'Get-CimInstance Win32_Printer | ' +
      'Select-Object Name,DriverName,PortName,Default,WorkOffline,PrinterStatus | ' +
      'ConvertTo-Json -Compress';
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true },
    );

    const raw = stdout.replace(/^\uFEFF/, '').trim();
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const printers: DiscoveredPrinter[] = [];
    for (const row of rows) {
      const name = String(row?.Name ?? '').trim();
      if (!name) continue;
      const offline = row?.WorkOffline === true;
      const statusCode = Number(row?.PrinterStatus);
      printers.push({
        name,
        driver: row?.DriverName ? String(row.DriverName) : null,
        portName: row?.PortName ? String(row.PortName) : null,
        status: offline
          ? 'Offline'
          : (WINDOWS_STATUS[statusCode] ?? 'Unknown'),
        isDefault: row?.Default === true,
      });
    }
    return printers;
  }

  private async discoverCups(): Promise<DiscoveredPrinter[]> {
    const { stdout } = await execFileAsync('lpstat', ['-p', '-d'], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });

    let defaultName: string | null = null;
    const printers: DiscoveredPrinter[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const def = line.match(/^system default destination:\s*(.+)$/i);
      if (def) {
        defaultName = def[1].trim();
        continue;
      }
      const p = line.match(/^printer\s+(\S+)\s+(.*)$/i);
      if (!p) continue;
      const rest = p[2];
      const status = /disabled/i.test(rest)
        ? 'Disabled'
        : /now printing/i.test(rest)
          ? 'Printing'
          : /is idle/i.test(rest)
            ? 'Idle'
            : 'Unknown';
      printers.push({
        name: p[1],
        driver: null,
        portName: null,
        status,
        isDefault: false,
      });
    }
    for (const p of printers) p.isDefault = p.name === defaultName;
    return printers;
  }
}
