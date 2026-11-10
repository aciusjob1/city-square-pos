import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';

async function loginAs(request: any, username: string, password: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  const body = await res.json();
  if (!body.accessToken) throw new Error(`Login failed for ${username}: ${JSON.stringify(body)}`);
  return body.accessToken as string;
}

async function seedKitchenOrder(
  request: any,
  opts: { includeBarItem?: boolean } = {},
): Promise<{ orderId: string; kitchenProductName: string; barProductName: string | null }> {
  const waiterToken = await loginAs(request, 'john', 'waiter123');

  const tablesRes = await request.get(`${API}/tables`, {
    headers: { Authorization: `Bearer ${waiterToken}` },
  });
  const tables = (await tablesRes.json()).tables;
  const emptyTable = tables.find((t: any) => !t.activeOrderId);
  if (!emptyTable) throw new Error('No empty table for kitchen test');

  const productsRes = await request.get(`${API}/products`, {
    headers: { Authorization: `Bearer ${waiterToken}` },
  });
  const products = (await productsRes.json()).products;
  const kitchenProduct = products.find((p: any) => p.preparationStation === 'KITCHEN');
  const barProduct = products.find((p: any) => p.preparationStation === 'BAR');
  if (!kitchenProduct) throw new Error('No KITCHEN product in seed data');

  // Seed in a single create call — matches OrderPage.tsx behavior.
  // POST /api/orders requires items at create-time (CreateOrderDto).
  const items: any[] = [
    { productId: kitchenProduct.id, quantity: 2 },
  ];
  if (opts.includeBarItem && barProduct) {
    items.push({ productId: barProduct.id, quantity: 1 });
  }

  const orderRes = await request.post(`${API}/orders`, {
    headers: { Authorization: `Bearer ${waiterToken}`, 'Content-Type': 'application/json' },
    data: {
      clientUuid: crypto.randomUUID(),
      tableId: emptyTable.id,
      orderType: 'DINE_IN',
      items,
    },
  });
  if (!orderRes.ok()) {
    throw new Error(`Seed create failed: ${orderRes.status()} ${await orderRes.text()}`);
  }
  const order = await orderRes.json();

  return {
    orderId: order.id,
    kitchenProductName: kitchenProduct.name,
    barProductName: barProduct?.name ?? null,
  };
}

test.describe('Kitchen display (read-only)', () => {
  test.beforeEach(() => {
    execSync(
      `psql -h 127.0.0.1 -U citysquare -d citysquare -c "UPDATE orders SET status = 'SENT_TO_KITCHEN'::\\"OrderStatus\\" WHERE status = 'PREPARING'::\\"OrderStatus\\" AND cancelled_at IS NULL;"`,
      { stdio: 'inherit' },
    );
  });

  test('KITCHEN login lands on /kitchen', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('kitchen-test');
    await page.getByLabel('Password').fill('kitchen-test-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/kitchen$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Kitchen', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Kitchen', exact: true })).toHaveCount(1);
    await expect(page.locator('text=TZS')).toHaveCount(0);
    await expect(page.locator('.kitchen-card button')).toHaveCount(0);
  });

  test('pending kitchen order appears with its items', async ({ page, request }) => {
    const { kitchenProductName } = await seedKitchenOrder(request);

    await page.goto('/login');
    await page.getByLabel('Username').fill('kitchen-test');
    await page.getByLabel('Password').fill('kitchen-test-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/kitchen$/, { timeout: 10000 });

    const card = page.locator('.kitchen-card').filter({ hasText: kitchenProductName }).first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card.locator('.kitchen-items')).toContainText(kitchenProductName);
    await expect(card.locator('.kitchen-qty').first()).toContainText('2');
    await expect(card).not.toContainText('TZS');
  });

  test('only KITCHEN-station items appear (BAR excluded)', async ({ page, request }) => {
    const { kitchenProductName, barProductName } = await seedKitchenOrder(request, { includeBarItem: true });
    if (!barProductName) {
      test.skip(true, 'No BAR product in seed data');
      return;
    }

    await page.goto('/login');
    await page.getByLabel('Username').fill('kitchen-test');
    await page.getByLabel('Password').fill('kitchen-test-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/kitchen$/, { timeout: 10000 });

    await expect(
      page.locator('.kitchen-card').filter({ hasText: kitchenProductName }).first(),
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator('.kitchen-card').filter({ hasText: barProductName }),
    ).toHaveCount(0);
  });

  test('kitchen cannot modify orders (role enforcement)', async ({ request }) => {
    const kitchenToken = await loginAs(request, 'kitchen-test', 'kitchen-test-password');
    const { orderId } = await seedKitchenOrder(request);

    const cancelRes = await request.post(`${API}/orders/${orderId}/cancel`, {
      headers: { Authorization: `Bearer ${kitchenToken}`, 'Content-Type': 'application/json' },
      data: { reason: 'test' },
    });
    expect(cancelRes.status()).toBe(403);

    const appendRes = await request.post(`${API}/orders/${orderId}/items`, {
      headers: { Authorization: `Bearer ${kitchenToken}`, 'Content-Type': 'application/json' },
      data: { clientUuid: crypto.randomUUID(), items: [] },
    });
    expect(appendRes.status()).toBe(403);

    const createRes = await request.post(`${API}/orders`, {
      headers: { Authorization: `Bearer ${kitchenToken}`, 'Content-Type': 'application/json' },
      data: {
        clientUuid: crypto.randomUUID(),
        tableId: null,
        orderType: 'TAKEAWAY',
        items: [{ productId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
      },
    });
    expect(createRes.status()).toBe(403);

    const detailRes = await request.get(`${API}/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${kitchenToken}` },
    });
    expect(detailRes.status()).toBe(403);
  });
});
