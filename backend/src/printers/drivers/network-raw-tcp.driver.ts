import { PrinterDriver, PrintPayload } from './printer-driver.interface';

/**
 * Prints to network-attached thermal printers via raw ESC/POS over TCP
 * (typically port 9100 for Epson, Star, Bixolon, etc.).
 *
 * NOT IMPLEMENTED in slice 8.7f. Slice 8.8 will add:
 *   - net.Socket connection to ipAddress:port
 *   - payload write with proper flush + close
 *   - timeout handling (5s default)
 *   - reconnect-retry-once on transient failures
 *
 * The current stub throws so no caller can accidentally believe a print
 * succeeded.
 */
export class NetworkRawTcpDriver implements PrinterDriver {
  readonly name = 'network-raw-tcp';

  async print(_job: PrintPayload): Promise<void> {
    throw new Error(
      'NetworkRawTcpDriver: physical printing not yet implemented. Deferred to slice 8.8.',
    );
  }
}
