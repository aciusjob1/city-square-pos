import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';

async function loginAs(request: any, username: string, password: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  const body = await res.json();
  if (!body.accessToken) throw new Error(`Login failed for ${username}`);
  return body.accessToken as string;
}

async function findProduct(request: any, token: string, name: string): Promise<any> {
  const res = await request.get(`${API}/products`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const p = (await res.json()).products.find((x: any) => x.name === name);
  if (!p) throw new Error(`Product not found: ${name}`);
  return p;
}

test.describe('Product availability (sold out)', () => {
  test('sold-out product is hidden from waiter catalog and cannot be ordered', async ({ request }) => {
    const manager = await loginAs(request, 'manager', 'manager123');
    const waiter = await loginAs(request, 'john', 'waiter123');
    const product = await findProduct(request, manager, 'Chipsi kavu');

    await request.patch(`${API}/products/${product.id}`, {
      headers: { Authorization: `Bearer ${manager}`, 'Content-Type': 'application/json' },
      data: { isAvailable: false },
    });

    try {
      const waiterList = await request.get(`${API}/products`, {
        headers: { Authorization: `Bearer ${waiter}` },
      });
      const waiterBody = await waiterList.json();
      expect(waiterBody.products.some((p: any) => p.id === product.id)).toBe(false);

      const managerList = await request.get(`${API}/products`, {
        headers: { Authorization: `Bearer ${manager}` },
      });
      const managerBody = await managerList.json();
      const seen = managerBody.products.find((p: any) => p.id === product.id);
      expect(seen.isAvailable).toBe(false);

      const order = await request.post(`${API}/orders`, {
        headers: { Authorization: `Bearer ${waiter}`, 'Content-Type': 'application/json' },
        data: {
          clientUuid: crypto.randomUUID(),
          orderType: 'TAKEAWAY',
          items: [{ productId: product.id, quantity: 1 }],
        },
      });
      expect(order.status()).toBe(400);
      const err = await order.json();
      expect(err.invalidItems[0].reason).toBe('UNAVAILABLE');
    } finally {
      await request.patch(`${API}/products/${product.id}`, {
        headers: { Authorization: `Bearer ${manager}`, 'Content-Type': 'application/json' },
        data: { isAvailable: true },
      });
    }
  });

  test('cashier can toggle availability but cannot edit other product fields', async ({ request }) => {
    const cashier = await loginAs(request, 'cashier1', 'waiter123');
    const waiter = await loginAs(request, 'john', 'waiter123');
    const product = await findProduct(request, cashier, 'Chipsi kavu');
    const auth = { Authorization: `Bearer ${cashier}`, 'Content-Type': 'application/json' };

    try {
      const off = await request.patch(`${API}/products/${product.id}/availability`, {
        headers: auth, data: { isAvailable: false },
      });
      expect(off.status()).toBe(200);
      expect((await off.json()).isAvailable).toBe(false);

      const priceEdit = await request.patch(`${API}/products/${product.id}`, {
        headers: auth, data: { sellingPrice: 1 },
      });
      expect(priceEdit.status()).toBe(403);

      const waiterDenied = await request.patch(`${API}/products/${product.id}/availability`, {
        headers: { Authorization: `Bearer ${waiter}`, 'Content-Type': 'application/json' },
        data: { isAvailable: false },
      });
      expect(waiterDenied.status()).toBe(403);
    } finally {
      await request.patch(`${API}/products/${product.id}/availability`, {
        headers: auth, data: { isAvailable: true },
      });
    }
  });

  test('cashier marks a product sold out from the Sold Out page', async ({ page, request }) => {
    const manager = await loginAs(request, 'manager', 'manager123');
    const waiter = await loginAs(request, 'john', 'waiter123');
    const product = await findProduct(request, manager, 'Chipsi kavu');

    await request.patch(`${API}/products/${product.id}/availability`, {
      headers: { Authorization: `Bearer ${manager}`, 'Content-Type': 'application/json' },
      data: { isAvailable: true },
    });

    try {
      await page.goto('/login');
      await page.getByLabel('Username').fill('cashier1');
      await page.getByLabel('Password').fill('waiter123');
      await page.getByRole('button', { name: /sign in/i }).click();
      await expect(page).toHaveURL(/\/cashier$/, { timeout: 10000 });

      await page.locator('.topbar-links').getByRole('link', { name: 'Sold Out' }).click();
      await expect(page).toHaveURL(/\/cashier\/sold-out$/);
      await expect(page.getByRole('heading', { name: 'Sold Out' })).toBeVisible();

      const row = page.locator('.manager-soldout-table tbody tr').filter({ hasText: product.name });
      await expect(row).toBeVisible();
      await row.locator('.manager-soldout-slider').click();
      await expect(page.locator('.toast')).toContainText(`${product.name} marked sold out`);
      await expect(row).toHaveClass(/manager-soldout-row/);

      const waiterList = await request.get(`${API}/products`, {
        headers: { Authorization: `Bearer ${waiter}` },
      });
      const waiterBody = await waiterList.json();
      expect(waiterBody.products.some((p: any) => p.id === product.id)).toBe(false);

      await row.locator('.manager-soldout-slider').click();
      await expect(page.locator('.toast')).toContainText(`${product.name} is back on the menu`);
    } finally {
      await request.patch(`${API}/products/${product.id}/availability`, {
        headers: { Authorization: `Bearer ${manager}`, 'Content-Type': 'application/json' },
        data: { isAvailable: true },
      });
    }
  });

  test('manager can switch availability back on', async ({ request }) => {
    const manager = await loginAs(request, 'manager', 'manager123');
    const product = await findProduct(request, manager, 'Ugali dona');

    try {
      const off = await request.patch(`${API}/products/${product.id}`, {
        headers: { Authorization: `Bearer ${manager}`, 'Content-Type': 'application/json' },
        data: { isAvailable: false },
      });
      expect(off.status()).toBe(200);
      expect((await off.json()).isAvailable).toBe(false);

      const on = await request.patch(`${API}/products/${product.id}`, {
        headers: { Authorization: `Bearer ${manager}`, 'Content-Type': 'application/json' },
        data: { isAvailable: true },
      });
      expect(on.status()).toBe(200);
      expect((await on.json()).isAvailable).toBe(true);
    } finally {
      await request.patch(`${API}/products/${product.id}`, {
        headers: { Authorization: `Bearer ${manager}`, 'Content-Type': 'application/json' },
        data: { isAvailable: true },
      });
    }
  });
});

test.describe('Printer discovery', () => {
  test('manager can search printers installed on this computer', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const res = await request.get(`${API}/printers/discover`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.printers)).toBe(true);
    for (const p of body.printers) {
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
      expect(typeof p.status).toBe('string');
    }
  });

  test('waiter cannot search printers', async ({ request }) => {
    const token = await loginAs(request, 'john', 'waiter123');
    const res = await request.get(`${API}/printers/discover`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('network printers require an IP address', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');

    const bad = await request.post(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'Network printer without IP', type: 'NETWORK', stations: ['NONE'] },
    });
    expect(bad.status()).toBe(400);
  });
});
