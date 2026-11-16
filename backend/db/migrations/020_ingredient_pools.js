/**
 * Ingredient pools — shared raw stock behind menu products.
 *
 * Reuses the 8.8a foundation: `stock_items` are the pools (Sato meat,
 * cooking oil, ...), `stock_recipes` link a menu product to a pool with
 * the quantity consumed per plate. Pool balances live in stock_movements
 * with stock_item_id set.
 *
 * Changes:
 *   - fractional movements are allowed for pools (products stay integer)
 *   - one SALE movement per (order item, pool) keeps payment retries from
 *     double-deducting
 *   - reverse lookup index for "which dishes use this pool"
 */

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_quantity_integer;
  `);
  await knex.raw(`
    ALTER TABLE stock_movements
      ADD CONSTRAINT stock_movements_quantity_integer
      CHECK (product_id IS NULL OR quantity_change = floor(quantity_change));
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_pool_sale_uidx
      ON stock_movements (reference_order_item_id, stock_item_id)
      WHERE reference_order_item_id IS NOT NULL
        AND stock_item_id IS NOT NULL
        AND reason = 'SALE';
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS stock_recipes_stock_item_idx
      ON stock_recipes (stock_item_id);
  `);
};

exports.down = async function (knex) {
  const fractional = await knex.raw(`
    SELECT COUNT(*)::text AS n
      FROM stock_movements
     WHERE stock_item_id IS NOT NULL
       AND quantity_change <> floor(quantity_change);
  `);
  if (parseInt(fractional.rows[0].n, 10) > 0) {
    throw new Error(
      'Cannot rollback 020: fractional pool movements exist. Remove them first.',
    );
  }

  await knex.raw(`DROP INDEX IF EXISTS stock_recipes_stock_item_idx;`);
  await knex.raw(`DROP INDEX IF EXISTS stock_movements_pool_sale_uidx;`);
  await knex.raw(`
    ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_quantity_integer;
  `);
  await knex.raw(`
    ALTER TABLE stock_movements
      ADD CONSTRAINT stock_movements_quantity_integer
      CHECK (quantity_change = floor(quantity_change));
  `);
};
