import { test, expect } from '@playwright/test';

async function enterPin(page: import('@playwright/test').Page) {
  for (const digit of ['1', '2', '3', '4']) {
    await page.locator('.keypad button', { hasText: new RegExp(`^${digit}$`) }).click();
  }
}

test.describe('Terminal mode login screens', () => {
  test('staff sign-out returns to the staff login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/manager/);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.locator('.keypad')).toHaveCount(0);
  });

  test('waiter sign-out returns to the waiter PIN login', async ({ page }) => {
    await page.goto('/w/login');
    await enterPin(page);
    await expect(page).toHaveURL(/\/waiter$/, { timeout: 10000 });

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/w\/login$/);
    await expect(page.locator('.keypad')).toBeVisible();
    await expect(page.getByLabel('Username')).toHaveCount(0);
  });

  test('waiter terminal still opens the PIN pad after a refresh', async ({ page }) => {
    await page.goto('/w/login');
    await enterPin(page);
    await expect(page).toHaveURL(/\/waiter$/, { timeout: 10000 });
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/w\/login$/);

    await page.reload();
    await expect(page).toHaveURL(/\/w\/login$/);
    await expect(page.locator('.keypad')).toBeVisible();
  });
});
