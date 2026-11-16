import { connect } from 'node:net';
import { PrinterDriver, PrintPayload } from './printer-driver.interface';

const DEFAULT_PORT = 9100;
const CONNECT_TIMEOUT_MS = 5000;

/**
 * Sends raw ESC/POS bytes to a network-attached thermal printer over TCP
 * (port 9100 on Epson, Star, Bixolon, Xprinter, etc.).
 */
export class NetworkRawTcpDriver implements PrinterDriver {
  readonly name = 'network-raw-tcp';

  async print(job: PrintPayload): Promise<void> {
    const host = (job.ipAddress ?? '').trim();
    if (!host) throw new Error('Network printer has no IP address configured');
    const port = job.port ?? DEFAULT_PORT;

    try {
      await this.send(host, port, job.data);
    } catch (first: any) {
      // One retry for transient drops (printer waking up, ARP, brief Wi-Fi loss).
      await this.send(host, port, job.data).catch(() => {
        throw new Error(`${host}:${port} unreachable (${first?.message ?? first})`);
      });
    }
  }

  private send(host: string, port: number, data: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = connect({ host, port });
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        error ? reject(error) : resolve();
      };

      socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
        finish(new Error(`Timed out connecting to ${host}:${port}`));
      });
      socket.once('error', (error) => finish(error));
      socket.once('connect', () => {
        socket.write(data, (error) => {
          if (error) return finish(error);
          socket.end();
        });
      });
      socket.once('close', () => finish());
    });
  }
}
