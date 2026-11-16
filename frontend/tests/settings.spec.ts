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
      // Clear any leftover printer defaults from prior runs
      execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -c "UPDATE settings SET value = 'null'::jsonb WHERE key IN ('printer.default.kitchen', 'printer.default.bar', 'printer.default.receipt');"`,
        { stdio: 'ignore' },
      );
    } catch {}
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
    // Restore original restaurant settings. to_jsonb avoids nested double
    // quotes, which cmd.exe would strip from the psql -c argument.
    try {
      const name = originalRestaurantName.replace(/'/g, "''");
      const currency = originalCurrency.replace(/'/g, "''");
      execSync(
        `psql -h 127.0.0.1 -U citysquare -d citysquare -c "UPDATE settings SET value = to_jsonb('${name}'::text) WHERE key = 'restaurant_name'; UPDATE settings SET value = to_jsonb('${currency}'::text) WHERE key = 'currency';"`,
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
    for (const p of body.printers) {
      expect(Array.isArray(p.stations)).toBe(true);
      expect(p.stations.length).toBeGreaterThan(0);
    }
    expect(body.printers.some((p: any) => p.stations.includes('KITCHEN'))).toBe(true);
    expect(body.printers.some((p: any) => p.stations.includes('BAR'))).toBe(true);
    expect(body.printers.some((p: any) => p.stations.includes('NONE'))).toBe(true);
  });

  test('one printer can be assigned to multiple stations', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const printersRes = await request.get(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const printers = (await printersRes.json()).printers;
    // Reuse the deterministic test fixture instead of creating a printer.
    const printer = printers.find((p: any) => p.name === 'Test Extra Printer');
    expect(printer).toBeTruthy();

    const multi = await request.patch(`${API}/printers/${printer.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { stations: ['KITCHEN', 'NONE'] },
    });
    expect(multi.status()).toBe(200);
    const updated = await multi.json();
    expect([...updated.stations].sort()).toEqual(['KITCHEN', 'NONE']);

    try {
      for (const key of ['printer.default.kitchen', 'printer.default.receipt']) {
        const res = await request.patch(`${API}/settings`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: { [key]: printer.id },
        });
        expect(res.status()).toBe(200);
      }

      // Removing a station still used by a default must be refused.
      const drop = await request.patch(`${API}/printers/${printer.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { stations: ['KITCHEN'] },
      });
      expect(drop.status()).toBe(409);
    } finally {
      await request.patch(`${API}/settings`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { 'printer.default.kitchen': null, 'printer.default.receipt': null },
      });
      const restore = await request.patch(`${API}/printers/${printer.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { stations: ['KITCHEN'] },
      });
      expect(restore.status()).toBe(200);
    }
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

  test('public branding endpoint exposes name, logo and currency', async ({ request }) => {
    const res = await request.get(`${API}/settings/branding`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.restaurantName).toBe('string');
    expect(body.restaurantName.length).toBeGreaterThan(0);
    expect(typeof body.currency).toBe('string');
    expect(body).toHaveProperty('restaurantLogo');
  });

  test('manager can set, validate and clear the restaurant logo', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const before = (await (await request.get(`${API}/settings`, { headers: auth })).json())
      .settings.restaurantLogo as string | null;
    // 1×1 transparent PNG.
    const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    try {
      const patch = await request.patch(`${API}/settings`, {
        headers: auth,
        data: { restaurant_logo: logo },
      });
      expect(patch.status()).toBe(200);

      const branding = await (await request.get(`${API}/settings/branding`)).json();
      expect(branding.restaurantLogo).toBe(logo);

      const invalid = await request.patch(`${API}/settings`, {
        headers: auth,
        data: { restaurant_logo: 'not-an-image' },
      });
      expect(invalid.status()).toBe(400);
    } finally {
      const restore = await request.patch(`${API}/settings`, {
        headers: auth,
        data: { restaurant_logo: before ?? null },
      });
      expect(restore.status()).toBe(200);
    }
  });

  test('settings accepts a logo larger than the 100 kB express default', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const before = (await (await request.get(`${API}/settings`, { headers: auth })).json())
      .settings.restaurantLogo as string | null;
    // ~250 kB data URL — above the old 100 kB body limit, below the 600 kB cap.
    const bigLogo = 'data:image/png;base64,' + 'A'.repeat(250_000);

    try {
      const patch = await request.patch(`${API}/settings`, {
        headers: auth,
        data: { restaurant_logo: bigLogo },
      });
      expect(patch.status()).toBe(200);
      const saved = (await (await request.get(`${API}/settings`, { headers: auth })).json())
        .settings.restaurantLogo;
      expect(saved.length).toBe(bigLogo.length);
    } finally {
      const restore = await request.patch(`${API}/settings`, {
        headers: auth,
        data: { restaurant_logo: before ?? null },
      });
      expect(restore.status()).toBe(200);
    }
  });

  test('manager can save a large logo from the Settings page', async ({ page, request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const before = (await (await request.get(`${API}/settings`, { headers: auth })).json())
      .settings.restaurantLogo as string | null;

    // Valid 1×1 PNG header followed by padding: ~480 kB on disk, ~640 kB as base64.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const buffer = Buffer.concat([png, Buffer.alloc(480 * 1024, 0x41)]);

    try {
      await page.goto('/login');
      await page.getByLabel('Username').fill('manager');
      await page.getByLabel('Password').fill('manager123');
      await page.getByRole('button', { name: /sign in/i }).click();
      await expect(page).toHaveURL(/\/manager$/, { timeout: 10000 });
      await page.goto('/manager/settings');
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

      await page.locator('.manager-logo-upload input[type=file]').setInputFiles({
        name: 'large-logo.png',
        mimeType: 'image/png',
        buffer,
      });
      await expect(page.getByAltText('Restaurant logo preview')).toBeVisible();

      await page.locator('.manager-settings-form').first()
        .getByRole('button', { name: 'Save' }).click();
      await expect(page.locator('.toast')).toContainText('Restaurant settings saved');
      await expect(page.locator('.error')).toHaveCount(0);
    } finally {
      await request.patch(`${API}/settings`, {
        headers: auth,
        data: { restaurant_logo: before ?? null },
      });
    }
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
    const barPrinter = printers.find((p: any) => p.stations.includes('BAR'));
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
    const kitchenPrinter = printers.find(
      (p: any) => p.stations.includes('KITCHEN') && p.isActive,
    );

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
    const kitchenPrinter = printers.find(
      (p: any) => p.stations.includes('KITCHEN') && p.isActive,
    );

    // Assign as kitchen default
    await request.patch(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { 'printer.default.kitchen': kitchenPrinter.id },
    });

    try {
      // Try to move it to BAR — should 409
      const res = await request.patch(`${API}/printers/${kitchenPrinter.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { stations: ['BAR'] },
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


  // -------- Printer type (slice 8.7f) --------

  test('demo placeholder printers are gone and fixtures report NETWORK', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');

    // The seed no longer inserts placeholder hardware.
    const placeholderCount = execSync(
      `psql -h 127.0.0.1 -U citysquare -d citysquare -t -A -c "SELECT COUNT(*) FROM printers WHERE ip_address IN ('192.168.1.50','192.168.1.51','192.168.1.52');"`,
      { encoding: 'utf8' },
    ).trim();
    expect(placeholderCount).toBe('0');

    const res = await request.get(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const p of body.printers) {
      expect(['NETWORK', 'OS']).toContain(p.type);
      expect(Array.isArray(p.stations)).toBe(true);
    }
    for (const name of ['Test Kitchen Printer', 'Test Bar Printer', 'Test Receipt Printer']) {
      expect(body.printers.find((p: any) => p.name === name)?.type).toBe('NETWORK');
    }
  });

  test('no auto-generated test printers are left behind', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const res = await request.get(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const printers = (await res.json()).printers;
    const leftovers = printers.filter(
      (p: any) => p.name.startsWith('Test-OS-Printer-') || p.name.startsWith('Test Multi-'),
    );
    expect(leftovers).toEqual([]);
  });

  test('GET /printers response includes type field', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const res = await request.get(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.printers.length).toBeGreaterThan(0);
    for (const p of body.printers) {
      expect(p).toHaveProperty('type');
      expect(['NETWORK', 'OS']).toContain(p.type);
    }
  });

  test('test print surfaces the driver error for an unreachable printer', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const created = await request.post(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Test Unreachable Printer',
        type: 'NETWORK',
        stations: ['KITCHEN'],
        ipAddress: '127.0.0.1',
        port: 9,
      },
    });
    expect(created.status()).toBe(201);
    const printer = await created.json();

    try {
      const res = await request.post(`${API}/printers/${printer.id}/test`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(JSON.stringify(body)).toContain('PRINT_FAILED');

      // An inactive printer cannot be tested at all.
      await request.delete(`${API}/printers/${printer.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const inactive = await request.post(`${API}/printers/${printer.id}/test`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(inactive.status()).toBe(400);
      expect(JSON.stringify(await inactive.json())).toContain('PRINTER_INACTIVE');
    } finally {
      try {
        execSync(
          `psql -h 127.0.0.1 -U citysquare -d citysquare -c "DELETE FROM printers WHERE name = 'Test Unreachable Printer';"`,
          { stdio: 'ignore' },
        );
      } catch {}
    }
  });

  test('manager can change a non-default printer type to OS and back', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const printersRes = await request.get(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const printers = (await printersRes.json()).printers;

    const settingsRes = await request.get(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const settings = (await settingsRes.json()).settings;
    const defaultIds = new Set(
      [settings.printerDefaults.kitchen, settings.printerDefaults.bar, settings.printerDefaults.receipt]
        .filter(Boolean),
    );
    const target = printers.find((p: any) => !defaultIds.has(p.id) && p.isActive);
    expect(target).toBeTruthy();

    try {
      const patch = await request.patch(`${API}/printers/${target.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { type: 'OS' },
      });
      expect(patch.status()).toBe(200);
      const updated = await patch.json();
      expect(updated.type).toBe('OS');

      const verify = await request.get(`${API}/printers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const refreshed = (await verify.json()).printers;
      expect(refreshed.find((p: any) => p.id === target.id).type).toBe('OS');
    } finally {
      const restore = await request.patch(`${API}/printers/${target.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { type: 'NETWORK' },
      });
      expect(restore.status()).toBe(200);
      const restored = await restore.json();
      expect(restored.type).toBe('NETWORK');
    }
  });

  test('invalid printer type is rejected', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const printersRes = await request.get(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const printers = (await printersRes.json()).printers;
    expect(printers.length).toBeGreaterThan(0);
    const target = printers[0];

    const res = await request.patch(`${API}/printers/${target.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { type: 'BOGUS' },
    });
    expect(res.status()).toBe(400);
  });

  test('default printer type change rejected while non-default allows it', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');

    const beforeSettings = await request.get(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const before = (await beforeSettings.json()).settings;
    const originalKitchenDefault = before.printerDefaults.kitchen;
    const originalBarDefault = before.printerDefaults.bar;
    const originalReceiptDefault = before.printerDefaults.receipt;

    const allDefaultIds = new Set(
      [before.printerDefaults.kitchen, before.printerDefaults.bar, before.printerDefaults.receipt]
        .filter(Boolean),
    );

    const printersRes = await request.get(`${API}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const printers = (await printersRes.json()).printers;

    const kitchenPrinter = printers.find(
      (p: any) => p.stations.includes('KITCHEN') && p.isActive && p.type === 'NETWORK',
    );
    expect(kitchenPrinter).toBeTruthy();

    const otherPrinter = printers.find(
      (p: any) => p.isActive
        && p.type === 'NETWORK'
        && p.id !== kitchenPrinter.id
        && !allDefaultIds.has(p.id),
    );
    expect(otherPrinter).toBeTruthy();

    try {
      await request.patch(`${API}/settings`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { 'printer.default.kitchen': kitchenPrinter.id },
      });

      const blocked = await request.patch(`${API}/printers/${kitchenPrinter.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { type: 'OS' },
      });
      expect(blocked.status()).toBe(409);
      const blockedBody = await blocked.json();
      expect(blockedBody.code).toBe('PRINTER_IN_USE');

      const allowed = await request.patch(`${API}/printers/${otherPrinter.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { type: 'OS' },
      });
      expect(allowed.status()).toBe(200);
      const allowedBody = await allowed.json();
      expect(allowedBody.type).toBe('OS');

      const restoreOther = await request.patch(`${API}/printers/${otherPrinter.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { type: 'NETWORK' },
      });
      expect(restoreOther.status()).toBe(200);
    } finally {
      await request.patch(`${API}/settings`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: {
          'printer.default.kitchen': originalKitchenDefault,
          'printer.default.bar': originalBarDefault,
          'printer.default.receipt': originalReceiptDefault,
        },
      });
    }
  });

});

test.describe('Network access lock', () => {
  test('settings expose network mode and adapters', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const res = await request.get(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(['ALL', 'WIRED']).toContain(body.settings.networkAccess);
    expect(Array.isArray(body.network.adapters)).toBe(true);
    expect(Array.isArray(body.network.wiredSubnets)).toBe(true);
    expect(Array.isArray(body.network.warnings)).toBe(true);
    for (const adapter of body.network.adapters) {
      expect(['wired', 'wireless', 'virtual']).toContain(adapter.kind);
    }
  });

  test('manager can switch to cable-only and back', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      const on = await request.patch(`${API}/settings`, {
        headers,
        data: { network_access: 'WIRED' },
      });
      expect(on.status()).toBe(200);

      const afterOn = await (await request.get(`${API}/settings`, { headers })).json();
      expect(afterOn.settings.networkAccess).toBe('WIRED');
    } finally {
      const off = await request.patch(`${API}/settings`, {
        headers,
        data: { network_access: 'ALL' },
      });
      expect(off.status()).toBe(200);
    }
    const afterOff = await (await request.get(`${API}/settings`, { headers })).json();
    expect(afterOff.settings.networkAccess).toBe('ALL');
  });

  test('cashier cannot change network access', async ({ request }) => {
    const token = await loginAs(request, 'cashier1', 'waiter123');
    const res = await request.patch(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { network_access: 'WIRED' },
    });
    expect(res.status()).toBe(403);
  });

  test('rejects unknown network mode', async ({ request }) => {
    const token = await loginAs(request, 'manager', 'manager123');
    const res = await request.patch(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { network_access: 'SOMETIMES' },
    });
    expect(res.status()).toBe(400);
  });
});
