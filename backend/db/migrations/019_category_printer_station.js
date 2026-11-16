exports.up = async function (knex) {
  // Per-category printer routing. When set, order lines in this category go
  // to this station's printer (KITCHEN / BAR, or NONE = receipt printer) even
  // if the product itself carries a different preparation station. NULL keeps
  // the old behaviour: each product's own preparation_station decides.
  await knex.raw(
    `ALTER TABLE categories ADD COLUMN IF NOT EXISTS printer_station "Station";`,
  );
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE categories DROP COLUMN IF EXISTS printer_station;`);
};
