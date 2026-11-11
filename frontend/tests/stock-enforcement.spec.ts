import { test, expect, request } from '@playwright/test';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';

const API = 'http://localhost:3000/api';

// Credentials verified against tests/categories.spec.ts and tests/cashier.spec.ts
const MANAGER = { username: 'manager', password: 'manager123' };
const WAITER = { username: 'john', password: 'waiter123' };

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

async function createProduct(
  managerToken: string,
  opts: { name: string; stockManaged: boolean; categoryId: string },
): Promise<string> {
  const ctx = await request.newContext();
  const stamp = randomUUID().slice(0, 8);
  const r = await ctx.post(`${API}/products`, {
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    data: {
      name: opts.name,
      sku: `ENF-${stamp}`,
      categoryId: opts.categoryId,
      sellingPrice: 1000,
      costPrice: 500,
      preparationStation: 'KITCHEN',
      stockManaged: opts.stockManaged,
    },
  });
  if (!r.ok()) {
    throw new Error(`createProduct failed ${r.status()}: ${await r.text()}`);
  }
  const body = await r.json();
  await ctx.dispose();
  return body.id as string;
}

async function restock(
  managerToken: string,
  productId: string,
  quantity: number,
): Promise<void> {
  const ctx = await request.newContext();
  const r = await ctx.post(`${API}/stock/restock`, {
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    data: { productId, quantity, notes: `test-fixture-${randomUUID()}` },
  });
  await ctx.dispose();
  if (![200, 201].includes(r.status())) {
    throw new Error(`restock failed ${r.status()}`);
  }
}

