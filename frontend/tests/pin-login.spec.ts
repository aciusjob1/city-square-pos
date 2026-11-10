import { test, expect } from '@playwright/test';

test.describe('Waiter PIN login', () => {
  test('/w/login shows PIN keypad only — no password form', async ({ page }) => {
    await page.goto('/w/login');
    await expect(page.getByRole('heading', { name: 'City Square' })).toBeVisible();
    await expect(page.locator('.keypad')).toBeVisible();
    await expect(page.locator('.pin-indicators')).toBeVisible();
    await expect(page.locator('.pin-indicators span')).toHaveCount(4);
    await expect(page.getByLabel('Username')).toHaveCount(0);
    await expect(page.getByLabel('Password')).toHaveCount(0);
    await expect(page.locator('.staff-form')).toHaveCount(0);
  });

  test('correct PIN authenticates and lands on /waiter', async ({ page }) => {
    await page.goto('/w/login');
    await page.locator('.keypad button', { hasText: /^1$/ }).click();
    await page.locator('.keypad button', { hasText: /^2$/ }).click();
    await page.locator('.keypad button', { hasText: /^3$/ }).click();
    await page.locator('.keypad button', { hasText: /^4$/ }).click();
    await expect(page).toHaveURL(/\/waiter$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
  });

  test('wrong PIN shows error and stays on /w/login', async ({ page }) => {
    await page.goto('/w/login');
    await page.locator('.keypad button', { hasText: /^9$/ }).click();
    await page.locator('.keypad button', { hasText: /^9$/ }).click();
    await page.locator('.keypad button', { hasText: /^9$/ }).click();
    await page.locator('.keypad button', { hasText: /^9$/ }).click();
    await expect(page.locator('.login-error.error')).toContainText('Incorrect PIN');
    await expect(page).toHaveURL(/\/w\/login/);
    await expect(page.locator('.pin-indicators span.filled')).toHaveCount(0);
  });

  test('refresh preserves waiter session on /waiter', async ({ page }) => {
    await page.goto('/w/login');
    await page.locator('.keypad button', { hasText: /^1$/ }).click();
    await page.locator('.keypad button', { hasText: /^2$/ }).click();
    await page.locator('.keypad button', { hasText: /^3$/ }).click();
    await page.locator('.keypad button', { hasText: /^4$/ }).click();
    await expect(page).toHaveURL(/\/waiter$/, { timeout: 10000 });
    await page.reload();
    await expect(page).toHaveURL(/\/waiter$/);
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
  });

  test('refresh on /w/login with valid waiter session redirects to /waiter', async ({ page }) => {
    await page.goto('/w/login');
    await page.locator('.keypad button', { hasText: /^1$/ }).click();
    await page.locator('.keypad button', { hasText: /^2$/ }).click();
    await page.locator('.keypad button', { hasText: /^3$/ }).click();
    await page.locator('.keypad button', { hasText: /^4$/ }).click();
    await expect(page).toHaveURL(/\/waiter$/, { timeout: 10000 });
    await page.goto('/w/login');
    await expect(page).toHaveURL(/\/waiter$/);
  });
});
