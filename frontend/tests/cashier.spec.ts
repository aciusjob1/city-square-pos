import { test, expect } from '@playwright/test';

async function loginAsCashier(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('cashier1');
  await page.getByLabel('Password').fill('waiter123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/cashier/, { timeout: 10000 });
}

test.describe('Cashier dashboard', () => {
  test('cashier expands an order, prints bill, order moves to Closed', async ({ page, request }) => {
    // 1) Create a fresh order via API so the test always has one open order
    const loginRes = await request.post('http://localhost:3000/api/auth/login', {
      data: { username: 'john', password: 'waiter123' },
    });
    const loginBody = await loginRes.json();
    const waiterToken = loginBody.accessToken as string;

    const tablesRes = await request.get('http://localhost:3000/api/tables', {
      headers: { Authorization: `Bearer ${waiterToken}` },
    });
    const tablesBody = await tablesRes.json();
    const emptyTable = tablesBody.tables.find((t: any) => !t.activeOrderId) || tablesBody.tables[0];

    const productsRes = await request.get('http://localhost:3000/api/products', {
      headers: { Authorization: `Bearer ${waiterToken}` },
    });
    const productsBody = await productsRes.json();
    const product = productsBody.products[0];

    const orderRes = await request.post('http://localhost:3000/api/orders', {
      headers: {
        Authorization: `Bearer ${waiterToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        clientUuid: crypto.randomUUID(),
        tableId: emptyTable.id,
        orderType: 'DINE_IN',
        items: [{ productId: product.id, quantity: 1 }],
      },
    });
    const orderBody = await orderRes.json();
    expect(orderBody.orderNumber).toMatch(/^CS-/);

    // 2) Now perform the test via UI
    await loginAsCashier(page);
    await expect(page.getByRole('heading', { name: 'Cashier' })).toBeVisible();

    // Ensure the order we created is visible in Open
    await page.getByRole('button', { name: /^Open/ }).click();
    await expect(page.locator('.cashier-row').first()).toBeVisible();

    // Find our specific order by order number
    await page.locator('.cashier-search input').fill(orderBody.orderNumber);
    await expect(page.locator('.cashier-row').first()).toBeVisible();

    // Expand it
    await page.locator('.cashier-row-header').first().click();
    await expect(page.getByRole('button', { name: 'Print Bill' })).toBeVisible();

    // Print
    await page.getByRole('button', { name: 'Print Bill' }).click();
    await expect(page.locator('.toast')).toContainText(/Bill (sent|re-printed)/i);

    // Clear search, refresh
    await page.locator('.cashier-search input').fill('');
    await page.reload();

    // Order is no longer in Open filter
    await page.getByRole('button', { name: /^Open/ }).click();
    await page.locator('.cashier-search input').fill(orderBody.orderNumber);
    await expect(page.locator('.cashier-row')).toHaveCount(0);

    // And it IS in All filter
    await page.getByRole('button', { name: /^All/ }).click();
    await page.locator('.cashier-search input').fill(orderBody.orderNumber);
    await expect(page.locator('.cashier-row').first()).toBeVisible();

    // Expand again — no Print Bill button (already printed)
    await page.locator('.cashier-row-header').first().click();
    await expect(page.getByRole('button', { name: 'Print Bill' })).toHaveCount(0);
  });

  test('search filters by order number', async ({ page }) => {
    await loginAsCashier(page);
    await expect(page.getByRole('heading', { name: 'Cashier' })).toBeVisible();

    await page.locator('.cashier-tabs button', { hasText: 'All' }).click();
    await expect(page.locator('.cashier-row').first()).toBeVisible();

    const firstOrder = await page.locator('.cashier-row .order-num').first().textContent();
    if (!firstOrder) {
      test.skip(true, 'No orders to search');
      return;
    }

    const searchTerm = firstOrder.trim().slice(0, 10);
    await page.locator('.cashier-search input').fill(searchTerm);
    await expect(page.locator('.cashier-row').first()).toBeVisible();

    await page.locator('.cashier-search input').fill('zzz-no-such-order-xyz');
    await expect(page.locator('.cashier-row')).toHaveCount(0);
  });
});
