import { test, expect } from '@playwright/test';

const API = process.env.TEST_API_BASE || 'http://localhost:3000/api';

test.describe('Change password dialog', () => {
  const stamp = Date.now();
  const username = `test-pwui-${stamp}`;
  let adminToken = '';
  let createdId = '';

  test.beforeAll(async ({ request }) => {
    const admin = await request.post(`${API}/auth/login`, {
      data: { username: 'admin', password: 'admin123' },
    });
    adminToken = (await admin.json()).accessToken;
    const created = await request.post(`${API}/users`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: { username, fullName: 'Password UI Test', role: 'ADMIN', password: 'UiPass123' },
    });
    createdId = (await created.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (createdId) {
      await request.delete(`${API}/users/${createdId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
  });

  test('admin changes password from Settings and signs in with it', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#staff-username', username);
    await page.fill('#staff-password', 'UiPass123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/manager/);

    await page.goto('/manager/settings');
    await page.locator('.manager-account-action').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Current password').fill('UiPass123');
    await dialog.getByLabel('New password', { exact: true }).fill('UiPass456');
    await dialog.getByLabel('Confirm new password').fill('UiPass456');
    await dialog.getByRole('button', { name: 'Change password' }).click();

    await expect(dialog.getByText('Your password has been changed.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.fill('#staff-username', username);
    await page.fill('#staff-password', 'UiPass456');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/manager/);
  });

  test('wrong current password shows an error and keeps the dialog open', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#staff-username', username);
    await page.fill('#staff-password', 'UiPass456');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/manager/);

    await page.goto('/manager/settings');
    await page.locator('.manager-account-action').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Current password').fill('definitely-wrong');
    await dialog.getByLabel('New password', { exact: true }).fill('UiPass789');
    await dialog.getByLabel('Confirm new password').fill('UiPass789');
    await dialog.getByRole('button', { name: 'Change password' }).click();

    await expect(dialog.getByText('Current password is incorrect')).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});
