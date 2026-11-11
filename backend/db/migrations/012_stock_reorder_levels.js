/**
 * 8.8c-1 — Reorder levels + integer-only enforcement on stock quantities.
 *
 * 1. Adds products.reorder_level INTEGER NOT NULL DEFAULT 0 with non-negative check.
 * 2. Enforces integer-only quantity on stock_movements.quantity_change — the
 *    sole column written in the MVP stock model.
 *
 * This makes "integer-only stock" a database guarantee, not an application
 * convention. stock_receipts and stock_counts are not touched in this slice
 * (not used by MVP restock flow).
 */

exports.up = async function (knex) {
  // 1. products.reorder_level
  await knex.raw(`
    ALTER TABLE products
      ADD COLUMN reorder_level INTEGER NOT NULL DEFAULT 0;
  `);
  await knex.raw(`
    ALTER TABLE products
      ADD CONSTRAINT products_reorder_level_nonneg
      CHECK (reorder_level >= 0);
  `);

  // 2. Integer-only quantity on the sole MVP stock column
  await knex.raw(`
    ALTER TABLE stock_movements
      ADD CONSTRAINT stock_movements_quantity_integer
      CHECK (quantity_change = FLOOR(quantity_change));
  `);
};

exports.down = async function (knex) {
  // Guard 1: refuse if any configured reorder levels would be lost
  const configured = await knex.raw(`
    SELECT COUNT(*)::text AS n FROM products WHERE reorder_level <> 0;
  `);
  const configuredCount = parseInt(configured.rows[0].n, 10);
  if (configuredCount > 0) {
    throw new Error(
      `Cannot rollback 012: ${configuredCount} product(s) have a non-zero reorder_level. ` +
      `Reset all configured thresholds to 0 before rolling back.`,
    );
  }

  // Guard 2: refuse if any fractional quantities exist
  const frac = await knex.raw(`
    SELECT COUNT(*)::text AS n FROM stock_movements
     WHERE quantity_change <> FLOOR(quantity_change);
  `);
  const fracCount = parseInt(frac.rows[0].n, 10);
  if (fracCount > 0) {
    throw new Error(
      `Cannot rollback 012: ${fracCount} fractional quantity_change value(s) exist. ` +
      `Refusing to silently break data.`,
    );
  }

  await knex.raw(`ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_quantity_integer`);
  await knex.raw(`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_reorder_level_nonneg`);
  await knex.raw(`ALTER TABLE products DROP COLUMN IF EXISTS reorder_level`);
};
