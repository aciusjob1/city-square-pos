import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

test.beforeEach(async () => {
  // Clear any bill groups left over from prior test runs
  try {
    execSync(
      'psql -U citysquare -d citysquare -c "UPDATE orders SET bill_group_id = NULL WHERE bill_group_id IS NOT NULL AND closed_at IS NULL;"',
      { stdio: 'ignore' },
    );
  } catch {}
});

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
    if (!emptyTable) {
      test.skip(true, 'No empty table available');
      return;
    }

    const productsRes = await request.get('http://localhost:3000/api/products', {
      headers: { Authorization: `Bearer ${johnToken}` },
    });
    const product = (await productsRes.json()).products[0];

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
    await page.goto('/login');
    await page.getByLabel('Username').fill('cashier1');
    await page.getByLabel('Password').fill('waiter123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/cashier/, { timeout: 10000 });

    // Clear any stray search filter
    const searchInput = page.locator('.cashier-search input');
    if (await searchInput.count() > 0) await searchInput.fill('');

    // Find the two orders by searching
    await searchInput.fill(orderABody.orderNumber);
    await expect(page.locator('.cashier-row').first()).toBeVisible();
    await page.locator('.cashier-checkbox input').first().check();

    await searchInput.fill(orderBBody.orderNumber);
    await expect(page.locator('.cashier-row').first()).toBeVisible();
    await page.locator('.cashier-checkbox input').first().check();

    // Merge bar visible
    await expect(page.locator('.merge-bar')).toBeVisible();
    await expect(page.locator('.merge-bar-info')).toContainText('2 orders selected');

    // Clear search
    await searchInput.fill('');

    // Click Merge
    await page.getByRole('button', { name: 'Merge into one bill' }).click();
    await expect(page.locator('.toast')).toContainText('Merged');

    // The merged group row appears
    await expect(page.locator('.cashier-row-group').first()).toBeVisible();
    await expect(page.locator('.group-grand-total').first()).toBeVisible();

    // Find the Print Consolidated Bill button belonging to OUR group
    // and click the first one (ours is newest since we just merged)
    const printBtn = page.locator('.cashier-row-group').first()
      .getByRole('button', { name: 'Print Consolidated Bill' });
    await printBtn.click();
    await expect(page.locator('.toast')).toContainText(/Consolidated bill printed/);

    // After print, the order is closed
    await page.reload();
    await searchInput.fill(orderABody.orderNumber);
    await expect(page.locator('.cashier-row')).toHaveCount(0);
  });
});
