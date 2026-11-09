const bcrypt = require('bcryptjs');

exports.seed = async function (knex) {
  // Clear in reverse-dependency order (safe on fresh DB, allows re-runs)
  const delOrder = [
    'sync_events','audit_logs','shifts','expenses','stock_movements',
    'inventory','print_jobs','refunds','payments','order_items','orders',
    'products','devices','waiters','users','printers','payment_methods',
    'tables','categories','roles','settings',
  ];
  for (const t of delOrder) await knex(t).del();

  // Roles
  await knex('roles').insert([
    { name: 'ADMIN',    description: 'System administrator' },
    { name: 'MANAGER',  description: 'Restaurant manager'   },
    { name: 'CASHIER',  description: 'Cashier'              },
    { name: 'WAITER',   description: 'Waiter'               },
    { name: 'KITCHEN',  description: 'Kitchen staff'        },
  ]);
  const roles = await knex('roles').select('id','name');
  const role = (n) => roles.find(r => r.name === n).id;

  // Users
  const adminHash   = await bcrypt.hash('admin123', 10);
  const managerHash = await bcrypt.hash('manager123', 10);
  const waiterHash  = await bcrypt.hash('waiter123', 10);

  await knex('users').insert([
    { username: 'admin',   password_hash: adminHash,   full_name: 'System Admin',       role_id: role('ADMIN')   },
    { username: 'manager', password_hash: managerHash, full_name: 'Restaurant Manager', role_id: role('MANAGER') },
    { username: 'john',    password_hash: waiterHash,  full_name: 'John Waiter',        role_id: role('WAITER')  },
  ]);
  const john = await knex('users').where({ username: 'john' }).first();
  await knex('waiters').insert({ user_id: john.id, code: 'WAIT-001' });

  // Device bound to John's phone
  await knex('devices').insert({
    name: 'Waiter Phone - John',
    device_identifier: 'ANDROID-001',
    device_type: 'ANDROID_PHONE',
    assigned_waiter_id: john.id,
  });

  // Payment methods
  await knex('payment_methods').insert([
    { code: 'CASH',         name: 'Cash'         },
    { code: 'MPESA',        name: 'M-Pesa'       },
    { code: 'TIGO_PESA',    name: 'Tigo Pesa'    },
    { code: 'AIRTEL_MONEY', name: 'Airtel Money' },
  ]);

  // Categories
  await knex('categories').insert([
    { name: 'Food',    sort_order: 1 },
    { name: 'Meat',    sort_order: 2 },
    { name: 'Fish',    sort_order: 3 },
    { name: 'Chicken', sort_order: 4 },
    { name: 'Drinks',  sort_order: 5 },
    { name: 'Juices',  sort_order: 6 },
  ]);
  const cats = await knex('categories').select('id','name');
  const cat  = (n) => cats.find(c => c.name === n).id;

  // Products
  await knex('products').insert([
    { category_id: cat('Food'),    name: 'Wali (Rice)',        sku: 'F001', selling_price: 5000,  cost_price: 2000, preparation_station: 'KITCHEN' },
    { category_id: cat('Food'),    name: 'Ugali',              sku: 'F002', selling_price: 3000,  cost_price: 1000, preparation_station: 'KITCHEN' },
    { category_id: cat('Food'),    name: 'Chips',              sku: 'F003', selling_price: 5000,  cost_price: 2000, preparation_station: 'KITCHEN' },
    { category_id: cat('Meat'),    name: 'Nyama ya Mbuzi',     sku: 'M001', selling_price: 12000, cost_price: 7000, preparation_station: 'KITCHEN' },
    { category_id: cat('Meat'),    name: 'Nyama ya Ngombe',    sku: 'M002', selling_price: 10000, cost_price: 6000, preparation_station: 'KITCHEN' },
    { category_id: cat('Fish'),    name: 'Samaki',             sku: 'S001', selling_price: 15000, cost_price: 9000, preparation_station: 'KITCHEN' },
    { category_id: cat('Chicken'), name: 'Kuku',               sku: 'C001', selling_price: 12000, cost_price: 7000, preparation_station: 'KITCHEN' },
    { category_id: cat('Drinks'),  name: 'Soda',               sku: 'D001', selling_price: 1500,  cost_price: 800,  preparation_station: 'BAR'     },
    { category_id: cat('Drinks'),  name: 'Maji (Water)',       sku: 'D002', selling_price: 1000,  cost_price: 500,  preparation_station: 'BAR'     },
    { category_id: cat('Juices'),  name: 'Juice ya Embe',      sku: 'J001', selling_price: 4000,  cost_price: 1500, preparation_station: 'BAR'     },
    { category_id: cat('Juices'),  name: 'Juice ya Machungwa', sku: 'J002', selling_price: 4000,  cost_price: 1500, preparation_station: 'BAR'     },
  ]);

  // Tables
  const tables = [];
  for (let i = 1; i <= 10; i++) tables.push({ name: `Table ${i}`, capacity: 4, area: 'Main' });
  await knex('tables').insert(tables);

  // Printers (placeholder IPs — set real ones after hardware confirmation)
  await knex('printers').insert([
    { name: 'Kitchen Printer', ip_address: '192.168.1.50', port: 9100, station: 'KITCHEN' },
    { name: 'Bar Printer',     ip_address: '192.168.1.51', port: 9100, station: 'BAR'     },
  ]);

  // Settings
  await knex('settings').insert([
    { key: 'restaurant_name', value: JSON.stringify('City Square Restaurant') },
    { key: 'currency',        value: JSON.stringify('TZS')                    },
    { key: 'timezone',        value: JSON.stringify('Africa/Dar_es_Salaam')   },
  ]);

  console.log('✅ Seed complete');
};
