exports.up = async function (knex) {
  // Enum types
  await knex.raw(`
    CREATE TYPE "RoleName" AS ENUM ('ADMIN','MANAGER','CASHIER','WAITER','KITCHEN');
    CREATE TYPE "DeviceType" AS ENUM ('ANDROID_PHONE','CASHIER_PC','MANAGER_PC','OTHER');
    CREATE TYPE "OrderType" AS ENUM ('DINE_IN','TAKEAWAY','DELIVERY');
    CREATE TYPE "OrderStatus" AS ENUM ('OPEN','SENT_TO_KITCHEN','PREPARING','READY','SERVED','PAID','CANCELLED');
    CREATE TYPE "SyncStatus" AS ENUM ('PENDING','SYNCED','CONFLICT');
    CREATE TYPE "Station" AS ENUM ('KITCHEN','BAR','NONE');
    CREATE TYPE "PrintTicketType" AS ENUM ('KITCHEN','BAR','RECEIPT');
    CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING','PROCESSING','SENT','CONFIRMED','FAILED','UNKNOWN');
    CREATE TYPE "StockMovementReason" AS ENUM ('PURCHASE','SALE','ADJUSTMENT','WASTAGE','RETURN');
    CREATE TYPE "SyncDirection" AS ENUM ('INBOUND','OUTBOUND');
    CREATE TYPE "SyncEventStatus" AS ENUM ('PENDING','APPLIED','CONFLICT','FAILED');
  `);

  // Lookup tables
  await knex.schema.createTable('roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.enu('name', null, { useNative: true, existingType: true, enumName: 'RoleName' }).unique().notNullable();
    t.text('description');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('categories', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('name').unique().notNullable();
    t.integer('sort_order').defaultTo(0);
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('tables', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('name').unique().notNullable();
    t.integer('capacity').defaultTo(4);
    t.text('area');
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('payment_methods', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('code').unique().notNullable();
    t.text('name').notNullable();
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('printers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('name').notNullable();
    t.text('ip_address').notNullable();
    t.integer('port').defaultTo(9100);
    t.enu('station', null, { useNative: true, existingType: true, enumName: 'Station' }).notNullable();
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('username').unique().notNullable();
    t.text('email').unique();
    t.text('password_hash').notNullable();
    t.text('full_name').notNullable();
    t.uuid('role_id').references('id').inTable('roles').notNullable();
    t.boolean('is_active').defaultTo(true);
    t.timestamp('last_login_at');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('waiters', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').unique().references('id').inTable('users').notNullable();
    t.text('code').unique().notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('devices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('name').notNullable();
    t.text('device_identifier').unique().notNullable();
    t.enu('device_type', null, { useNative: true, existingType: true, enumName: 'DeviceType' }).defaultTo('ANDROID_PHONE');
    t.uuid('assigned_waiter_id').references('id').inTable('users');
    t.boolean('is_active').defaultTo(true);
    t.timestamp('last_seen_at');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('products', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('category_id').references('id').inTable('categories').notNullable();
    t.text('name').notNullable();
    t.text('sku').unique();
    t.decimal('selling_price', 12, 2).notNullable();
    t.decimal('cost_price', 12, 2).defaultTo(0);
    t.enu('preparation_station', null, { useNative: true, existingType: true, enumName: 'Station' }).defaultTo('KITCHEN');
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('order_number').unique().notNullable();
    t.uuid('waiter_id').references('id').inTable('users').notNullable();
    t.uuid('table_id').references('id').inTable('tables');
    t.enu('order_type', null, { useNative: true, existingType: true, enumName: 'OrderType' }).defaultTo('DINE_IN');
    t.enu('status', null, { useNative: true, existingType: true, enumName: 'OrderStatus' }).defaultTo('OPEN');
    t.decimal('subtotal', 12, 2).defaultTo(0);
    t.decimal('discount_amount', 12, 2).defaultTo(0);
    t.decimal('total_amount', 12, 2).defaultTo(0);
    t.decimal('paid_amount', 12, 2).defaultTo(0);
    t.text('currency').defaultTo('TZS');
    t.text('notes');
    t.uuid('device_id').references('id').inTable('devices');
    t.text('client_uuid').unique().notNullable();
    t.enu('sync_status', null, { useNative: true, existingType: true, enumName: 'SyncStatus' }).defaultTo('SYNCED');
    t.timestamp('client_created_at').notNullable();
    t.timestamp('server_created_at').defaultTo(knex.fn.now());
    t.timestamp('cancelled_at');
    t.uuid('cancelled_by');
    t.text('cancellation_reason');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index(['waiter_id', 'created_at']);
    t.index(['status']);
  });

  await knex.schema.createTable('order_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('order_id').references('id').inTable('orders').onDelete('CASCADE').notNullable();
    t.uuid('product_id').references('id').inTable('products').notNullable();
    t.integer('quantity').defaultTo(1);
    t.decimal('unit_price', 12, 2).notNullable();
    t.decimal('line_total', 12, 2).notNullable();
    t.enu('station', null, { useNative: true, existingType: true, enumName: 'Station' }).defaultTo('KITCHEN');
    t.text('notes');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('payments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('order_id').references('id').inTable('orders').notNullable();
    t.uuid('payment_method_id').references('id').inTable('payment_methods').notNullable();
    t.decimal('amount', 12, 2).notNullable();
    t.text('reference');
    t.uuid('processed_by_id').references('id').inTable('users').notNullable();
    t.text('client_uuid').unique().notNullable();
    t.enu('sync_status', null, { useNative: true, existingType: true, enumName: 'SyncStatus' }).defaultTo('SYNCED');
    t.timestamp('paid_at').defaultTo(knex.fn.now());
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('refunds', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('payment_id').references('id').inTable('payments').notNullable();
    t.decimal('amount', 12, 2).notNullable();
    t.text('reason').notNullable();
    t.uuid('approved_by_id').references('id').inTable('users').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('print_jobs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('order_id').references('id').inTable('orders').notNullable();
    t.uuid('printer_id').references('id').inTable('printers').notNullable();
    t.enu('ticket_type', null, { useNative: true, existingType: true, enumName: 'PrintTicketType' }).notNullable();
    t.text('payload').notNullable();
    t.enu('status', null, { useNative: true, existingType: true, enumName: 'PrintJobStatus' }).defaultTo('PENDING');
    t.integer('attempts').defaultTo(0);
    t.text('last_error');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('sent_at');
    t.timestamp('printed_at');
    t.index(['status']);
  });

  await knex.schema.createTable('inventory', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('product_id').unique().references('id').inTable('products').notNullable();
    t.decimal('quantity_on_hand', 12, 2).defaultTo(0);
    t.decimal('reorder_level', 12, 2).defaultTo(0);
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('stock_movements', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('product_id').references('id').inTable('products').notNullable();
    t.decimal('quantity_change', 12, 2).notNullable();
    t.enu('reason', null, { useNative: true, existingType: true, enumName: 'StockMovementReason' }).notNullable();
    t.uuid('reference_order_id');
    t.uuid('recorded_by_id').references('id').inTable('users').notNullable();
    t.text('notes');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('expenses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('category').notNullable();
    t.text('description').notNullable();
    t.decimal('amount', 12, 2).notNullable();
    t.uuid('recorded_by_id').references('id').inTable('users').notNullable();
    t.timestamp('expense_date').defaultTo(knex.fn.now());
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('shifts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').references('id').inTable('users').notNullable();
    t.timestamp('opened_at').defaultTo(knex.fn.now());
    t.timestamp('closed_at');
    t.decimal('opening_cash', 12, 2).defaultTo(0);
    t.decimal('closing_cash', 12, 2);
    t.decimal('expected_cash', 12, 2);
    t.decimal('cash_variance', 12, 2);
    t.text('notes');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('actor_user_id').references('id').inTable('users');
    t.text('action').notNullable();
    t.text('entity_type').notNullable();
    t.text('entity_id');
    t.jsonb('before');
    t.jsonb('after');
    t.text('ip_address');
    t.text('device_id');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['entity_type', 'entity_id']);
  });

  await knex.schema.createTable('sync_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('device_id').references('id').inTable('devices').notNullable();
    t.text('entity_type').notNullable();
    t.text('entity_id').notNullable();
    t.enu('direction', null, { useNative: true, existingType: true, enumName: 'SyncDirection' }).notNullable();
    t.enu('status', null, { useNative: true, existingType: true, enumName: 'SyncEventStatus' }).defaultTo('PENDING');
    t.jsonb('payload').notNullable();
    t.text('error');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('processed_at');
  });

  await knex.schema.createTable('settings', (t) => {
    t.text('key').primary();
    t.jsonb('value').notNullable();
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  const tables = [
    'sync_events','audit_logs','shifts','expenses','stock_movements',
    'inventory','print_jobs','refunds','payments','order_items','orders',
    'products','devices','waiters','users','printers','payment_methods',
    'tables','categories','roles','settings',
  ];
  for (const tbl of tables) {
    await knex.schema.dropTableIfExists(tbl);
  }
  const enums = [
    'RoleName','DeviceType','OrderType','OrderStatus','SyncStatus','Station',
    'PrintTicketType','PrintJobStatus','StockMovementReason','SyncDirection','SyncEventStatus',
  ];
  for (const e of enums) {
    await knex.raw(`DROP TYPE IF EXISTS "${e}"`);
  }
};
