import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';

async function loginAs(request: any, username: string, password: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  const body = await res.json();
  if (!body.accessToken) throw new Error(`Login failed for ${username}`);
  return body.accessToken as string;
}

test.describe('Settings + Printers (manager + admin)', () => {
  let originalRestaurantName = '';
  let originalCurrency = 'TZS';

  test.beforeAll(() => {
    try {
      const r = execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -t -A -c "SELECT value FROM settings WHERE key = 'restaurant_name'"`,
        { encoding: 'utf8' },
      ).trim();
      originalRestaurantName = JSON.parse(r);
    } catch {}
    try {
      const r = execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -t -A -c "SELECT value FROM settings WHERE key = 'currency'"`,
        { encoding: 'utf8' },
      ).trim();
      originalCurrency = JSON.parse(r);
    } catch {}
  });

  test.afterAll(() => {
    // Restore original restaurant settings
    try {
      execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -c "UPDATE settings SET value = '${JSON.stringify(originalRestaurantName)}'::jsonb WHERE key = 'restaurant_name'; UPDATE settings SET value = '${JSON.stringify(originalCurrency)}'::jsonb WHERE key = 'currency';"`,
        { stdio: 'ignore' },
      );
    } catch {}
  });

  test('manager can list settings', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const res = await request.get(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.settings).toHaveProperty('restaurantName');
    expect(body.settings).toHaveProperty('currency');
    expect(body.settings).toHaveProperty('timezone');
    expect(body.settings).toHaveProperty('printerDefaults');
  });

  test('manager can list printers', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const res = await request.get(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.printers.length).toBeGreaterThanOrEqual(3);
    expect(body.printers.some((p: any) => p.station === 'KITCHEN')).toBe(true);
    expect(body.printers.some((p: any) => p.station === 'BAR')).toBe(true);
    expect(body.printers.some((p: any) => p.station === 'NONE')).toBe(true);
  });

  test('manager can update restaurant name', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const newName = `Test Rest ${Date.now()}`;
    const patch = await request.patch(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { restaurant_name: newName },
    });
    expect(patch.status()).toBe(200);

    const get = await request.get(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await get.json();
    expect(body.settings.restaurantName).toBe(newName);
  });

  test('manager cannot modify order_counter_* settings', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const res = await request.patch(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { 'order_counter_20261111': 99999 },
    });
    expect(res.status()).toBe(400);
  });

  test('BAR printer cannot become KITCHEN default (station mismatch)', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const printersRes = await request.get(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const printers = (await printersRes.json()).printers;
    const barPrinter = printers.find((p: any) => p.station === 'BAR');
    expect(barPrinter).toBeTruthy();

    const res = await request.patch(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { 'printer.default.kitchen': barPrinter.id },
    });
    expect(res.status()).toBe(400);
  });

  test('assigned default printer cannot be deactivated through DELETE or PATCH', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const printersRes = await request.get(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const printers = (await printersRes.json()).printers;
    const kitchenPrinter = printers.find((p: any) => p.station === 'KITCHEN');

    // Assign kitchen printer as default
    await request.patch(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { 'printer.default.kitchen': kitchenPrinter.id },
    });

    try {
      // DELETE — should 409
      const delRes = await request.delete(`${API}/printers/${kitchenPrinter.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(delRes.status()).toBe(409);

      // PATCH isActive:false — should also 409
      const patchRes = await request.patch(`${API}/printers/${kitchenPrinter.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { isActive: false },
      });
      expect(patchRes.status()).toBe(409);
    } finally {
      // Clear the default
      await request.patch(`${API}/settings`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { 'printer.default.kitchen': null },
      });
    }
  });

  test('assigned printer cannot be moved to incompatible station', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const printersRes = await request.get(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const printers = (await printersRes.json()).printers;
    const kitchenPrinter = printers.find((p: any) => p.station === 'KITCHEN');

    // Assign as kitchen default
    await request.patch(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { 'printer.default.kitchen': kitchenPrinter.id },
    });

    try {
      // Try to move it to BAR — should 409
      const res = await request.patch(`${API}/printers/${kitchenPrinter.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { station: 'BAR' },
      });
      expect(res.status()).toBe(409);
    } finally {
      await request.patch(`${API}/settings`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { 'printer.default.kitchen': null },
      });
    }
  });

  test('waiter cannot manage settings or printers', async ({ request }) => {
    const token = await loginAs(request, 'john', 'waiter123');
    const settingsGet = await request.get(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(settingsGet.status()).toBe(403);

    const printersGet = await request.get(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(printersGet.status()).toBe(403);

    const patchSettings = await request.patch(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { restaurant_name: 'Hacked' },
    });
    expect(patchSettings.status()).toBe(403);
  });
});
