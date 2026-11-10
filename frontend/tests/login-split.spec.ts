import { test, expect } from '@playwright/test';

test.describe('Login split (staff vs waiter)', () => {
  test('/login exposes only staff form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.locator('.keypad')).toHaveCount(0);
    await expect(page.locator('.pin-indicators')).toHaveCount(0);
  });

  test('/w/login exposes only waiter PIN pad', async ({ page }) => {
    await page.goto('/w/login');
    await expect(page.locator('.keypad')).toBeVisible();
    await expect(page.locator('.pin-indicators')).toBeVisible();
    await expect(page.getByLabel('Username')).toHaveCount(0);
    await expect(page.getByLabel('Password')).toHaveCount(0);
  });

  test('staff cannot enter a PIN on /login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();
    await page.getByLabel('Username').fill('1234');
    await expect(page.locator('.keypad')).toHaveCount(0);
  });

  test('waiter cannot enter password on /w/login', async ({ page }) => {
    await page.goto('/w/login');
    await expect(page.locator('.keypad')).toBeVisible();
    await expect(page.getByLabel('Username')).toHaveCount(0);
    await expect(page.getByLabel('Password')).toHaveCount(0);
  });

  test('waiter logged in via PIN is bounced off /login back to /waiter', async ({ page }) => {
    await page.goto('/w/login');
    await page.locator('.keypad button', { hasText: /^1$/ }).click();
    await page.locator('.keypad button', { hasText: /^2$/ }).click();
    await page.locator('.keypad button', { hasText: /^3$/ }).click();
    await page.locator('.keypad button', { hasText: /^4$/ }).click();
    await expect(page).toHaveURL(/\/waiter$/, { timeout: 10000 });
    await page.goto('/login');
    await expect(page).toHaveURL(/\/waiter/);
  });

  test('staff logged in via password is bounced off /w/login back to /manager', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/manager/);
    await page.goto('/w/login');
    await expect(page).toHaveURL(/\/manager/);
  });
});
