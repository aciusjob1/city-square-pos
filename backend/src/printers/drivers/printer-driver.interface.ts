/**
 * Driver contract for physically dispatching print jobs.
 *
 * The caller (PrinterDispatchService) renders the stored JSON ticket into
 * ESC/POS bytes and owns all print_jobs status updates. A driver must only
 * move bytes to the device and throw on any failure.
 */

export interface PrintPayload {
  printerId: string;
  printerType: 'NETWORK' | 'OS';
  ticketType: 'KITCHEN' | 'BAR' | 'RECEIPT' | 'TEST';
  /** Rendered ESC/POS bytes. */
  data: Buffer;
  ipAddress?: string | null;
  port?: number | null;
  osPrinterName?: string | null;
}

export interface PrinterDriver {
  readonly name: string;

  /**
   * Send the payload to the printer. Must throw on any failure — never swallow
   * errors, because the caller marks the job FAILED from the thrown message.
   */
  print(job: PrintPayload): Promise<void>;
}
