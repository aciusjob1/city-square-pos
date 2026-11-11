exports.up = async function (knex) {
  // Add printer type column: NETWORK (current, TCP-based) or OS (Electron-managed).
  // Default 'NETWORK' so all existing rows get a valid value with no backfill.
  await knex.raw(`
    ALTER TABLE printers
      ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'NETWORK';
  `);

  // Constrain to the two supported values. Scoped to the printers relation
  // via conrelid — a global conname match would collide with any other
  // constraint named 'printers_type_check' in a different schema or table.
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'printers_type_check'
           AND conrelid = 'printers'::regclass
      ) THEN
        ALTER TABLE printers
          ADD CONSTRAINT printers_type_check
          CHECK (type IN ('NETWORK', 'OS'));
      END IF;
    END $$;
  `);
};

exports.down = async function (knex) {
  // Constraint is dropped before the column to avoid depending on
  // Postgres's implicit cascade behavior across versions.
  await knex.raw(`
    ALTER TABLE printers DROP CONSTRAINT IF EXISTS printers_type_check;
  `);
  await knex.raw(`ALTER TABLE printers DROP COLUMN IF EXISTS type;`);
};
