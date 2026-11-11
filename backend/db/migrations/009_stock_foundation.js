/**
 * Stock foundation — physical inventory, receipts, recipes, counts.
 *
 * Design principles:
 *   - stock_movements is the single source of truth for physical stock
 *   - menu products are distinct from stock items (recipes link them)
 *   - no cached balances; the ledger is authoritative
 *   - existing `inventory` table is NOT touched (empty, unused, kept for
 *     backward compatibility; may be repurposed as cache in future)
 */

exports.up = async function (knex) {
  // ----------------------------------------------------------------
  // 1. suppliers — minimal: name + optional contact
  // ----------------------------------------------------------------
  await knex.schema.createTable('suppliers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('name').notNullable().unique();
    t.text('phone');
    t.text('notes');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // ----------------------------------------------------------------
  // 2. stock_items — physical inventory (Sato, Chicken, Meat, ...)
  // ----------------------------------------------------------------
  await knex.schema.createTable('stock_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('name').notNullable().unique();
    t.text('base_unit').notNullable();
    t.decimal('reorder_level', 12, 2).notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE stock_items
      ADD CONSTRAINT stock_items_base_unit_check
      CHECK (base_unit IN ('G', 'ML', 'PIECES'));
  `);

  // ----------------------------------------------------------------
  // 3. stock_receipts — one row per delivery
  // ----------------------------------------------------------------
  await knex.schema.createTable('stock_receipts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('stock_item_id').notNullable().references('id').inTable('stock_items');
    t.uuid('supplier_id').references('id').inTable('suppliers');
    t.timestamp('received_at').notNullable();
    t.decimal('quantity', 12, 2).notNullable();
    t.text('notes');
    t.uuid('recorded_by_id').notNullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE stock_receipts
      ADD CONSTRAINT stock_receipts_quantity_positive
      CHECK (quantity > 0);
  `);
  await knex.schema.alterTable('stock_receipts', (t) => {
    t.index(['stock_item_id', 'received_at'], 'stock_receipts_item_received_idx');
  });

  // ----------------------------------------------------------------
  // 4. stock_recipes — how much stock each menu product consumes
  // ----------------------------------------------------------------
  await knex.schema.createTable('stock_recipes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('menu_product_id').notNullable().references('id').inTable('products');
    t.uuid('stock_item_id').notNullable().references('id').inTable('stock_items');
    t.decimal('quantity_per_unit', 12, 2).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE stock_recipes
      ADD CONSTRAINT stock_recipes_product_item_unique
      UNIQUE (menu_product_id, stock_item_id);
  `);
  await knex.raw(`
    ALTER TABLE stock_recipes
      ADD CONSTRAINT stock_recipes_qty_positive
      CHECK (quantity_per_unit > 0);
  `);

  // ----------------------------------------------------------------
  // 5. stock_counts — physical count corrections
  // ----------------------------------------------------------------
  await knex.schema.createTable('stock_counts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('stock_item_id').notNullable().references('id').inTable('stock_items');
    t.timestamp('counted_at').notNullable();
    t.decimal('counted_quantity', 12, 2).notNullable();
    t.decimal('system_quantity', 12, 2).notNullable();
    t.text('reason');
    t.uuid('recorded_by_id').notNullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE stock_counts
      ADD CONSTRAINT stock_counts_counted_nonneg
      CHECK (counted_quantity >= 0);
  `);
  await knex.raw(`
    ALTER TABLE stock_counts
      ADD CONSTRAINT stock_counts_system_nonneg
      CHECK (system_quantity >= 0);
  `);
  await knex.raw(`
    ALTER TABLE stock_counts
      ADD COLUMN difference NUMERIC(12,2)
      GENERATED ALWAYS AS (counted_quantity - system_quantity) STORED;
  `);

  // ----------------------------------------------------------------
  // 6. Extend stock_movements
  // ----------------------------------------------------------------
  await knex.raw(`
    ALTER TABLE stock_movements ALTER COLUMN product_id DROP NOT NULL;
  `);
  await knex.schema.alterTable('stock_movements', (t) => {
    t.uuid('stock_item_id').references('id').inTable('stock_items');
    t.text('unit');
    t.uuid('reference_order_item_id').references('id').inTable('order_items');
    t.uuid('reference_stock_receipt_id').references('id').inTable('stock_receipts');
    t.uuid('reference_stock_count_id').references('id').inTable('stock_counts');
  });
  await knex.schema.alterTable('stock_movements', (t) => {
    t.index(['stock_item_id', 'created_at'], 'stock_movements_item_created_idx');
  });
  await knex.raw(`
    ALTER TABLE stock_movements
      ADD CONSTRAINT stock_movements_subject_xor
      CHECK (
        (product_id IS NOT NULL AND stock_item_id IS NULL)
        OR
        (product_id IS NULL AND stock_item_id IS NOT NULL)
      );
  `);
};

exports.down = async function (knex) {
  // stock_movements — reverse the extension
  await knex.raw(`
    ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_subject_xor;
  `);
  await knex.schema.alterTable('stock_movements', (t) => {
    t.dropIndex(['stock_item_id', 'created_at'], 'stock_movements_item_created_idx');
  });
  await knex.schema.alterTable('stock_movements', (t) => {
    t.dropColumn('reference_stock_count_id');
    t.dropColumn('reference_stock_receipt_id');
    t.dropColumn('reference_order_item_id');
    t.dropColumn('unit');
    t.dropColumn('stock_item_id');
  });
  await knex.raw(`
    ALTER TABLE stock_movements ALTER COLUMN product_id SET NOT NULL;
  `);

  // Drop new tables in reverse dependency order
  await knex.schema.dropTableIfExists('stock_counts');
  await knex.schema.dropTableIfExists('stock_recipes');
  await knex.schema.dropTableIfExists('stock_receipts');
  await knex.schema.dropTableIfExists('stock_items');
  await knex.schema.dropTableIfExists('suppliers');
};
