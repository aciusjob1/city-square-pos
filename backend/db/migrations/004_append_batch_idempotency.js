exports.up = async function (knex) {
  // Undo the failed design from migration 003: client_uuid on order_items
  // was wrong because a batch of N items needs N rows with one shared
  // client_uuid, but the unique index rejects N>1.
  await knex.raw(`DROP INDEX IF EXISTS order_items_client_uuid_unique;`);
  await knex.raw(`ALTER TABLE order_items DROP COLUMN IF EXISTS client_uuid;`);

  // Correct design: a per-batch log. One row per append request.
  // The unique PK on client_uuid makes retries idempotent.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS order_append_batches (
      client_uuid UUID PRIMARY KEY,
      order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS order_append_batches_order_id_index
      ON order_append_batches (order_id);
  `);
};

exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS order_append_batches;`);
};
