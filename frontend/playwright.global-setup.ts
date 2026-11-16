import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PSQL = 'psql -h 127.0.0.1 -U citysquare -d citysquare';

// Run SQL from a temp file instead of `psql -c "..."`: cmd.exe mangles the
// nested quotes and multi-statement strings, and failures were silent.
function runSql(sql: string) {
  const dir = mkdtempSync(join(tmpdir(), 'city-square-'));
  const file = join(dir, 'setup.sql');
  try {
    writeFileSync(file, sql);
    execSync(`${PSQL} -f "${file}"`, { stdio: 'ignore' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function purgeTestPrinters() {
  // Fixtures must not survive a run, and older specs created printers with
  // these name prefixes. DELETE /printers only deactivates, so remove rows
  // outright at the start and end of the suite.
  try {
    runSql(
      `DELETE FROM printers
        WHERE name LIKE 'Test-OS-Printer-%'
           OR name LIKE 'Test Multi-%'
           OR name IN ('Test Kitchen Printer','Test Bar Printer','Test Receipt Printer','Test Extra Printer','Test Unreachable Printer');`,
    );
  } catch {}
}

export default async function globalSetup() {
  try {
    runSql('DELETE FROM pin_attempts_log; DELETE FROM login_attempts_log;');

    // Clear bill_group_id from stale open orders, then cancel them.
    // Order matters: unlink the group first, then cancel — so no orphan
    // bill groups survive into the next test run.
    runSql(
      'UPDATE orders SET bill_group_id = NULL WHERE cancelled_at IS NULL AND closed_at IS NULL;',
    );
    runSql(
      "UPDATE orders SET cancelled_at = now(), cancellation_reason = 'test cleanup', status = 'CANCELLED' WHERE cancelled_at IS NULL AND closed_at IS NULL;",
    );

    // Drop auto-generated printers left behind by interrupted test runs so the
    // Settings page never accumulates stale rows. print_jobs.printer_id is
    // ON DELETE SET NULL and printer_stations cascade, so history is kept.
    purgeTestPrinters();

    // Tests still need deterministic stations, so provision fixtures directly.
    // Each station is a separate INSERT ... SELECT so the unknown literal is
    // coerced to the Station enum (a UNION ALL would type it as text first).
    runSql(`
      INSERT INTO printers (name, ip_address, port, type, is_active)
      SELECT v.name, v.ip, 9100, 'NETWORK', true
        FROM (VALUES
          ('Test Kitchen Printer', '10.250.0.50'),
          ('Test Bar Printer', '10.250.0.51'),
          ('Test Receipt Printer', '10.250.0.52'),
          ('Test Extra Printer', '10.250.0.53')
        ) AS v(name, ip)
       WHERE NOT EXISTS (SELECT 1 FROM printers p WHERE p.name = v.name);
      UPDATE printers SET is_active = true
       WHERE name IN ('Test Kitchen Printer','Test Bar Printer','Test Receipt Printer','Test Extra Printer');
      INSERT INTO printer_stations (printer_id, station) SELECT p.id, 'KITCHEN' FROM printers p WHERE p.name = 'Test Kitchen Printer';
      INSERT INTO printer_stations (printer_id, station) SELECT p.id, 'BAR' FROM printers p WHERE p.name = 'Test Bar Printer';
      INSERT INTO printer_stations (printer_id, station) SELECT p.id, 'NONE' FROM printers p WHERE p.name = 'Test Receipt Printer';
      INSERT INTO printer_stations (printer_id, station) SELECT p.id, 'KITCHEN' FROM printers p WHERE p.name = 'Test Extra Printer';
    `);

    console.log('[playwright] cleared logs, unlinked bill groups, cancelled open orders, purged test printers, ensured printer fixtures');
  } catch (e) {
    console.warn('[playwright] could not run DB cleanup:', e);
  }

  return async () => {
    purgeTestPrinters();
  };
}
