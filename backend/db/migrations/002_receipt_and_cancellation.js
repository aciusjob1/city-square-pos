exports.up = async function (knex) {
  // 1) Ensure a RECEIPT station printer exists so bill print_jobs
  //    can be created even if the physical printer isn't wired up yet.
  //    Station enum already has KITCHEN/BAR/NONE — we reuse NONE for receipts
  //    because this printer isn't a "preparation station".
  await knex.raw(`
    INSERT INTO printers (name, ip_address, port, station, is_active)
    SELECT 'Receipt Printer', '192.168.1.52', 9100, 'NONE', true
    WHERE NOT EXISTS (
      SELECT 1 FROM printers WHERE name = 'Receipt Printer'
    );
  `);

  // 2) Cancellation lookup index — the reports and audit views will
  //    query cancelled orders by date frequently.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS orders_cancelled_at_index
      ON orders (cancelled_at)
      WHERE cancelled_at IS NOT NULL;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS orders_cancelled_at_index;`);
  await knex.raw(`DELETE FROM printers WHERE name = 'Receipt Printer';`);
};
