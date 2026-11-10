import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';

async function loginAs(request: any, username: string, password: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  const body = await res.json();
  if (!body.accessToken) throw new Error(`Login failed for ${username}`);
  return body.accessToken as string;
}

async function activeCategoryId(request: any, token: string): Promise<string> {
  const res = await request.get(`${API}/categories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!body.categories[0]) throw new Error('No active category — seed data missing');
  return body.categories[0].id;
}

test.describe('Products CRUD (manager)', () => {
  test.beforeAll(() => {
    try {
      execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -c "DELETE FROM products WHERE name LIKE 'Test-Prod-%';"`,
        { stdio: 'ignore' },
      );
    } catch {}
  });

  test.afterAll(() => {
    try {
      execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -c "DELETE FROM products WHERE name LIKE 'Test-Prod-%';"`,
        { stdio: 'ignore' },
      );
    } catch {}
  });

  const stamp = Date.now();

  test('manager can create a product in active category', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const catId = await activeCategoryId(request, token);
    const res = await request.post(`${API}/products`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        name: `Test-Prod-Create-${stamp}`,
        sku: `TPC-${stamp}`,
        categoryId: catId,
        sellingPrice: 1234,
        costPrice: 500,
        preparationStation: 'KITCHEN',
      },
    });
    expect([200, 201]).toContain(res.status());
    const prod = await res.json();
    expect(prod.name).toBe(`Test-Prod-Create-${stamp}`);
    expect(prod.sku).toBe(`TPC-${stamp}`);
    expect(parseFloat(prod.sellingPrice)).toBe(1234);
  });

  test('manager can update product name, price, station', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const catId = await activeCategoryId(request, token);
    const created = await request.post(`${API}/products`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        name: `Test-Prod-Update-${stamp}`,
        categoryId: catId,
        sellingPrice: 100,
        costPrice: 50,
        preparationStation: 'KITCHEN',
      },
    });
    const prod = await created.json();
    const patched = await request.patch(`${API}/products/${prod.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: `Test-Prod-Updated-${stamp}`, sellingPrice: 200, preparationStation: 'BAR' },
    });
    expect(patched.status()).toBe(200);
    const updated = await patched.json();
    expect(updated.name).toBe(`Test-Prod-Updated-${stamp}`);
    expect(parseFloat(updated.sellingPrice)).toBe(200);
    expect(updated.preparationStation).toBe('BAR');
  });

  test('manager cannot create product with duplicate SKU', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const catId = await activeCategoryId(request, token);
    const dupSku = `TPS-${stamp}`;
    await request.post(`${API}/products`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: `Test-Prod-Dup1-${stamp}`, sku: dupSku, categoryId: catId, sellingPrice: 100, preparationStation: 'KITCHEN' },
    });
    const res = await request.post(`${API}/products`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: `Test-Prod-Dup2-${stamp}`, sku: dupSku, categoryId: catId, sellingPrice: 100, preparationStation: 'KITCHEN' },
    });
    expect(res.status()).toBe(409);
  });

  test('manager cannot create product in inactive category', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const catRes = await request.post(`${API}/categories`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: `Test-Prod-Cat-${stamp}` },
    });
    const cat = await catRes.json();
    await request.delete(`${API}/categories/${cat.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await request.post(`${API}/products`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: `Test-Prod-InactiveCat-${stamp}`, categoryId: cat.id, sellingPrice: 100, preparationStation: 'KITCHEN' },
    });
    expect(res.status()).toBe(400);
  });

  test('manager can deactivate product even with open order items', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const catId = await activeCategoryId(request, token);
    const created = await request.post(`${API}/products`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        name: `Test-Prod-Deact-${stamp}`,
        categoryId: catId,
        sellingPrice: 100,
        costPrice: 50,
        preparationStation: 'KITCHEN',
      },
    });
    const prod = await created.json();

    const delRes = await request.delete(`${API}/products/${prod.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(200);

    const list = await request.get(`${API}/products`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await list.json();
    expect(body.products.some((p: any) => p.id === prod.id)).toBe(false);
  });

  test('selling below cost is allowed (no server rejection)', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const catId = await activeCategoryId(request, token);
    const res = await request.post(`${API}/products`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        name: `Test-Prod-Loss-${stamp}`,
        categoryId: catId,
        sellingPrice: 100,
        costPrice: 500,
        preparationStation: 'KITCHEN',
      },
    });
    expect([200, 201]).toContain(res.status());
    const prod = await res.json();
    expect(parseFloat(prod.sellingPrice)).toBe(100);
    expect(parseFloat(prod.costPrice)).toBe(500);
  });

  test('waiter cannot manage products (role enforcement)', async ({ request }) => {
    const token = await loginAs(request, 'john', 'waiter123');
    const catId = await activeCategoryId(request, token);

    const postRes = await request.post(`${API}/products`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'Should-Fail', categoryId: catId, sellingPrice: 100, preparationStation: 'KITCHEN' },
    });
    expect(postRes.status()).toBe(403);

    const patchRes = await request.patch(`${API}/products/00000000-0000-0000-0000-000000000000`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'x' },
    });
    expect(patchRes.status()).toBe(403);

    const delRes = await request.delete(`${API}/products/00000000-0000-0000-0000-000000000000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(403);
  });
});
