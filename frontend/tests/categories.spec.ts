import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';

async function loginAs(request: any, username: string, password: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  const body = await res.json();
  if (!body.accessToken) throw new Error(`Login failed for ${username}`);
  return body.accessToken as string;
}

test.describe('Categories CRUD (manager)', () => {
  test.beforeAll(() => {
    try {
      execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -c "DELETE FROM categories WHERE name LIKE 'Test-Cat-%' OR name LIKE 'Probe-%';"`,
        { stdio: "ignore" },
      );
    } catch {}
  });

  test.afterAll(() => {
    try {
      execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -c "DELETE FROM categories WHERE name LIKE 'Test-Cat-%' OR name LIKE 'Probe-%';"`,
        { stdio: "ignore" },
      );
    } catch {}
  });

  const uniqueName = `Test-Cat-${Date.now()}`;

  test('manager can create a category', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const res = await request.post(`${API}/categories`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: uniqueName, sortOrder: 99 },
    });
    expect([200, 201]).toContain(res.status());
    const cat = await res.json();
    expect(cat.name).toBe(uniqueName);
    expect(cat.sortOrder).toBe(99);
    expect(cat.isActive).toBe(true);

    const list = await request.get(`${API}/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await list.json();
    expect(body.categories.some((c: any) => c.name === uniqueName)).toBe(true);
  });

  test('manager can rename a category', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const created = await request.post(`${API}/categories`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: `${uniqueName}-rename`, sortOrder: 50 },
    });
    const cat = await created.json();
    const patched = await request.patch(`${API}/categories/${cat.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: `${uniqueName}-renamed` },
    });
    expect(patched.status()).toBe(200);
    const updated = await patched.json();
    expect(updated.name).toBe(`${uniqueName}-renamed`);
  });

  test('manager cannot create a duplicate category name', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    await request.post(`${API}/categories`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: `${uniqueName}-dup` },
    });
    const res = await request.post(`${API}/categories`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: `${uniqueName}-dup` },
    });
    expect(res.status()).toBe(409);
  });

  test('manager cannot deactivate a category that has active products', async ({ request }) => {
    const seedName = `${uniqueName}-inuse`;
    execSync(`psql -h 127.0.0.1 -U citysquare -d citysquare -c "
      INSERT INTO categories (name) VALUES ('${seedName}');
      INSERT INTO products (category_id, name, selling_price, preparation_station)
      SELECT id, 'Test-Product-ForCat-${Date.now()}', 100, 'KITCHEN' FROM categories WHERE name = '${seedName}';
    "`, { stdio: 'inherit' });

    try {
      const token = await loginAs(request, 'manager', 'manager123');
      const catRes = await request.get(`${API}/categories`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cats = (await catRes.json()).categories as any[];
      const cat = cats.find((c) => c.name === seedName);
      expect(cat).toBeTruthy();

      const res = await request.delete(`${API}/categories/${cat.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(409);
      const body = await res.json();
      expect(body.message).toContain('product');
    } finally {
      execSync(`psql -h 127.0.0.1 -U citysquare -d citysquare -c "
        DELETE FROM products WHERE name LIKE 'Test-Product-ForCat-%';
        DELETE FROM categories WHERE name = '${seedName}';
      "`, { stdio: 'ignore' });
    }
  });

  test('waiter cannot manage categories (role enforcement)', async ({ request }) => {
    const token = await loginAs(request, 'john', 'waiter123');
    const postRes = await request.post(`${API}/categories`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: `${uniqueName}-forbidden` },
    });
    expect(postRes.status()).toBe(403);

    const patchRes = await request.patch(`${API}/categories/00000000-0000-0000-0000-000000000000`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'x' },
    });
    expect(patchRes.status()).toBe(403);

    const delRes = await request.delete(`${API}/categories/00000000-0000-0000-0000-000000000000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(403);
  });
});
