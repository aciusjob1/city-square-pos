exports.up = async function (knex) {
  // 1) closed_at: bill printed → table freed. Independent of paid_amount,
  //    status, and cancelled_at.
  await knex.raw(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ NULL;`);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS orders_closed_at_index
      ON orders (closed_at)
      WHERE closed_at IS NOT NULL;
  `);

  // 2) The one-active-order-per-table invariant now excludes closed orders too.
  //    Drop and recreate — this is a migration, the index name is reused.
  await knex.raw(`DROP INDEX IF EXISTS orders_one_active_per_table;`);
  await knex.raw(`
    CREATE UNIQUE INDEX orders_one_active_per_table
      ON orders (table_id)
      WHERE cancelled_at IS NULL
        AND closed_at IS NULL
        AND table_id IS NOT NULL;
  `);

  // 3) Idempotency key on print_jobs.
  //    'bill-<orderId>' for the first bill print.
  //    'bill-reprint-<orderId>-<n>' for reprints (physical paper from
  //    a new job each time, since the previous one is already consumed).
  await knex.raw(`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;`);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_idempotency_key_unique
      ON print_jobs (idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS print_jobs_idempotency_key_unique;`);
  await knex.raw(`ALTER TABLE print_jobs DROP COLUMN IF EXISTS idempotency_key;`);
  await knex.raw(`DROP INDEX IF EXISTS orders_closed_at_index;`);
  await knex.raw(`DROP INDEX IF EXISTS orders_one_active_per_table;`);
  await knex.raw(`
    CREATE UNIQUE INDEX orders_one_active_per_table
      ON orders (table_id)
      WHERE cancelled_at IS NULL AND table_id IS NOT NULL;
  `);
  await knex.raw(`ALTER TABLE orders DROP COLUMN IF EXISTS closed_at;`);
};
