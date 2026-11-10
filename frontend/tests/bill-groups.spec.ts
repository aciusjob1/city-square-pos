import { test, expect } from '@playwright/test';

async function loginAsCashier(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('cashier1');
  await page.getByLabel('Password').fill('waiter123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/cashier/, { timeout: 10000 });
}

test.describe('Cashier bill groups', () => {
  test('two orders from different waiters on same table merge into one bill', async ({ page, request }) => {
    // Setup: create two orders on a fresh table from two different waiters
    const johnLogin = await request.post('http://localhost:3000/api/auth/login', {
      data: { username: 'john', password: 'waiter123' },
    });
    const johnToken = (await johnLogin.json()).accessToken;

    const fatmaLogin = await request.post('http://localhost:3000/api/auth/login', {
      data: { username: 'fatma', password: 'waiter123' },
    });
    const fatmaToken = (await fatmaLogin.json()).accessToken;
    expect(fatmaToken).toBeTruthy();

    // Get an empty table
    const tablesRes = await request.get('http://localhost:3000/api/tables', {
      headers: { Authorization: `Bearer ${johnToken}` },
    });
    const tables = (await tablesRes.json()).tables;
    const emptyTable = tables.find((t: any) => !t.activeOrderId);
    expect(emptyTable).toBeTruthy();

    const productsRes = await request.get('http://localhost:3000/api/products', {
      headers: { Authorization: `Bearer ${johnToken}` },
    });
    const products = (await productsRes.json()).products;
    const product = products[0];

    // John's order
    const orderA = await request.post('http://localhost:3000/api/orders', {
      headers: { Authorization: `Bearer ${johnToken}`, 'Content-Type': 'application/json' },
      data: {
        clientUuid: crypto.randomUUID(),
        tableId: emptyTable.id,
        orderType: 'DINE_IN',
        items: [{ productId: product.id, quantity: 2 }],
      },
    });
    const orderABody = await orderA.json();
    expect(orderABody.orderNumber).toMatch(/^CS-/);

    // Fatma's order on SAME table
    const orderB = await request.post('http://localhost:3000/api/orders', {
      headers: { Authorization: `Bearer ${fatmaToken}`, 'Content-Type': 'application/json' },
      data: {
        clientUuid: crypto.randomUUID(),
        tableId: emptyTable.id,
        orderType: 'DINE_IN',
        items: [{ productId: product.id, quantity: 1 }],
      },
    });
    const orderBBody = await orderB.json();
    expect(orderBBody.orderNumber).toMatch(/^CS-/);

    // Login as cashier via UI
    await loginAsCashier(page);
    await expect(page.getByRole('heading', { name: 'Cashier' })).toBeVisible();

    // Find both orders by searching
    await page.locator('.cashier-search input').fill(orderABody.orderNumber);
    await expect(page.locator('.cashier-row').first()).toBeVisible();

    // Check the checkbox for John's order
    await page.locator('.cashier-checkbox input').first().check();

    // Clear and search for Fatma's
    await page.locator('.cashier-search input').fill(orderBBody.orderNumber);
    await expect(page.locator('.cashier-row').first()).toBeVisible();
    await page.locator('.cashier-checkbox input').first().check();

    // Both should still be selected — merge bar visible
    await expect(page.locator('.merge-bar')).toBeVisible();
    await expect(page.locator('.merge-bar-info')).toContainText('2 orders selected');

    // Clear search to see both
    await page.locator('.cashier-search input').fill('');
    await expect(page.locator('.merge-bar')).toBeVisible();

    // Click Merge
    await page.getByRole('button', { name: 'Merge into one bill' }).click();
    await expect(page.locator('.toast')).toContainText('Merged');

    // The merged group row should appear
    await expect(page.locator('.cashier-row-group').first()).toBeVisible();
    await expect(page.locator('.group-grand-total')).toBeVisible();

    // Print consolidated bill
    await page.getByRole('button', { name: 'Print Consolidated Bill' }).click();
    await expect(page.locator('.toast')).toContainText(/Consolidated bill printed/);

    // After print, the group row is gone from Open (both orders now closed)
    await page.reload();
    await page.locator('.cashier-search input').fill(orderABody.orderNumber);
    await expect(page.locator('.cashier-row')).toHaveCount(0);
  });
});
