import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

async function loginAsWaiter(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Username').fill('john');
  await page.getByLabel('Password').fill('waiter123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/waiter$/);
}

test.describe('Waiter ordering flow', () => {
  test('table grid shows all tables', async ({ page }) => {
    await loginAsWaiter(page);
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();

    // Use exact:true so 'Table 1' doesn't match 'Table 10'
    await expect(page.getByText('Table 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Table 2', { exact: true })).toBeVisible();
    await expect(page.getByText('Table 10', { exact: true })).toBeVisible();

    // At least one table has an active order (Table 1 from backend tests).
    // We don't assert an exact count because the DB may have orders from other tests.
    const occupied = await page.locator('.table-card.occupied').count();
    expect(occupied).toBeGreaterThanOrEqual(1);
  });

  test('tapping a table opens the order page', async ({ page }) => {
    await loginAsWaiter(page);
    await page.getByText('Table 2', { exact: true }).click();
    await expect(page).toHaveURL(/\/waiter\/order\/[0-9a-f-]+/);
    await expect(page.getByText(/Taking order/)).toBeVisible();
  });

  test('sending items creates or appends to the table order', async ({ page }) => {
    await loginAsWaiter(page);

    // Pick a table (Table 4 - least likely to have been used)
    await page.getByText('Table 4', { exact: true }).click();
    await expect(page.getByText(/Taking order/)).toBeVisible();
    await expect(page.locator('.product-card').first()).toBeVisible();

    // Count existing sent items (may be 0 for fresh table, or more if re-run)
    const sentBefore = await page.locator('.sent-item').count();

    // Add two items
    await page.getByRole('button', { name: /Increase Ugali/ }).click();
    await page.getByRole('button', { name: /Increase Chips/ }).click();
    await expect(page.locator('.cart-bar .items-count')).toContainText('2 items');

    // Send
    await page.locator('.cart-bar').click();
    await page.getByRole('button', { name: 'Send to kitchen' }).click();

    // Toast — scoped to the toast element, not the section header
    await expect(page.locator('.toast')).toContainText('Sent to kitchen');

    // Sent section grew by exactly 2 (existing + new items)
    await expect(page.locator('.sent-section')).toBeVisible();
    await expect(page.locator('.sent-item')).toHaveCount(sentBefore + 2);

    // My Orders
    await page.getByRole('link', { name: 'My Orders' }).click();
    await expect(page.getByRole('heading', { name: 'My Orders' })).toBeVisible();
    await expect(page.locator('.order-card').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print bill' }).first()).toBeVisible();
  });

  test('returning to an active table shows already-sent items', async ({ page }) => {
    await loginAsWaiter(page);
    await page.getByText('Table 1', { exact: true }).click();
    await expect(page.locator('.sent-section')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Already sent to kitchen' })).toBeVisible();
  });
});
