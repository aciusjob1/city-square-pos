exports.up = async function (knex) {
  // OS-managed printers have no IP address; only NETWORK printers do.
  await knex.raw(`ALTER TABLE printers ALTER COLUMN ip_address DROP NOT NULL;`);
};

exports.down = async function (knex) {
  await knex.raw(`UPDATE printers SET ip_address = '0.0.0.0' WHERE ip_address IS NULL;`);
  await knex.raw(`ALTER TABLE printers ALTER COLUMN ip_address SET NOT NULL;`);
};
