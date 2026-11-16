import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';

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

  test('login screens and top bar render the configured restaurant branding', async ({ page, request }) => {
    const login = await request.post(`${API}/auth/login`, {
      data: { username: 'manager', password: 'manager123' },
    });
    const token = (await login.json()).accessToken;
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const branding = await (await request.get(`${API}/settings/branding`)).json();
    await page.goto('/login');
    await expect(page.locator('.login-header h1')).toHaveText(branding.restaurantName);
    await page.goto('/w/login');
    await expect(page.locator('.login-header h1')).toHaveText(branding.restaurantName);

    const before = (await (await request.get(`${API}/settings`, { headers: auth })).json())
      .settings.restaurantLogo as string | null;
    const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await request.patch(`${API}/settings`, { headers: auth, data: { restaurant_logo: logo } });

    try {
      await page.goto('/login');
      await expect(page.locator('.brand-logo')).toBeVisible();
      await page.goto('/w/login');
      await expect(page.locator('.brand-logo')).toBeVisible();

      await page.goto('/login');
      await page.getByLabel('Username').fill('manager');
      await page.getByLabel('Password').fill('manager123');
      await page.getByRole('button', { name: /sign in/i }).click();
      await expect(page).toHaveURL(/\/manager$/, { timeout: 10000 });
      await expect(page.locator('.topbar-logo-img')).toBeVisible();
    } finally {
      await request.patch(`${API}/settings`, {
        headers: auth,
        data: { restaurant_logo: before ?? null },
      });
    }
  });
});
