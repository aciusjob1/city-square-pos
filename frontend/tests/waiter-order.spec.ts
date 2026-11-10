import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

async function loginAsWaiter(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/w/login`);
  await page.locator('.keypad button', { hasText: /^1$/ }).click();
  await page.locator('.keypad button', { hasText: /^2$/ }).click();
  await page.locator('.keypad button', { hasText: /^3$/ }).click();
  await page.locator('.keypad button', { hasText: /^4$/ }).click();
  await expect(page).toHaveURL(/\/waiter$/, { timeout: 10000 });
}

async function switchToPasswordTab(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Staff Password' }).click();
}


test.describe('Waiter ordering flow', () => {
  test('table grid shows all tables', async ({ page }) => {
    await loginAsWaiter(page);
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
    await expect(page.getByText('Table 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Table 10', { exact: true })).toBeVisible();
  });

  test('tapping a table opens the order page', async ({ page }) => {
    await loginAsWaiter(page);
    await page.getByText('Table 2', { exact: true }).click();
    await expect(page).toHaveURL(/\/waiter\/order\/[0-9a-f-]+/);
    await expect(page.getByText(/Taking order/)).toBeVisible();
  });

  test('sending items creates or appends to a table order', async ({ page }) => {
    await loginAsWaiter(page);

    // Use Table 5 — least likely to have state from prior runs
    await page.getByText('Table 5', { exact: true }).click();
    await expect(page.getByText(/Taking order/)).toBeVisible();
    await expect(page.locator('.product-card').first()).toBeVisible();

    // IMPORTANT: wait until the page finishes loading any existing order.
    // The order fetch happens after products load. Give the sent-section
    // time to appear (or confirm it's not going to).
    await page.waitForTimeout(1500);

    const sentBefore = await page.locator('.sent-item').count();

    // Add two items
    await page.getByRole('button', { name: /Increase Ugali/ }).click();
    await page.getByRole('button', { name: /Increase Chips/ }).click();
    await expect(page.locator('.cart-bar .items-count')).toContainText('2 items');

    // Send
    await page.locator('.cart-bar').click();
    await page.getByRole('button', { name: 'Send to kitchen' }).click();
    await expect(page.locator('.toast')).toContainText('Sent to kitchen');

    // Sent section grew by exactly 2
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

    // Step 1: create an order on Table 6 (fresh per run)
    await page.getByText('Table 6', { exact: true }).click();
    await expect(page.getByText(/Taking order/)).toBeVisible();
    await expect(page.locator('.product-card').first()).toBeVisible();

    await page.getByRole('button', { name: /Increase Ugali/ }).click();
    await expect(page.locator('.cart-bar .items-count')).toContainText('1 item');

    await page.locator('.cart-bar').click();
    await page.getByRole('button', { name: 'Send to kitchen' }).click();
    await expect(page.locator('.toast')).toContainText('Sent to kitchen');

    // Step 2: go back to Tables and re-open Table 6
    await page.getByRole('link', { name: 'Tables' }).click();
    await expect(page).toHaveURL(/\/waiter$/);
    await expect(page.getByText('Table 6', { exact: true })).toBeVisible();

    await page.getByText('Table 6', { exact: true }).click();
    await expect(page.getByText(/Taking order/)).toBeVisible();

    // Step 3: the sent section should now show the item from step 1
    await expect(page.locator('.sent-section')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Already sent to kitchen' })).toBeVisible();
    await expect(page.locator('.sent-item').first()).toBeVisible();
  });
});
