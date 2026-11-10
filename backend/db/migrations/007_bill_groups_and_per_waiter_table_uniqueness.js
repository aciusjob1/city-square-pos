exports.up = async function (knex) {
  // 1) Bill-group column — links multiple orders into a single final bill.
  await knex.raw(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_group_id UUID NULL;
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS orders_bill_group_id_index
      ON orders (bill_group_id)
      WHERE bill_group_id IS NOT NULL;
  `);

  // 2) Replace the one-active-order-per-table constraint.
  //    Old: only one open order per table (blocks multi-waiter workflows).
  //    New: only one open order per (table, waiter) pair. Multiple waiters
  //         can each hold their own active order on the same table — this
  //         matches real restaurant service where Fatma takes the drinks
  //         order while John's food order is still open.
  await knex.raw(`DROP INDEX IF EXISTS orders_one_active_per_table;`);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS orders_one_active_per_table_waiter
      ON orders (table_id, waiter_id)
      WHERE cancelled_at IS NULL
        AND closed_at IS NULL
        AND table_id IS NOT NULL;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS orders_one_active_per_table_waiter;`);
  await knex.raw(`
    CREATE UNIQUE INDEX orders_one_active_per_table
      ON orders (table_id)
      WHERE cancelled_at IS NULL AND closed_at IS NULL AND table_id IS NOT NULL;
  `);
  await knex.raw(`DROP INDEX IF EXISTS orders_bill_group_id_index;`);
  await knex.raw(`ALTER TABLE orders DROP COLUMN IF EXISTS bill_group_id;`);
};
