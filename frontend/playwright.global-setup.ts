import { execSync } from 'node:child_process';

export default async function globalSetup() {
  try {
    execSync(
      'psql -h 127.0.0.1 -U citysquare -d citysquare -c "DELETE FROM pin_attempts_log;"',
      { stdio: 'ignore' },
    );

    // Clear bill_group_id from stale open orders, then cancel them.
    // Order matters: unlink the group first, then cancel — so no orphan
    // bill groups survive into the next test run.
    execSync(
      'psql -h 127.0.0.1 -U citysquare -d citysquare -c "UPDATE orders SET bill_group_id = NULL WHERE cancelled_at IS NULL AND closed_at IS NULL;"',
      { stdio: 'ignore' },
    );
    execSync(
      'psql -h 127.0.0.1 -U citysquare -d citysquare -c "UPDATE orders SET cancelled_at = now(), cancellation_reason = \'test cleanup\', status = \'CANCELLED\' WHERE cancelled_at IS NULL AND closed_at IS NULL;"',
      { stdio: 'ignore' },
    );

    console.log('[playwright] cleared pin log, unlinked bill groups, cancelled open orders');
  } catch (e) {
    console.warn('[playwright] could not run DB cleanup:', e);
  }
}
