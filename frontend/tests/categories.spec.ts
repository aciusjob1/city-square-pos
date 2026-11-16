import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const API = 'http://localhost:3000/api';
const PSQL = 'psql -h 127.0.0.1 -U citysquare -d citysquare -c';

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

  test('manager can set, change and clear a category printer', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const prName = `${uniqueName}-printer`;

    const created = await request.post(`${API}/categories`, {
      headers: auth,
      data: { name: prName, sortOrder: 60, printerStation: 'BAR' },
    });
    expect(created.status()).toBe(201);
    const cat = await created.json();
    expect(cat.printerStation).toBe('BAR');

    const list = await (await request.get(`${API}/categories`, { headers: auth })).json();
    expect(list.categories.find((c: any) => c.id === cat.id).printerStation).toBe('BAR');

    const toReceipt = await request.patch(`${API}/categories/${cat.id}`, {
      headers: auth,
      data: { printerStation: 'NONE' },
    });
    expect(toReceipt.status()).toBe(200);
    expect((await toReceipt.json()).printerStation).toBe('NONE');

    const cleared = await request.patch(`${API}/categories/${cat.id}`, {
      headers: auth,
      data: { printerStation: null },
    });
    expect(cleared.status()).toBe(200);
    expect((await cleared.json()).printerStation).toBeNull();

    const invalid = await request.patch(`${API}/categories/${cat.id}`, {
      headers: auth,
      data: { printerStation: 'RECEIPT' },
    });
    expect(invalid.status()).toBe(400);
  });

  test('category printer overrides product station on a new order', async ({ request }) => {
    const managerToken = await loginAs(request, 'manager', 'manager123');
    const auth = { Authorization: `Bearer ${managerToken}`, 'Content-Type': 'application/json' };
    const routeName = `${uniqueName}-route`;
    let catId = '';
    let prodId = '';
    let orderId = '';
    try {
      const cat = await (await request.post(`${API}/categories`, {
        headers: auth,
        data: { name: routeName, sortOrder: 61, printerStation: 'BAR' },
      })).json();
      catId = cat.id;

      const prod = await (await request.post(`${API}/products`, {
        headers: auth,
        data: {
          name: `Test-Product-${routeName}`,
          categoryId: catId,
          sellingPrice: 500,
          costPrice: 0,
          preparationStation: 'KITCHEN',
        },
      })).json();
      prodId = prod.id;

      const waiterToken = await loginAs(request, 'john', 'waiter123');
      const orderRes = await request.post(`${API}/orders`, {
        headers: { Authorization: `Bearer ${waiterToken}`, 'Content-Type': 'application/json' },
        data: {
          orderType: 'TAKEAWAY',
          clientUuid: randomUUID(),
          items: [{ productId: prodId, quantity: 1 }],
        },
      });
      expect(orderRes.status()).toBe(201);
      const order = await orderRes.json();
      orderId = order.id;
      // Product says KITCHEN, but its category routes to BAR.
      expect(order.items[0].station).toBe('BAR');
    } finally {
      if (orderId) {
        try {
          execSync(`${PSQL} "DELETE FROM print_jobs WHERE order_id = '${orderId}';"`, { stdio: 'ignore' });
          execSync(`${PSQL} "DELETE FROM order_items WHERE order_id = '${orderId}';"`, { stdio: 'ignore' });
          execSync(`${PSQL} "DELETE FROM orders WHERE id = '${orderId}';"`, { stdio: 'ignore' });
        } catch {}
      }
      if (prodId) {
        try {
          execSync(`${PSQL} "DELETE FROM products WHERE id = '${prodId}';"`, { stdio: 'ignore' });
        } catch {}
      }
      if (catId) {
        try {
          execSync(`${PSQL} "DELETE FROM categories WHERE id = '${catId}';"`, { stdio: 'ignore' });
        } catch {}
      }
    }
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
    const prodName = `Test-Product-ForCat-${Date.now()}`;
    // Keep each statement on its own single-line psql call: a multi-line
    // "-c" argument is silently truncated by cmd.exe on Windows.
    execSync(
      `psql -h 127.0.0.1 -U citysquare -d citysquare -c "INSERT INTO categories (name) VALUES ('${seedName}');"`,
      { stdio: 'inherit' },
    );
    execSync(
      `psql -h 127.0.0.1 -U citysquare -d citysquare -c "INSERT INTO products (category_id, name, selling_price, preparation_station) SELECT id, '${prodName}', 100, 'KITCHEN' FROM categories WHERE name = '${seedName}';"`,
      { stdio: 'inherit' },
    );

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
      execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -c "DELETE FROM products WHERE name LIKE 'Test-Product-ForCat-%';"`,
        { stdio: 'ignore' },
      );
      execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -c "DELETE FROM categories WHERE name = '${seedName}';"`,
        { stdio: 'ignore' },
      );
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

test.describe('Category printer UI (manager)', () => {
  const uiName = `Test-Cat-ui-${Date.now()}`;

  test.afterAll(async ({ request }) => {
    try {
      const token = await loginAs(request, 'manager', 'manager123');
      const list = await (await request.get(`${API}/categories`, {
        headers: { Authorization: `Bearer ${token}` },
      })).json();
      const cat = (list.categories as any[]).find((c) => c.name === uiName);
      if (cat) {
        await request.delete(`${API}/categories/${cat.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {}
  });

  test('manager sets and edits a category printer from the form', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('manager');
    await page.getByLabel('Password').fill('manager123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/manager$/, { timeout: 10000 });

    await page.goto('/manager/categories');
    await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();

    await page.getByRole('button', { name: '+ Add New' }).click();
    const form = page.locator('.manager-cat-form');
    await form.getByLabel('Name').fill(uiName);
    await form.getByLabel('Printer').selectOption('BAR');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast')).toContainText('Category created');

    const row = page.getByRole('row', { name: new RegExp(uiName) });
    await expect(row).toContainText('Bar printer');

    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('.manager-cat-form').getByLabel('Printer')).toHaveValue('BAR');
    await page.locator('.manager-cat-form').getByRole('button', { name: 'Cancel' }).click();
  });
});
