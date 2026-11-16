exports.up = async function (knex) {
  // A physical printer can serve several stations (e.g. one device printing
  // both kitchen tickets and receipts), so station moves to a join table.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS printer_stations (
      printer_id uuid NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
      station "Station" NOT NULL,
      PRIMARY KEY (printer_id, station)
    );
  `);

  await knex.raw(`
    INSERT INTO printer_stations (printer_id, station)
    SELECT id, station FROM printers
    ON CONFLICT (printer_id, station) DO NOTHING;
  `);

  // Keep print history if a printer is removed later.
  await knex.raw(`ALTER TABLE print_jobs ALTER COLUMN printer_id DROP NOT NULL;`);
  await knex.raw(`ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_printer_id_fkey;`);
  await knex.raw(`ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_printer_id_foreign;`);
  await knex.raw(`
    ALTER TABLE print_jobs
      ADD CONSTRAINT print_jobs_printer_id_fkey
      FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE SET NULL;
  `);

  // The original seed shipped three placeholder IPs. Real printers are
  // discovered and added from Settings now, so remove those demo rows.
  await knex.raw(`
    DELETE FROM printers
     WHERE (name, ip_address) IN (
       ('Kitchen Printer', '192.168.1.50'),
       ('Bar Printer', '192.168.1.51'),
       ('Receipt Printer', '192.168.1.52')
     );
  `);

  await knex.raw(`ALTER TABLE printers DROP COLUMN station;`);
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE printers ADD COLUMN station "Station" NOT NULL DEFAULT 'NONE';`);
  await knex.raw(`
    UPDATE printers p
       SET station = COALESCE(
         (SELECT ps.station FROM printer_stations ps
           WHERE ps.printer_id = p.id
           ORDER BY CASE ps.station
                      WHEN 'KITCHEN' THEN 0
                      WHEN 'BAR' THEN 1
                      ELSE 2
                    END
           LIMIT 1),
         'NONE'::"Station");
  `);
  await knex.raw(`ALTER TABLE printers ALTER COLUMN station DROP DEFAULT;`);
  await knex.raw(`DROP TABLE IF EXISTS printer_stations;`);
};
