exports.up = async function (knex) {
  // Knex wraps this migration in a single transaction on PostgreSQL,
  // so any failure rolls back the entire file. Safe to rerun (knex_migrations
  // records completion). Safe on a DB that already has the target schema:
  // every step is either idempotent or preceded by an existence check.

  // 1) Cancel older duplicate active orders per table.
  //    Keep the newest by server_created_at, tie-break deterministically by id.
  //    Preserve history: cancelled, not deleted.
  await knex.raw(`
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY table_id
               ORDER BY server_created_at DESC, id DESC
             ) AS rn
        FROM orders
       WHERE cancelled_at IS NULL
         AND table_id IS NOT NULL
    )
    UPDATE orders o
       SET cancelled_at        = now(),
           cancelled_by        = NULL,
           cancellation_reason = 'Phase 4b migration: consolidate duplicate active orders',
           status              = 'CANCELLED'::"OrderStatus",
           updated_at          = now()
      FROM ranked r
     WHERE o.id = r.id
       AND r.rn > 1;
  `);

  // 2) order_items.client_uuid for idempotent appends.
  await knex.raw(`
    ALTER TABLE order_items
      ADD COLUMN IF NOT EXISTS client_uuid TEXT;
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS order_items_client_uuid_unique
      ON order_items (client_uuid)
      WHERE client_uuid IS NOT NULL;
  `);

  // 3) One active order per table.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS orders_one_active_per_table
      ON orders (table_id)
      WHERE cancelled_at IS NULL AND table_id IS NOT NULL;
  `);

  // 4) Fast lookup for active-order-by-table.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS orders_table_id_index
      ON orders (table_id);
  `);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS orders_table_id_index;`);
  await knex.raw(`DROP INDEX IF EXISTS orders_one_active_per_table;`);
  await knex.raw(`DROP INDEX IF EXISTS order_items_client_uuid_unique;`);
  await knex.raw(`ALTER TABLE order_items DROP COLUMN IF EXISTS client_uuid;`);
  // We do not un-cancel the consolidated duplicates on rollback —
  // the cleanup was intentional and preserves history.
};
