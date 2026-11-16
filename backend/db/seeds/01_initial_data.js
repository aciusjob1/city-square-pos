const bcrypt = require('bcryptjs');
const crypto = require('crypto');

exports.seed = async function (knex) {
  // Clear in reverse-dependency order (safe on fresh DB, allows re-runs)
  const delOrder = [
    'sync_events','audit_logs','shifts','expenses','stock_movements',
    'inventory','print_jobs','printer_stations','refunds','payments','order_items','orders',
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
  // NOTE: these are demo credentials for local development only.
  // Change every password and PIN before exposing this seed to real users.
  const adminHash   = await bcrypt.hash('admin123', 10);
  const managerHash = await bcrypt.hash('manager123', 10);
  const waiterHash  = await bcrypt.hash('waiter123', 10);
  const kitchenHash = await bcrypt.hash('kitchen-test-password', 10);
  const johnPinHash  = await bcrypt.hash('1234', 10);
  const fatmaPinHash = await bcrypt.hash('1235', 10);

  // PIN lookup is a deterministic hash keyed by PIN_PEPPER (falls back to
  // JWT_SECRET, matching auth-pin.service).
  const jwtSecret = process.env.JWT_SECRET || 'dev-only-change-me';
  const pinPepper = process.env.PIN_PEPPER || jwtSecret;
  const pinLookup = (pin) =>
    crypto.createHash('sha256').update(pin + ':' + pinPepper).digest('hex');

  await knex('users').insert([
    { username: 'admin',        password_hash: adminHash,   full_name: 'System Admin',       role_id: role('ADMIN')   },
    { username: 'manager',      password_hash: managerHash, full_name: 'Restaurant Manager', role_id: role('MANAGER') },
    { username: 'cashier1',     password_hash: waiterHash,  full_name: 'Cashier One',        role_id: role('CASHIER') },
    { username: 'kitchen-test', password_hash: kitchenHash, full_name: 'Kitchen Staff',      role_id: role('KITCHEN') },
    {
      username: 'john', password_hash: waiterHash, full_name: 'John Waiter', role_id: role('WAITER'),
      pin_hash: johnPinHash, pin_lookup: pinLookup('1234'), pin_set_at: new Date(),
    },
    {
      username: 'fatma', password_hash: waiterHash, full_name: 'Fatma Waiter', role_id: role('WAITER'),
      pin_hash: fatmaPinHash, pin_lookup: pinLookup('1235'), pin_set_at: new Date(),
    },
  ]);
  const john = await knex('users').where({ username: 'john' }).first();
  const fatma = await knex('users').where({ username: 'fatma' }).first();
  await knex('waiters').insert([
    { user_id: john.id,  code: 'WAIT-001' },
    { user_id: fatma.id, code: 'WAIT-002' },
  ]);

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
    { name: 'BREAKFAST',       sort_order: 1  },
    { name: 'SOUP',            sort_order: 2  },
    { name: 'BUFFET',          sort_order: 3  },
    { name: 'BBQ',             sort_order: 4  },
    { name: 'COFFEE',          sort_order: 5  },
    { name: 'HERBAL TEA',      sort_order: 6  },
    { name: 'ICE CREAM',       sort_order: 7  },
    { name: 'SOFT DRINK',      sort_order: 8  },
    { name: 'JUICE WITH SUGAR', sort_order: 9 },
    { name: 'JUICE NON-SUGAR', sort_order: 10 },
    { name: 'FRUIT',           sort_order: 11 },
  ]);
  const cats = await knex('categories').select('id','name');
  const cat  = (n) => cats.find(c => c.name === n).id;

  // Products — the shipped menu. Every row is a normal product, so prices,
  // names and categories can be edited later in Manager → Products.
  const MENU = {
    BREAKFAST: [
      ['Donat', 1000], ['Cutless', 2000], ['Eggchop', 2000], ['Kababu', 2000],
      ['Muhogo', 1000], ['Ndizi fried', 1000], ['Ndizi boiled', 1000],
      ['Kiazi kitamu', 1000], ['Boiled Egg', 1000], ['Ommlete Egg', 2500],
      ['Spanish Ommlete', 3000], ['Scrumble Egg', 3000], ['Kalmati', 1000],
      ['Kachori', 1000], ['Baghia', 1000], ['Chapati', 1000], ['Soseji', 2000],
      ['Samosa', 1500], ['Uji', 2000], ['Mtori', 5000], ['Andazi', 1000],
      ['Chapati brown', 1500], ['Kitumbua', 1000], ['Veg steamed', 4000],
    ],
    SOUP: [
      ['Mbuzi soup', 10000], ["Ng'ombe soup", 10000], ['Sato soup', 15000],
      ['Pweza soup', 10000], ['Sangara soup', 15000], ['Veg soup', 5000],
      ['Soup kienyeji 1/4', 12000], ['Soup kienyeji 1/2', 24000],
    ],
    BUFFET: [
      ['Chipsi kavu', 3000], ['Chipsi masala', 3000], ['Chipsi mayai', 4000],
      ['Ugali dona', 3000], ['Ugali sembe', 3000], ['Ugali mhogo', 3000],
      ['Wali', 4000], ['Pilau plain', 4000], ['Biriani plain', 5000],
      ['Veg rice', 4500], ['Ndizi roast plain', 3000], ['Ndizi roast nyama', 8000],
      ['Pilau nyama', 10000], ['Zamzam', 12000], ['Jasmine Mbuzi', 15000],
      ['Biriani kuku', 12000], ['Biriani Mbuzi', 12000], ['Chicken wings', 5000],
      ['Fried Chicken', 7000], ['Sekela chicken', 10000], ['Lemon chicken', 10000],
      ['Chicken makange', 8000], ['Bonless chicken', 10000], ['Chicken roast/Curry', 8000],
      ['Half chicken grilled', 10000], ['Whole chicken grilled', 20000],
      ['Chicken Vuruga', 10000], ['Local chicken', 12000], ['Chicken Mnavu', 12000],
      ['MIX VEG', 3000], ['Singapore rice', 4500], ['Combination rice', 12000],
      ['Macaron', 10000], ['Sparget plain', 5000], ['Majani ya maboga', 2500],
      ['Tembele', 2500], ['Viazi chips', 3000], ['Firigisi', 6000],
      ['Maini roast', 7000], ['Beef stew', 10000], ['Beef roast', 12000],
      ['Mbuzi roast', 12000], ['Mbuzi foil', 15000], ['Kisamvu', 2500],
      ['Utumbo roast', 7000], ['Chinese', 2000], ['Mchicha', 2000],
      ['Njegere', 3000], ['Maharage', 3000], ['Fish Masala', 15000],
      ['Tuna fish', 15000], ['Fish fillet', 15000], ['Kingfish grill', 15000],
      ['Jodari grill', 15000], ['Sato grill', 15000], ['Sato makange', 15000],
      ['Sato nazi', 15000], ['Sato fried', 15000], ['Pweza roast', 10000],
      ['Changu makange', 10000], ['Changu nazi', 12000], ['Changu grill', 10000],
      ['Changu fried', 8000], ['Dagaa', 5000],
    ],
    BBQ: [
      ['Mbuzi BBQ', 20000], ['Serengeti (firigisi & maini)', 20000],
      ['Morroco', 10000], ['Sato BBQ', 20000], ['Changu BBQ', 20000],
      ['Paper stake', 20000], ['T-BONE', 30000], ['SEA FOOD', 30000],
      ['Kienyeji 1/2 grilled', 24000], ['Kienyeji whole grilled', 48000],
    ],
    COFFEE: [
      ['Espresso single', 3000], ['Espresso double', 5000], ['Americano', 4000],
      ['Caffe latte', 5000], ['Coffee mocha', 5000], ['Zanzibar macchiato', 5000],
      ['Macchiato', 5000],
    ],
    'HERBAL TEA': [
      ['Mint tea with honey', 3000], ['Hot stepper', 3000],
      ['Masala tea (black/white)', 3000], ['Ginger tea (black/white)', 3000],
      ['Tanzanian tea (Strong tea)', 2000], ['White tea Big', 2000],
      ['White tea small', 1000], ['Black tea small', 1000], ['Hot milk', 3000],
      ['Green tea', 2000], ['Hot chocolate', 4000], ['Lemon gros', 2500],
      ['Hibiscus', 2500], ['Zanzibar Chai latte', 4000],
    ],
    'ICE CREAM': [
      ['Single scoop', 3000], ['Double scoop', 5000], ['Banana split', 5000],
      ['Espresso sundae', 6000], ['Strawberry sundae', 6000],
    ],
    'SOFT DRINK': [
      ['Soda', 1000], ['Soda take away', 1500], ['Maji ndogo', 1000],
      ['Maji kubwa', 1500], ['Lemon Juice', 4000],
    ],
    'JUICE WITH SUGAR': [
      ['Mango', 3000], ['Pineapple', 3000], ['Passion', 3000], ['Rozela', 3000],
      ['Betruit', 5000], ['Lemonade', 4000], ['Mojito', 4000],
      ['Mango smoothie', 6000], ['Mango Avocado', 6000],
      ['Mango pineapple smoothie', 6000], ['Tropical smoothie', 6000],
      ['Vanilla shake', 7000], ['Chocolate shake', 7000], ['Strawberry shake', 7000],
      ['Van chock shake', 7000], ['Stran van shake', 7000], ['Nutella shake', 7000],
      ['Tende shake', 7000], ['Booster shake', 7000], ['Espresso shake', 7000],
      ['Cold chocolate', 7000], ['Mocha shake', 7000], ['Banana shake', 7000],
      ['Cold latte', 6000],
    ],
    'JUICE NON-SUGAR': [
      ['Avodaco', 5000], ['Watermelon', 5000], ['Carrot', 5000],
      ['Cucumber', 5000], ['Orange', 5000], ['Papaya juice', 5000],
    ],
    FRUIT: [
      ['Fruit salad', 3000], ['Fruit Platter', 5000], ['Papai', 3000], ['Ndizi', 500],
    ],
  };

  const barCategories = new Set([
    'COFFEE', 'HERBAL TEA', 'ICE CREAM', 'SOFT DRINK',
    'JUICE WITH SUGAR', 'JUICE NON-SUGAR', 'FRUIT',
  ]);
  const menuRows = [];
  for (const [categoryName, items] of Object.entries(MENU)) {
    for (const [name, price] of items) {
      menuRows.push({
        category_id: cat(categoryName),
        name,
        selling_price: price,
        cost_price: 0,
        preparation_station: barCategories.has(categoryName) ? 'BAR' : 'KITCHEN',
      });
    }
  }
  await knex('products').insert(menuRows);

  // Tables
  const tables = [];
  for (let i = 1; i <= 10; i++) tables.push({ name: `Table ${i}`, capacity: 4, area: 'Main' });
  await knex('tables').insert(tables);

  // Printers are not seeded: each deployment discovers and adds the real
  // hardware from Settings → Printers.

  // Settings
  await knex('settings').insert([
    { key: 'restaurant_name', value: JSON.stringify('City Square Restaurant') },
    { key: 'currency',        value: JSON.stringify('TZS')                    },
    { key: 'timezone',        value: JSON.stringify('Africa/Dar_es_Salaam')   },
  ]);

  console.log('✅ Seed complete');
};
