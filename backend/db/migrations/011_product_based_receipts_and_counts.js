/**
 * 8.8b — Product-based receipts and counts (integer-only stock model).
 *
 * The 8.8a schema modeled stock receipts/counts against `stock_items`
 * (physical inventory). The approved MVP tracking model is simpler:
 * each menu product IS a stock unit. So receipts and counts must
 * reference `products.id` directly, exactly like `stock_movements`
 * already does via its nullable `product_id` column.
 *
 * This migration:
 *   - adds nullable `product_id` to stock_receipts and stock_counts
 *   - makes `stock_item_id` nullable on both (was NOT NULL from 8.8a)
 *   - adds XOR check: exactly one of product_id / stock_item_id
 *   - adds FKs to products(id)
 *   - preserves all existing FKs (movements->receipts, movements->counts)
 *   - preserves all existing CHECK constraints
 *   - leaves stock_items / stock_recipes empty and unused
 */

exports.up = async function (knex) {
  // ----------------------------------------------------------------
  // stock_receipts — add product_id, relax stock_item_id
  // ----------------------------------------------------------------
  await knex.raw(`
    ALTER TABLE stock_receipts
      ALTER COLUMN stock_item_id DROP NOT NULL;
  `);
  await knex.schema.alterTable('stock_receipts', (t) => {
    t.uuid('product_id').references('id').inTable('products');
  });
  await knex.raw(`
    ALTER TABLE stock_receipts
      ADD CONSTRAINT stock_receipts_subject_xor
      CHECK (
        (product_id IS NOT NULL AND stock_item_id IS NULL)
        OR
        (product_id IS NULL AND stock_item_id IS NOT NULL)
      );
  `);
  await knex.schema.alterTable('stock_receipts', (t) => {
    t.index(['product_id', 'received_at'], 'stock_receipts_product_received_idx');
  });

  // ----------------------------------------------------------------
  // stock_counts — same treatment
  // ----------------------------------------------------------------
  await knex.raw(`
    ALTER TABLE stock_counts
      ALTER COLUMN stock_item_id DROP NOT NULL;
  `);
  await knex.schema.alterTable('stock_counts', (t) => {
    t.uuid('product_id').references('id').inTable('products');
  });
  await knex.raw(`
    ALTER TABLE stock_counts
      ADD CONSTRAINT stock_counts_subject_xor
      CHECK (
        (product_id IS NOT NULL AND stock_item_id IS NULL)
        OR
        (product_id IS NULL AND stock_item_id IS NOT NULL)
      );
  `);
};

exports.down = async function (knex) {
  // Guard: refuse rollback if any product-based receipts/counts exist
  const receiptsWithProduct = await knex.raw(`
    SELECT COUNT(*)::text AS n FROM stock_receipts WHERE product_id IS NOT NULL;
  `);
  const countsWithProduct = await knex.raw(`
    SELECT COUNT(*)::text AS n FROM stock_counts WHERE product_id IS NOT NULL;
  `);
  const rCount = parseInt(receiptsWithProduct.rows[0].n, 10);
  const cCount = parseInt(countsWithProduct.rows[0].n, 10);

  if (rCount > 0 || cCount > 0) {
    throw new Error(
      `Cannot rollback 011: ${rCount} product-based stock receipt(s), ${cCount} product-based stock count(s) exist. ` +
      `Refusing to silently lose data.`,
    );
  }

  // stock_receipts — reverse
  await knex.schema.alterTable('stock_receipts', (t) => {
    t.dropIndex(['product_id', 'received_at'], 'stock_receipts_product_received_idx');
  });
  await knex.raw(`
    ALTER TABLE stock_receipts DROP CONSTRAINT IF EXISTS stock_receipts_subject_xor;
  `);
  await knex.schema.alterTable('stock_receipts', (t) => {
    t.dropColumn('product_id');
  });
  await knex.raw(`
    ALTER TABLE stock_receipts ALTER COLUMN stock_item_id SET NOT NULL;
  `);

  // stock_counts — reverse
  await knex.raw(`
    ALTER TABLE stock_counts DROP CONSTRAINT IF EXISTS stock_counts_subject_xor;
  `);
  await knex.schema.alterTable('stock_counts', (t) => {
    t.dropColumn('product_id');
  });
  await knex.raw(`
    ALTER TABLE stock_counts ALTER COLUMN stock_item_id SET NOT NULL;
  `);
};