async function firstCategoryId(token: string): Promise<string> {
  const ctx = await request.newContext();
  const r = await ctx.get(`${API}/categories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await r.json();
  await ctx.dispose();
  return body.categories[0].id as string;
}

async function createOrder(
  waiterToken: string,
  items: Array<{ productId: string; quantity: number }>,
  opts: { tableId?: string } = {},
) {
  const ctx = await request.newContext();
  const r = await ctx.post(`${API}/orders`, {
    headers: {
      Authorization: `Bearer ${waiterToken}`,
      'Content-Type': 'application/json',
    },
    data: {
      clientUuid: randomUUID(),
      orderType: opts.tableId ? 'DINE_IN' : 'TAKEAWAY',
      tableId: opts.tableId,
      items,
    },
  });
  const status = r.status();
  const body = await r.json().catch(() => ({}));
  await ctx.dispose();
  return { status, body };
}

test.describe('8.8c-3 stock enforcement', () => {
  test('1. create rejected when managed product has zero physical stock', async () => {
    const managerToken = await login(MANAGER.username, MANAGER.password);
    const waiterToken = await login(WAITER.username, WAITER.password);
    const categoryId = await firstCategoryId(managerToken);
    const productId = await createProduct(managerToken, {
      name: `enforce-zero-${randomUUID()}`,
      stockManaged: true,
      categoryId,
    });
    const res = await createOrder(waiterToken, [{ productId, quantity: 1 }]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.insufficientItems?.[0]?.productId).toBe(productId);
    expect(res.body.insufficientItems?.[0]?.requested).toBe(1);
    expect(res.body.insufficientItems?.[0]?.available).toBe(0);
  });

  test('2. create accepted when sufficient; no SALE movement yet', async () => {
    const managerToken = await login(MANAGER.username, MANAGER.password);
    const waiterToken = await login(WAITER.username, WAITER.password);
    const categoryId = await firstCategoryId(managerToken);
    const productId = await createProduct(managerToken, {
      name: `enforce-ok-${randomUUID()}`,
      stockManaged: true,
      categoryId,
    });
    await restock(managerToken, productId, 10);
    const res = await createOrder(waiterToken, [{ productId, quantity: 3 }]);
    expect(res.status).toBe(201);
    expect(res.body.orderNumber).toMatch(/^CS-/);

    const ctx = await request.newContext();
    const bal = await ctx.get(`${API}/stock/balances`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const body = await bal.json();
    await ctx.dispose();
    const row = body.balances.find((b: any) => b.productId === productId);
    expect(row?.balance).toBe(10);
  });

  test('3. unmanaged product never blocked', async () => {
    const managerToken = await login(MANAGER.username, MANAGER.password);
    const waiterToken = await login(WAITER.username, WAITER.password);
    const categoryId = await firstCategoryId(managerToken);
    const productId = await createProduct(managerToken, {
      name: `enforce-unmanaged-${randomUUID()}`,
      stockManaged: false,
      categoryId,
    });
    const res = await createOrder(waiterToken, [{ productId, quantity: 5 }]);
    expect(res.status).toBe(201);
  });

  test('4. append respects existing reservations on the same order', async () => {
    const managerToken = await login(MANAGER.username, MANAGER.password);
    const waiterToken = await login(WAITER.username, WAITER.password);
    const categoryId = await firstCategoryId(managerToken);
    const productId = await createProduct(managerToken, {
      name: `enforce-append-${randomUUID()}`,
      stockManaged: true,
      categoryId,
    });
    await restock(managerToken, productId, 5);
    const first = await createOrder(waiterToken, [{ productId, quantity: 3 }]);
    expect(first.status).toBe(201);

    const ctx = await request.newContext();
    const over = await ctx.post(`${API}/orders/${first.body.id}/items`, {
      headers: {
        Authorization: `Bearer ${waiterToken}`,
        'Content-Type': 'application/json',
      },
      data: { clientUuid: randomUUID(), items: [{ productId, quantity: 3 }] },
    });
    expect(over.status()).toBe(400);
    const overBody = await over.json();
    expect(overBody.code).toBe('INSUFFICIENT_STOCK');
    expect(overBody.insufficientItems?.[0]?.requested).toBe(3);
    expect(overBody.insufficientItems?.[0]?.available).toBe(2);

    const ok = await ctx.post(`${API}/orders/${first.body.id}/items`, {
      headers: {
        Authorization: `Bearer ${waiterToken}`,
        'Content-Type': 'application/json',
      },
      data: { clientUuid: randomUUID(), items: [{ productId, quantity: 2 }] },
    });
    expect(ok.status()).toBe(201);
    await ctx.dispose();
  });

  test('5. concurrent creates serialize — exactly one succeeds', async () => {
    const managerToken = await login(MANAGER.username, MANAGER.password);
    const waiterToken = await login(WAITER.username, WAITER.password);
    const categoryId = await firstCategoryId(managerToken);
    const productId = await createProduct(managerToken, {
      name: `enforce-concurrent-${randomUUID()}`,
      stockManaged: true,
      categoryId,
    });
    await restock(managerToken, productId, 1);

    const [a, b] = await Promise.all([
      createOrder(waiterToken, [{ productId, quantity: 1 }]),
      createOrder(waiterToken, [{ productId, quantity: 1 }]),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]);
    const failed = a.status === 400 ? a : b;
    expect(failed.body.code).toBe('INSUFFICIENT_STOCK');
  });

  test('6. duplicate productIds in one request are aggregated', async () => {
    const managerToken = await login(MANAGER.username, MANAGER.password);
    const waiterToken = await login(WAITER.username, WAITER.password);
    const categoryId = await firstCategoryId(managerToken);
    const productId = await createProduct(managerToken, {
      name: `enforce-agg-${randomUUID()}`,
      stockManaged: true,
      categoryId,
    });
    await restock(managerToken, productId, 4);
    const res = await createOrder(waiterToken, [
      { productId, quantity: 2 },
      { productId, quantity: 3 },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.insufficientItems?.[0]?.requested).toBe(5);
    expect(res.body.insufficientItems?.[0]?.available).toBe(4);
  });
  test.afterAll(async () => {
    // Clean up test-created products and dependent rows so pre-existing
    // suite tests (products default-to-false, /stock/balances counts) see
    // a pristine DB. Marker: sku like 'ENF-%'.
    try {
      execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -c "DELETE FROM stock_movements WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'ENF-%'); DELETE FROM order_items WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'ENF-%'); DELETE FROM products WHERE sku LIKE 'ENF-%';"`,
        { stdio: 'ignore' },
      );
    } catch {
      // best-effort cleanup
    }
  });

});
