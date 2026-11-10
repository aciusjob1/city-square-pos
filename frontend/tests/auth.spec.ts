import { test, expect } from '@playwright/test';

test.describe('Staff login (username + password)', () => {
  test('login page renders staff form only', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'City Square' })).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    // PIN keypad must NOT exist on the staff login page
    await expect(page.locator('.keypad')).toHaveCount(0);
    await expect(page.locator('.pin-indicators')).toHaveCount(0);
  });

  test('wrong password shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('wrongpass');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.locator('.error')).toContainText('Invalid credentials');
    await expect(page).toHaveURL(/\/login/);
  });

  test('admin login lands on manager', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/manager/);
  });

  test('cashier login lands on cashier', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('cashier1');
    await page.getByLabel('Password').fill('waiter123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/cashier/);
  });

  test('manager login lands on manager', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('manager');
    await page.getByLabel('Password').fill('manager123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/manager/);
  });

  test('sign out clears session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/manager/);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    const token = await page.evaluate(() => localStorage.getItem('cs_auth_token'));
    expect(token).toBeNull();
  });

  test('refresh preserves staff session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/manager/);
    await page.reload();
    await expect(page).toHaveURL(/\/manager/);
  });

  test('waiter cannot access staff pages (role enforcement)', async ({ page }) => {
    // Login as waiter via PIN
    await page.goto('/w/login');
    await page.locator('.keypad button', { hasText: /^1$/ }).click();
    await page.locator('.keypad button', { hasText: /^2$/ }).click();
    await page.locator('.keypad button', { hasText: /^3$/ }).click();
    await page.locator('.keypad button', { hasText: /^4$/ }).click();
    await expect(page).toHaveURL(/\/waiter$/, { timeout: 10000 });

    // Attempt to reach staff pages directly
    await page.goto('/manager');
    await expect(page).toHaveURL(/\/waiter/);

    await page.goto('/cashier');
    await expect(page).toHaveURL(/\/waiter/);

    await page.goto('/kitchen');
    await expect(page).toHaveURL(/\/waiter/);
  });
});
