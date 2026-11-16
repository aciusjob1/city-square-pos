exports.up = async function (knex) {
  // Business-day sessions. A day is opened (manually or automatically) and
  // later closed; sales for the session are measured between opened_at and
  // closed_at so manual rollovers mid-evening still reconcile correctly.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS business_days (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_date date NOT NULL,
      opened_at timestamptz NOT NULL DEFAULT now(),
      opened_by uuid REFERENCES users(id) ON DELETE SET NULL,
      closed_at timestamptz,
      closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
      total_sales numeric(12,2) NOT NULL DEFAULT 0,
      order_count integer NOT NULL DEFAULT 0,
      cancelled_count integer NOT NULL DEFAULT 0,
      cancelled_total numeric(12,2) NOT NULL DEFAULT 0
    );
  `);

  // At most one open day may exist at any time.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS business_days_one_open
      ON business_days ((closed_at IS NULL))
      WHERE closed_at IS NULL;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS business_days_opened_at_index
      ON business_days (opened_at DESC);
  `);
};

exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS business_days;`);
};
