import { test, expect, APIRequestContext } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = 'http://localhost:3000/api';
const TZ = 'Africa/Dar_es_Salaam';

function dayISO(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

async function login(request: APIRequestContext, username: string, password: string) {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).accessToken as string;
}

async function createOrder(request: APIRequestContext, waiterToken: string) {
  const auth = { Authorization: `Bearer ${waiterToken}` };
  const tables = await (await request.get(`${API}/tables`, { headers: auth })).json();
  const table = tables.tables.find((t: any) => !t.activeOrderId) ?? tables.tables[0];
  const products = await (await request.get(`${API}/products`, { headers: auth })).json();
  const product = products.products[0];
  const res = await request.post(`${API}/orders`, {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: {
      clientUuid: crypto.randomUUID(),
      tableId: table.id,
      orderType: 'DINE_IN',
      items: [{ productId: product.id, quantity: 1 }],
    },
  });
  expect(res.ok()).toBeTruthy();
  return await res.json();
}

// psql runs from the same env as the global setup (PGPORT/PGPASSWORD on PATH).
function runSql(sql: string) {
  const dir = mkdtempSync(join(tmpdir(), 'city-square-spec-'));
  const file = join(dir, 'spec.sql');
  try {
    writeFileSync(file, sql);
    execSync(`psql -h 127.0.0.1 -U citysquare -d citysquare -f "${file}"`, { stdio: 'ignore' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.describe('Business day and shared orders', () => {
  test('cashier and manager see print jobs from every waiter', async ({ request }) => {
    const waiterToken = await login(request, 'john', 'waiter123');
    const cashierToken = await login(request, 'cashier1', 'waiter123');
    const managerToken = await login(request, 'manager', 'manager123');

    const order = await createOrder(request, waiterToken);

    for (const token of [cashierToken, managerToken]) {
      const res = await request.get(`${API}/print-jobs?limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      const job = body.printJobs.find((j: any) => j.order_number === order.orderNumber);
      expect(job, `print job for ${order.orderNumber}`).toBeTruthy();
      expect(job.waiter_full_name).toBe('John Waiter');
    }

    // A waiter only sees their own jobs, never someone else's cross-waiter feed.
    const own = await request.get(`${API}/print-jobs?limit=200`, {
      headers: { Authorization: `Bearer ${waiterToken}` },
    });
    const ownBody = await own.json();
    expect(ownBody.printJobs.every((j: any) => j.waiter_full_name === 'John Waiter')).toBeTruthy();
  });

  test('orders list filters by business date and validates the range', async ({ request }) => {
    const cashierToken = await login(request, 'cashier1', 'waiter123');
    const headers = { Authorization: `Bearer ${cashierToken}` };
    const today = dayISO();

    await createOrder(request, await login(request, 'john', 'waiter123'));

    const res = await request.get(`${API}/orders?from=${today}&to=${today}&limit=500`, { headers });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.count).toBeGreaterThan(0);
    for (const o of body.orders) {
      const created = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(o.serverCreatedAt));
      expect(created).toBe(today);
    }

    const inverted = await request.get(`${API}/orders?from=2030-01-02&to=2030-01-01`, { headers });
    expect(inverted.status()).toBe(400);

    const badFormat = await request.get(`${API}/print-jobs?from=12-11-2026`, { headers });
    expect(badFormat.status()).toBe(400);
  });

  test('cashier can cancel an order; waiter cannot', async ({ request }) => {
    const waiterToken = await login(request, 'john', 'waiter123');
    const cashierToken = await login(request, 'cashier1', 'waiter123');
    const order = await createOrder(request, waiterToken);

    const denied = await request.post(`${API}/orders/${order.id}/cancel`, {
      headers: { Authorization: `Bearer ${waiterToken}`, 'Content-Type': 'application/json' },
      data: { reason: 'waiter should not cancel' },
    });
    expect(denied.status()).toBe(403);

    const cancel = await request.post(`${API}/orders/${order.id}/cancel`, {
      headers: { Authorization: `Bearer ${cashierToken}`, 'Content-Type': 'application/json' },
      data: { reason: 'customer changed mind' },
    });
    expect(cancel.ok()).toBeTruthy();
    const cancelled = await cancel.json();
    expect(cancelled.status).toBe('CANCELLED');

    const again = await request.post(`${API}/orders/${order.id}/cancel`, {
      headers: { Authorization: `Bearer ${cashierToken}`, 'Content-Type': 'application/json' },
      data: { reason: 'double cancel' },
    });
    expect(again.status()).toBe(409);

    const list = await (await request.get(`${API}/orders?limit=500`, {
      headers: { Authorization: `Bearer ${cashierToken}` },
    })).json();
    const row = list.orders.find((o: any) => o.id === order.id);
    expect(row.cancelledAt).toBeTruthy();
    expect(row.cancellationReason).toBe('customer changed mind');

    const adminToken = await login(request, 'admin', 'admin123');
    const adminList = await request.get(`${API}/orders?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(adminList.ok()).toBeTruthy();
  });

  test('day lifecycle: close, open and rollover via API', async ({ request }) => {
    const managerToken = await login(request, 'manager', 'manager123');
    const cashierToken = await login(request, 'cashier1', 'waiter123');
    const managerHeaders = { Authorization: `Bearer ${managerToken}` };
    const cashierHeaders = { Authorization: `Bearer ${cashierToken}` };

    // Explicit close/open behaviour only applies in MANUAL mode.
    const manual = await request.patch(`${API}/settings`, {
      headers: { ...managerHeaders, 'Content-Type': 'application/json' },
      data: { 'day.rollover_mode': 'MANUAL' },
    });
    expect(manual.ok()).toBeTruthy();

    // Normalise to exactly one open day for today.
    const rollover = await request.post(`${API}/day/rollover`, {
      headers: managerHeaders, data: { force: true },
    });
    expect(rollover.ok()).toBeTruthy();
    const first = await rollover.json();
    expect(first.openDay).toBeTruthy();
    expect(first.openDay.businessDate).toBe(dayISO());

    const openAgain = await request.post(`${API}/day/open`, {
      headers: managerHeaders, data: {},
    });
    expect(openAgain.status()).toBe(409);

    const closed = await request.post(`${API}/day/close`, {
      headers: managerHeaders, data: { force: true },
    });
    expect(closed.ok()).toBeTruthy();
    const closedBody = await closed.json();
    expect(closedBody.openDay).toBeNull();
    expect(closedBody.lastClosedDay.businessDate).toBe(dayISO());

    const closeAgain = await request.post(`${API}/day/close`, {
      headers: managerHeaders, data: {},
    });
    expect(closeAgain.status()).toBe(400);

    const reopened = await request.post(`${API}/day/open`, {
      headers: managerHeaders, data: {},
    });
    expect(reopened.ok()).toBeTruthy();
    expect((await reopened.json()).openDay).toBeTruthy();

    // Cashier has the same operational control as the manager.
    const cashierRollover = await request.post(`${API}/day/rollover`, {
      headers: cashierHeaders, data: { force: true },
    });
    expect(cashierRollover.ok()).toBeTruthy();
    expect((await cashierRollover.json()).openDay).toBeTruthy();

    const waiterToken = await login(request, 'john', 'waiter123');
    const denied = await request.get(`${API}/day/status`, {
      headers: { Authorization: `Bearer ${waiterToken}` },
    });
    expect(denied.status()).toBe(403);
  });

  test('rollover mode setting validates and AUTO closes a stale day', async ({ request }) => {
    const managerToken = await login(request, 'manager', 'manager123');
    const headers = { Authorization: `Bearer ${managerToken}`, 'Content-Type': 'application/json' };

    const auto = await request.patch(`${API}/settings`, {
      headers, data: { 'day.rollover_mode': 'AUTO' },
    });
    expect(auto.ok()).toBeTruthy();
    const autoSettings = await (await request.get(`${API}/settings`, { headers })).json();
    expect(autoSettings.settings.dayRolloverMode).toBe('AUTO');

    const invalid = await request.patch(`${API}/settings`, {
      headers, data: { 'day.rollover_mode': 'WEEKLY' },
    });
    expect(invalid.status()).toBe(400);

    // Make the open session look like yesterday's business day.
    runSql(
      `UPDATE business_days
          SET business_date = CURRENT_DATE - 1,
              opened_at = (CURRENT_DATE - 1)::timestamp AT TIME ZONE 'Africa/Dar_es_Salaam'
        WHERE closed_at IS NULL;`,
    );

    const status = await request.get(`${API}/day/status`, { headers });
    expect(status.ok()).toBeTruthy();
    const body = await status.json();
    expect(body.mode).toBe('AUTO');
    expect(body.openDay.businessDate).toBe(dayISO());
    expect(body.lastClosedDay.businessDate).toBe(dayISO(-1));

    const manual = await request.patch(`${API}/settings`, {
      headers, data: { 'day.rollover_mode': 'MANUAL' },
    });
    expect(manual.ok()).toBeTruthy();
    const manualSettings = await (await request.get(`${API}/settings`, { headers })).json();
    expect(manualSettings.settings.dayRolloverMode).toBe('MANUAL');
  });

  test('manager Orders tab lists orders and cancels through the UI', async ({ page, request }) => {
    const order = await createOrder(request, await login(request, 'john', 'waiter123'));

    await page.goto('/login');
    await page.getByLabel('Username').fill('manager');
    await page.getByLabel('Password').fill('manager123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/manager$/, { timeout: 10000 });

    await page.locator('.manager-tabs').getByRole('link', { name: 'Orders', exact: true }).click();
    await expect(page).toHaveURL(/\/manager\/orders$/);
    await expect(page.getByRole('heading', { name: 'Orders & Bills' })).toBeVisible();

    await page.locator('.cashier-tabs').getByRole('button', { name: /^Open/ }).click();
    await page.locator('.cashier-search input').fill(order.orderNumber);
    await expect(page.locator('.cashier-row').first()).toBeVisible();
    await page.locator('.cashier-row-header').first().click();

    const cancelBtn = page.getByRole('button', { name: 'Cancel order' });
    await expect(cancelBtn).toBeVisible({ timeout: 10000 });

    page.on('dialog', async (d) => {
      if (d.type() === 'prompt') await d.accept('changed mind');
      else await d.accept();
    });
    await cancelBtn.click();
    await expect(page.locator('.toast')).toContainText(`${order.orderNumber} cancelled`);
  });

  test('cashier Print Jobs page shows other waiters’ tickets with a date filter', async ({ page, request }) => {
    const order = await createOrder(request, await login(request, 'john', 'waiter123'));

    await page.goto('/login');
    await page.getByLabel('Username').fill('cashier1');
    await page.getByLabel('Password').fill('waiter123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/cashier$/, { timeout: 10000 });

    await page.locator('.cashier-quick-grid').getByRole('link', { name: /Print Jobs/ }).click();
    await expect(page).toHaveURL(/\/print-jobs$/);
    await expect(page.getByRole('heading', { name: 'Print Jobs' })).toBeVisible();

    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.locator('.page-search input').fill(order.orderNumber);
    await expect(page.locator('.print-job-wrapper').first()).toBeVisible();
    await expect(page.locator('.print-job-wrapper').first()).toContainText('John Waiter');
  });
});
