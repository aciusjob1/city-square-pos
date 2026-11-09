import { test, expect } from '@playwright/test';

test.describe('City Square Phase 4a', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'City Square' })).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('wrong password shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('wrongpass');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.error')).toContainText('Invalid credentials');
    await expect(page).toHaveURL(/\/login/);
  });

  test('admin login lands on manager', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/manager/);
    await expect(page.getByText('Signed in as System Admin')).toBeVisible();
  });

  test('waiter login lands on waiter', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('john');
    await page.getByLabel('Password').fill('waiter123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/waiter/);
    await expect(page.getByText('Signed in as John Waiter')).toBeVisible();
  });

  test('waiter cannot access manager page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('john');
    await page.getByLabel('Password').fill('waiter123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/waiter/);
    await page.goto('/manager');
    await expect(page).toHaveURL(/\/waiter/);
  });

  test('sign out clears session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/manager/);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    const token = await page.evaluate(() => localStorage.getItem('cs_auth_token'));
    expect(token).toBeNull();
  });

  test('refresh preserves session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/manager/);
    await page.reload();
    await expect(page).toHaveURL(/\/manager/);
    await expect(page.getByText('Signed in as System Admin')).toBeVisible();
  });
});
