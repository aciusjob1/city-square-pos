/**
 * 8.8c-2 — products.stock_managed flag.
 *
 * Opt-in marker for which products are tracked in stock.
 * - true  → appears in Stock tab, balance tracked via stock_movements,
 *           will be blocked from ordering when balance exhausted (8.8c-3)
 * - false → not stock-tracked, always orderable (default for all existing
 *           products, preserves current behavior)
 *
 * Rollback guard refuses if any product has stock_managed = true —
 * prevents silent loss of configured state.
 */

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE products
      ADD COLUMN stock_managed BOOLEAN NOT NULL DEFAULT false;
  `);
};

exports.down = async function (knex) {
  const managed = await knex.raw(`
    SELECT COUNT(*)::text AS n FROM products WHERE stock_managed = true;
  `);
  const count = parseInt(managed.rows[0].n, 10);
  if (count > 0) {
    throw new Error(
      `Cannot rollback 013: ${count} product(s) have stock_managed = true. ` +
      `Un-manage all products before rolling back.`,
    );
  }
  await knex.raw(`ALTER TABLE products DROP COLUMN IF EXISTS stock_managed;`);
};
