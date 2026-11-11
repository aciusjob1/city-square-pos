import { PrinterDriver, PrintPayload } from './printer-driver.interface';

/**
 * Prints to OS-managed printers (CUPS on Linux/macOS, Windows spooler).
 *
 * NOT IMPLEMENTED in slice 8.7f. Slice 8.8 will add:
 *   - Linux/macOS: spawn `lp -d <osPrinterName> -o raw` with payload on stdin
 *   - Windows: Electron main-process IPC to invoke the Windows print API
 *
 * The current stub throws so no caller can accidentally believe a print
 * succeeded.
 */
export class OsSpoolerDriver implements PrinterDriver {
  readonly name = 'os-spooler';

  async print(_job: PrintPayload): Promise<void> {
    throw new Error(
      'OsSpoolerDriver: OS spooler not yet implemented. Deferred to slice 8.8.',
    );
  }
}
