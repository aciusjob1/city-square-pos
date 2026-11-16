import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { loadRestaurantName } from '../common/branding';
import { NetworkRawTcpDriver } from './drivers/network-raw-tcp.driver';
import { OsSpoolerDriver } from './drivers/os-spooler.driver';
import { PrinterDriver } from './drivers/printer-driver.interface';
import { buildTestTicketPayload, renderTicket } from './escpos';

const POLL_INTERVAL_MS = 1000;
const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 20;

interface JobRow {
  id: string;
  payload: string;
  ticket_type: 'KITCHEN' | 'BAR' | 'RECEIPT';
  printer_id: string;
  name: string;
  type: 'NETWORK' | 'OS';
  ip_address: string | null;
  port: number | null;
  attempts: number;
}

interface PrinterRow {
  id: string;
  name: string;
  type: 'NETWORK' | 'OS';
  ip_address: string | null;
  port: number | null;
}

/**
 * Turns PENDING print_jobs rows into physical paper.
 *
 * Jobs are created inside the same transaction as the order/bill, so the
 * worker never claims a row before it commits. New jobs are picked up within
 * a second; order flows also call kick() for near-instant dispatch.
 */
@Injectable()
export class PrinterDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrinterDispatchService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly drivers: Record<'NETWORK' | 'OS', PrinterDriver> = {
    NETWORK: new NetworkRawTcpDriver(),
    OS: new OsSpoolerDriver(),
  };

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    // A PROCESSING row can only be left behind by a crash mid-print.
    // Requeue it so the ticket is not silently lost.
    await this.db
      .query(`UPDATE print_jobs SET status = 'PENDING' WHERE status = 'PROCESSING'`)
      .catch((error) => this.logger.warn(`Could not requeue interrupted print jobs: ${error}`));

    // Jobs from before a printer existed can never be dispatched. Mark them
    // once instead of leaving a permanent PENDING backlog in Print Jobs.
    await this.db
      .query(
        `UPDATE print_jobs
            SET status = 'FAILED', last_error = 'No printer was assigned to this job'
          WHERE status = 'PENDING' AND printer_id IS NULL`,
      )
      .catch((error) => this.logger.warn(`Could not close unassigned print jobs: ${error}`));

    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Nudge the worker right after a job is committed. Never throws. */
  kick() {
    setImmediate(() => void this.tick());
  }

  /** Sends a self-check ticket and reports the driver error, if any. */
  async testPrint(printer: PrinterRow): Promise<void> {
    const restaurantName = await loadRestaurantName(this.db);
    const payload = buildTestTicketPayload(restaurantName, printer.name);
    await this.driverFor(printer).print({
      printerId: printer.id,
      printerType: printer.type,
      ticketType: 'TEST',
      data: renderTicket(payload),
      ipAddress: printer.ip_address,
      port: printer.port,
      osPrinterName: printer.type === 'OS' ? printer.name : null,
    });
  }

  private driverFor(printer: Pick<PrinterRow, 'type'>): PrinterDriver {
    return printer.type === 'OS' ? this.drivers.OS : this.drivers.NETWORK;
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.drain();
    } catch (error: any) {
      this.logger.warn(`Print dispatch tick failed: ${error?.message ?? error}`);
    } finally {
      this.ticking = false;
    }
  }

  private async drain() {
    // Quadratic backoff (attempt 1 -> 2s, 2 -> 8s) keeps a dead printer from
    // being hammered every second while still retrying soon after a reboot.
    const jobs = await this.db.query<JobRow>(
      `SELECT pj.id, pj.payload, pj.ticket_type,
              p.id AS printer_id, p.name, p.type, p.ip_address, p.port,
              pj.attempts
         FROM print_jobs pj
         JOIN printers p ON p.id = pj.printer_id
        WHERE pj.status = 'PENDING'
          AND p.is_active = true
          AND (pj.attempts = 0
               OR pj.created_at <= now() - make_interval(secs => pj.attempts * pj.attempts * 2))
        ORDER BY pj.created_at ASC
        LIMIT ${BATCH_SIZE}`,
    );

    for (const job of jobs.rows) {
      const claimed = await this.db.query<{ attempts: number }>(
        `UPDATE print_jobs
            SET status = 'PROCESSING', attempts = attempts + 1
          WHERE id = $1 AND status = 'PENDING'
          RETURNING attempts`,
        [job.id],
      );
      if (!claimed.rows[0]) continue;
      const attempts = claimed.rows[0].attempts;

      try {
        await this.driverFor(job).print({
          printerId: job.printer_id,
          printerType: job.type,
          ticketType: job.ticket_type,
          data: renderTicket(job.payload),
          ipAddress: job.ip_address,
          port: job.port,
          osPrinterName: job.type === 'OS' ? job.name : null,
        });
        await this.db.query(
          `UPDATE print_jobs
              SET status = 'SENT', sent_at = now(), printed_at = now(), last_error = NULL
            WHERE id = $1`,
          [job.id],
        );
      } catch (error: any) {
        const message = String(error?.message ?? error).slice(0, 500);
        const final = attempts >= MAX_ATTEMPTS;
        await this.db
          .query(
            `UPDATE print_jobs
                SET status = $2::"PrintJobStatus", last_error = $3
              WHERE id = $1`,
            [job.id, final ? 'FAILED' : 'PENDING', message],
          )
          .catch(() => undefined);
        this.logger.warn(
          `Print job ${job.id} (${job.ticket_type}) to "${job.name}" failed ` +
            `on attempt ${attempts}${final ? ' — giving up' : ''}: ${message}`,
        );
      }
    }
  }
}
