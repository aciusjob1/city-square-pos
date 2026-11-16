exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE products DROP COLUMN IF EXISTS is_available;`);
};
