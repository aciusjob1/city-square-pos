import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';

async function loginAs(request: any, username: string, password: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  const body = await res.json();
  if (!body.accessToken) throw new Error(`Login failed for ${username}`);
  return body.accessToken as string;
}

async function findProductId(request: any, token: string, name: string): Promise<string> {
  const res = await request.get(`${API}/products`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  const p = body.products.find((x: any) => x.name === name);
  if (!p) throw new Error(`Product not found: ${name}`);
  return p.id;
}

test.describe('Stock (manager)', () => {
  test.beforeAll(() => {
    try {
      execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -c "UPDATE products SET reorder_level = 0; DELETE FROM stock_movements WHERE notes LIKE 'Test-%';"`,
        { stdio: 'ignore' },
      );
    } catch {}
  });

  test.afterAll(() => {
    try {
      execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -c "UPDATE products SET reorder_level = 0; DELETE FROM stock_movements WHERE notes LIKE 'Test-%';"`,
        { stdio: 'ignore' },
      );
    } catch {}
  });

  test('manager sees stock balances', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const res = await request.get(`${API}/stock/balances`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // After 8.8c-2, balances are filtered to stock_managed = true.
    // Default state = 0 managed products.
    expect(body.balances.length).toBe(0);
    expect(body.balances.every((r: any) => ['OK', 'LOW', 'OUT'].includes(r.status))).toBe(true);
    expect(body.balances.every((r: any) => typeof r.balance === 'number')).toBe(true);
  });

  test('manager can restock a product', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const productId = await findProductId(request, token, 'Samaki');

    // Enable stock_managed so product appears in /stock/balances
    await request.patch(`${API}/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { stockManaged: true },
    });

    try {
      const restock = await request.post(`${API}/stock/restock`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { productId, quantity: 100, notes: 'Test-restock-1' },
      });
      expect([200, 201]).toContain(restock.status());

      const balances = await request.get(`${API}/stock/balances`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await balances.json();
      const samaki = body.balances.find((r: any) => r.productId === productId);
      expect(samaki.balance).toBeGreaterThanOrEqual(100);
      expect(samaki.status).toBe('OK');
    } finally {
      await request.patch(`${API}/products/${productId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { stockManaged: false },
      });
      try {
        execSync(`psql -h 127.0.0.1 -U citysquare -d citysquare -c "DELETE FROM stock_movements WHERE notes = 'Test-restock-1';"`, { stdio: 'ignore' });
      } catch {}
    }
  });

  test('manager can update reorder level', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const productId = await findProductId(request, token, 'Ugali');

    // Enable stock_managed so product appears in /stock/balances
    await request.patch(`${API}/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { stockManaged: true },
    });

    try {
      const patch = await request.patch(`${API}/products/${productId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { reorderLevel: 50 },
      });
      expect(patch.status()).toBe(200);

      const balances = await request.get(`${API}/stock/balances`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await balances.json();
      const ugali = body.balances.find((r: any) => r.productId === productId);
      expect(ugali.reorderLevel).toBe(50);
    } finally {
      await request.patch(`${API}/products/${productId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { stockManaged: false, reorderLevel: 0 },
      });
    }
  });

  test('negative reorder level rejected', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const productId = await findProductId(request, token, 'Chips');

    const patch = await request.patch(`${API}/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { reorderLevel: -1 },
    });
    expect(patch.status()).toBe(400);
  });

  test('low-stock endpoint filters correctly', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const productId = await findProductId(request, token, 'Kuku');

    // Enable stock_managed + set reorder level to 10, restock 5 → LOW
    await request.patch(`${API}/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { stockManaged: true, reorderLevel: 10 },
    });
    await request.post(`${API}/stock/restock`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { productId, quantity: 5, notes: 'Test-lowstock-1' },
    });

    const low = await request.get(`${API}/stock/low-stock`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const lowBody = await low.json();
    expect(lowBody.products.some((p: any) => p.productId === productId)).toBe(true);

    // Restock 20 more → balance 25, above threshold 10 → not LOW
    await request.post(`${API}/stock/restock`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { productId, quantity: 20, notes: 'Test-lowstock-2' },
    });

    const low2 = await request.get(`${API}/stock/low-stock`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const low2Body = await low2.json();
    expect(low2Body.products.some((p: any) => p.productId === productId)).toBe(false);

    // Cleanup: reset stockManaged + reorderLevel
    await request.patch(`${API}/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { stockManaged: false, reorderLevel: 0 },
    });
  });

  test('waiter cannot access stock endpoints', async ({ request }) => {
    const token = await loginAs(request, 'john', 'waiter123');

    const balances = await request.get(`${API}/stock/balances`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(balances.status()).toBe(403);

    const restock = await request.post(`${API}/stock/restock`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { productId: '00000000-0000-0000-0000-000000000000', quantity: 1 },
    });
    expect(restock.status()).toBe(403);
  });


  test('stock/balances filters to stock_managed = true', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const list = await request.get(`${API}/products`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const prod = (await list.json()).products[0];

    try {
      await request.patch(`${API}/products/${prod.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { stockManaged: true },
      });

      const balances = await request.get(`${API}/stock/balances`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await balances.json();
      expect(body.balances.length).toBe(1);
      expect(body.balances[0].productId).toBe(prod.id);
    } finally {
      await request.patch(`${API}/products/${prod.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { stockManaged: false },
      });
    }
  });

  test('stock/low-stock filters to stock_managed = true', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const list = await request.get(`${API}/products`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const prod = (await list.json()).products[0];

    try {
      await request.patch(`${API}/products/${prod.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { stockManaged: true, reorderLevel: 10 },
      });
      await request.post(`${API}/stock/restock`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { productId: prod.id, quantity: 3, notes: 'Test-lowstock-managed' },
      });

      const low = await request.get(`${API}/stock/low-stock`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await low.json();
      expect(body.products.some((p: any) => p.productId === prod.id)).toBe(true);
    } finally {
      await request.patch(`${API}/products/${prod.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { stockManaged: false, reorderLevel: 0 },
      });
      try {
        execSync(`psql -h 127.0.0.1 -U citysquare -d citysquare -c "DELETE FROM stock_movements WHERE notes LIKE 'Test-lowstock-managed%';"`, { stdio: 'ignore' });
      } catch {}
    }
  });

});
