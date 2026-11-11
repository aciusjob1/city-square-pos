/**
 * Driver contract for physically dispatching print jobs.
 *
 * Not wired up in 8.7f. Slice 8.8 will:
 *   - Implement print() in NetworkRawTcpDriver (raw ESC/POS over TCP)
 *   - Implement print() in OsSpoolerDriver (CUPS / Windows spooler)
 *   - Add a job processor that claims PENDING jobs and dispatches via the
 *     correct driver based on printer.type
 *
 * Today: no consumer. Both driver classes throw.
 */

export interface PrintPayload {
  printerId: string;
  printerType: 'NETWORK' | 'OS';
  ticketType: 'KITCHEN' | 'BAR' | 'RECEIPT';
  payload: string;
  ipAddress?: string;
  port?: number;
  osPrinterName?: string;
}

export interface PrinterDriver {
  readonly name: string;

  /**
   * Send the payload to the printer.
   * Must throw on any failure — never swallow errors.
   * Must never mark a print job as successful on its own;
   * the caller (job processor, in 8.8) is responsible for status updates.
   */
  print(job: PrintPayload): Promise<void>;
}
