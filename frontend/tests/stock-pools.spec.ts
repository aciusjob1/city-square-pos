import { test, expect, request } from '@playwright/test';
import { randomUUID } from 'crypto';
import { createRequire } from 'node:module';

const API = 'http://localhost:3000/api';
const MANAGER = { username: 'manager', password: 'manager123' };
const WAITER = { username: 'john', password: 'waiter123' };

const POOL_MARKER = 'POOLTEST-';

async function login(username: string, password: string): Promise<string> {
  const ctx = await request.newContext();
  const r = await ctx.post(`${API}/auth/login`, { data: { username, password } });
  if (!r.ok()) {
    throw new Error(`login(${username}) failed ${r.status()}: ${await r.text()}`);
  }
  const body = await r.json();
  await ctx.dispose();
  return body.accessToken as string;
}

async function api(
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
) {
  const ctx = await request.newContext();
  const r = await ctx.fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: data as any,
  });
  const body = await r.json().catch(() => ({}));
  await ctx.dispose();
  return { status: r.status(), body };
}

async function firstCategoryId(token: string): Promise<string> {
  const res = await api(token, 'GET', '/categories');
  return res.body.categories[0].id as string;
}

async function createProduct(token: string, categoryId: string): Promise<string> {
  const stamp = randomUUID().slice(0, 8);
  const res = await api(token, 'POST', '/products', {
    name: `${POOL_MARKER}dish-${stamp}`,
    sku: `POOL-${stamp}`,
    categoryId,
    sellingPrice: 1000,
    costPrice: 500,
    preparationStation: 'KITCHEN',
    // Pool deduction must work even when per-dish tracking is off.
    stockManaged: false,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`createProduct failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.id as string;
}

async function createPool(token: string, unit: 'G' | 'ML' | 'PIECES') {
  const res = await api(token, 'POST', '/stock/pools', {
    name: `${POOL_MARKER}${unit.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    unit,
    reorderLevel: unit === 'PIECES' ? 2 : 100,
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; name: string; unit: string };
}

async function restockPool(token: string, poolId: string, quantity: number) {
  return api(token, 'POST', `/stock/pools/${poolId}/restock`, { quantity });
}

async function linkDish(token: string, poolId: string, productId: string, qty: number) {
  return api(token, 'POST', `/stock/pools/${poolId}/recipes`, {
    productId,
    quantityPerUnit: qty,
  });
}

async function poolRow(token: string, poolId: string) {
  const res = await api(token, 'GET', '/stock/pools');
  expect(res.status).toBe(200);
  return res.body.pools.find((p: any) => p.id === poolId);
}

async function availabilityRow(token: string, productId: string) {
  const res = await api(token, 'GET', '/stock/availability');
  expect(res.status).toBe(200);
  return res.body.products.find((p: any) => p.productId === productId);
}

async function balanceRow(token: string, productId: string) {
  const res = await api(token, 'GET', '/stock/balances');
  expect(res.status).toBe(200);
  return res.body.balances.find((p: any) => p.productId === productId);
}

async function patchProduct(token: string, productId: string, data: unknown) {
  const res = await api(token, 'PATCH', `/products/${productId}`, data);
  expect([200, 201]).toContain(res.status);
  return res;
}

async function createOrder(
  waiterToken: string,
  items: Array<{ productId: string; quantity: number }>,
) {
  const res = await api(waiterToken, 'POST', '/orders', {
    clientUuid: randomUUID(),
    orderType: 'TAKEAWAY',
    items,
  });
  return res;
}

async function billOrder(token: string, orderId: string) {
  return api(token, 'POST', `/orders/${orderId}/bill`, {});
}

// Test fixtures are removed with a direct connection because the API has no
// way to delete a pool that already holds stock movements.
async function cleanupFixtures(): Promise<void> {
  try {
    const require = createRequire(import.meta.url);
    const { Client } = require('../../backend/node_modules/pg');
    const client = new Client({
      connectionString: 'postgresql://citysquare:citysquare@127.0.0.1:55432/citysquare',
    });
    await client.connect();
    try {
      await client.query(
        `DELETE FROM stock_movements
          WHERE stock_item_id IN (SELECT id FROM stock_items WHERE name LIKE '${POOL_MARKER}%')`,
      );
      await client.query(
        `DELETE FROM stock_recipes
          WHERE stock_item_id IN (SELECT id FROM stock_items WHERE name LIKE '${POOL_MARKER}%')`,
      );
      await client.query(`DELETE FROM stock_items WHERE name LIKE '${POOL_MARKER}%'`);
      await client.query(
        `DELETE FROM stock_movements
          WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'POOL-%')`,
      );
      await client.query(
        `DELETE FROM order_items
          WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'POOL-%')`,
      );
      await client.query(`DELETE FROM products WHERE sku LIKE 'POOL-%'`);
    } finally {
      await client.end();
    }
  } catch {
    // best-effort cleanup; tests must not fail because of it
  }
}

test.describe('stock ingredient pools', () => {
  test.afterAll(async () => {
    await cleanupFixtures();
  });

  test('1. piece pools stock whole pieces but allow fractional recipes', async () => {
    const manager = await login(MANAGER.username, MANAGER.password);
    const categoryId = await firstCategoryId(manager);
    const productId = await createProduct(manager, categoryId);
    const pool = await createPool(manager, 'PIECES');
    expect(pool.unit).toBe('PIECES');

    const fractionalStock = await restockPool(manager, pool.id, 0.5);
    expect(fractionalStock.status).toBe(400);
    expect(fractionalStock.body.code).toBe('POOL_INTEGER_REQUIRED');

    const wholeStock = await restockPool(manager, pool.id, 10);
    expect(wholeStock.status).toBe(201);

    // A dish may use part of a piece: quarter, half or whole.
    const quarterRecipe = await linkDish(manager, pool.id, productId, 0.25);
    expect(quarterRecipe.status).toBe(201);

    const halfRecipe = await linkDish(manager, pool.id, productId, 0.5);
    expect(halfRecipe.status).toBe(201);

    const list = await api(manager, 'GET', `/stock/pools/${pool.id}/recipes`);
    expect(list.status).toBe(200);
    expect(list.body.recipes[0].quantityPerUnit).toBe(0.5);

    const row = await poolRow(manager, pool.id);
    expect(row.physical).toBe(10);
    expect(row.unit).toBe('PIECES');
  });

  test('2. piece pool reserves whole pieces and blocks over-selling', async () => {
    const manager = await login(MANAGER.username, MANAGER.password);
    const waiter = await login(WAITER.username, WAITER.password);
    const categoryId = await firstCategoryId(manager);
    const productId = await createProduct(manager, categoryId);
    const pool = await createPool(manager, 'PIECES');
    expect((await restockPool(manager, pool.id, 10)).status).toBe(201);
    expect((await linkDish(manager, pool.id, productId, 2)).status).toBe(201);

    const order = await createOrder(waiter, [{ productId, quantity: 3 }]);
    expect(order.status).toBe(201);

    const reserved = await poolRow(manager, pool.id);
    expect(reserved.reserved).toBe(6);
    expect(reserved.available).toBe(4);

    const over = await createOrder(waiter, [{ productId, quantity: 3 }]);
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('INSUFFICIENT_POOL_STOCK');
    expect(over.body.insufficientPools[0].requested).toBe(6);
    expect(over.body.insufficientPools[0].available).toBe(4);

    const bill = await billOrder(waiter, order.body.id);
    expect(bill.status).toBe(201);

    const afterBill = await poolRow(manager, pool.id);
    expect(afterBill.physical).toBe(4);
    expect(afterBill.reserved).toBe(0);
    expect(afterBill.available).toBe(4);
  });

  test('3. weighted pools still accept decimal amounts', async () => {
    const manager = await login(MANAGER.username, MANAGER.password);
    const waiter = await login(WAITER.username, WAITER.password);
    const categoryId = await firstCategoryId(manager);
    const productId = await createProduct(manager, categoryId);
    const pool = await createPool(manager, 'G');
    expect((await restockPool(manager, pool.id, 500.5)).status).toBe(201);
    expect((await linkDish(manager, pool.id, productId, 2.5)).status).toBe(201);

    const order = await createOrder(waiter, [{ productId, quantity: 2 }]);
    expect(order.status).toBe(201);

    const reserved = await poolRow(manager, pool.id);
    expect(reserved.reserved).toBe(5);
    expect(reserved.available).toBe(495.5);

    expect((await billOrder(waiter, order.body.id)).status).toBe(201);
    const afterBill = await poolRow(manager, pool.id);
    expect(afterBill.physical).toBe(495.5);
  });

  test('4. billing twice does not deduct the pool twice', async () => {
    const manager = await login(MANAGER.username, MANAGER.password);
    const waiter = await login(WAITER.username, WAITER.password);
    const categoryId = await firstCategoryId(manager);
    const productId = await createProduct(manager, categoryId);
    const pool = await createPool(manager, 'PIECES');
    expect((await restockPool(manager, pool.id, 5)).status).toBe(201);
    expect((await linkDish(manager, pool.id, productId, 1)).status).toBe(201);

    const order = await createOrder(waiter, [{ productId, quantity: 2 }]);
    expect(order.status).toBe(201);
    expect((await billOrder(waiter, order.body.id)).status).toBe(201);
    await billOrder(waiter, order.body.id);

    const row = await poolRow(manager, pool.id);
    expect(row.physical).toBe(3);
  });

  test('5. sold-out page and stock page share one availability picture', async () => {
    const manager = await login(MANAGER.username, MANAGER.password);
    const categoryId = await firstCategoryId(manager);
    const productId = await createProduct(manager, categoryId);

    const untracked = await availabilityRow(manager, productId);
    expect(untracked.status).toBe('UNTRACKED');
    expect(untracked.isAvailable).toBe(true);
    expect(untracked.balance).toBeNull();
    expect(untracked.platesLeft).toBeNull();

    // Turning per-dish tracking on with an empty shelf reads as out of stock.
    await patchProduct(manager, productId, { stockManaged: true });
    const empty = await availabilityRow(manager, productId);
    expect(empty.status).toBe('OUT');
    expect(empty.isAvailable).toBe(true);

    const restock = await api(manager, 'POST', '/stock/restock', {
      productId,
      quantity: 4,
    });
    expect(restock.status).toBe(201);
    const stocked = await availabilityRow(manager, productId);
    expect(stocked.status).toBe('OK');
    expect(stocked.balance).toBe(4);

    // A shared pool caps how many plates can still be sold.
    const pool = await createPool(manager, 'PIECES');
    expect((await restockPool(manager, pool.id, 3)).status).toBe(201);
    expect((await linkDish(manager, pool.id, productId, 2)).status).toBe(201);

    const pooled = await availabilityRow(manager, productId);
    expect(pooled.status).toBe('OK');
    expect(pooled.platesLeft).toBe(1);
    expect(pooled.limitedByPool.name).toBe(pool.name);
    expect(pooled.limitedByPool.available).toBe(3);

    // The sold-out switch is reported by both the sold-out and stock endpoints.
    await patchProduct(manager, productId, { isAvailable: false });
    expect((await availabilityRow(manager, productId)).isAvailable).toBe(false);
    expect((await balanceRow(manager, productId)).isAvailable).toBe(false);

    await patchProduct(manager, productId, { isAvailable: true });
    expect((await availabilityRow(manager, productId)).isAvailable).toBe(true);
    expect((await balanceRow(manager, productId)).isAvailable).toBe(true);
  });

  test('6. half and quarter chicken recipes deduct fractional pieces', async () => {
    const manager = await login(MANAGER.username, MANAGER.password);
    const waiter = await login(WAITER.username, WAITER.password);
    const categoryId = await firstCategoryId(manager);
    const halfDish = await createProduct(manager, categoryId);
    const quarterDish = await createProduct(manager, categoryId);
    const pool = await createPool(manager, 'PIECES');
    expect((await restockPool(manager, pool.id, 3)).status).toBe(201);
    expect((await linkDish(manager, pool.id, halfDish, 0.5)).status).toBe(201);
    expect((await linkDish(manager, pool.id, quarterDish, 0.25)).status).toBe(201);

    // 3 chickens at half a bird per plate leaves 6 half plates sellable.
    expect((await availabilityRow(manager, halfDish)).platesLeft).toBe(6);
    expect((await availabilityRow(manager, quarterDish)).platesLeft).toBe(12);

    const order = await createOrder(waiter, [
      { productId: halfDish, quantity: 2 },
      { productId: quarterDish, quantity: 2 },
    ]);
    expect(order.status).toBe(201);

    const reserved = await poolRow(manager, pool.id);
    expect(reserved.reserved).toBe(1.5);
    expect(reserved.available).toBe(1.5);

    expect((await billOrder(waiter, order.body.id)).status).toBe(201);
    const afterBill = await poolRow(manager, pool.id);
    expect(afterBill.physical).toBe(1.5);
    expect(afterBill.reserved).toBe(0);

    expect((await availabilityRow(manager, halfDish)).platesLeft).toBe(3);
    expect((await availabilityRow(manager, quarterDish)).platesLeft).toBe(6);
  });
});
