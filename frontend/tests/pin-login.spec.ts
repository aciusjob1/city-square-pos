import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

test.describe('PIN login', () => {
  test('correct PIN authenticates and lands on /waiter', async ({ page }) => {
    await page.goto(`${BASE}/login`);

    // PIN tab is default
    await expect(page.getByRole('button', { name: 'Waiter PIN' })).toHaveClass(/active/);

    // Enter 1234 — each digit press via the keypad
    await page.locator('.pin-key', { hasText: /^1$/ }).click();
    await page.locator('.pin-key', { hasText: /^2$/ }).click();
    await page.locator('.pin-key', { hasText: /^3$/ }).click();
    await page.locator('.pin-key', { hasText: /^4$/ }).click();

    await expect(page).toHaveURL(/\/waiter$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
  });

  test('wrong PIN shows error and stays on /login', async ({ page }) => {
    await page.goto(`${BASE}/login`);

    await page.locator('.pin-key', { hasText: /^9$/ }).click();
    await page.locator('.pin-key', { hasText: /^9$/ }).click();
    await page.locator('.pin-key', { hasText: /^9$/ }).click();
    await page.locator('.pin-key', { hasText: /^9$/ }).click();

    await expect(page.locator('.error:not(.pin-dots)')).toContainText('Incorrect PIN');
    await expect(page).toHaveURL(/\/login$/);
    // Dots should be cleared after error
    await expect(page.locator('.pin-dot.filled')).toHaveCount(0);
  });

  test('password login still works via Staff tab', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByRole('button', { name: 'Staff Password' }).click();
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/manager/);
  });
});
