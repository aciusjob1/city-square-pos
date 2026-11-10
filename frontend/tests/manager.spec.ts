import { test, expect } from '@playwright/test';

test.describe('Manager dashboard', () => {
  test('manager sees daily report and quick links', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('manager');
    await page.getByLabel('Password').fill('manager123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/manager/, { timeout: 10000 });

    // KPI cards visible — scoped to .kpi-card
    await expect(page.locator('.kpi-card', { hasText: 'Total Sales' })).toBeVisible();
    await expect(page.locator('.kpi-card', { hasText: 'Orders' })).toBeVisible();
    await expect(page.locator('.kpi-card', { hasText: 'Avg Order' })).toBeVisible();
    await expect(page.locator('.kpi-card', { hasText: 'Cancelled' })).toBeVisible();

    // Quick links
    await expect(page.getByText('Pending Print Jobs')).toBeVisible();
    await expect(page.getByText('Open Orders')).toBeVisible();

    // Sections
    await expect(page.getByRole('heading', { name: 'By Waiter' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Top Products' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sales by Hour' })).toHaveCount(1);

    // Print Jobs link works
    await page.getByText('Pending Print Jobs').click();
    await expect(page).toHaveURL(/\/print-jobs/);
  });

  test('hourly sales section renders with bars', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('manager');
    await page.getByLabel('Password').fill('manager123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/manager/, { timeout: 10000 });

    await expect(page.getByRole('heading', { name: 'Sales by Hour' })).toHaveCount(1);

    // Wait for the section to finish rendering (either rows or the empty message)
  await expect(page.locator(".manager-hourly-row, .muted").first()).toBeVisible({ timeout: 5000 });
  const rows = await page.locator(".manager-hourly-row").count();
  const empty = await page.locator(".manager-section", { hasText: "Sales by Hour" }).locator(".muted").count();
  expect(rows + empty).toBeGreaterThan(0);
  });

  test('manager tab navigation is present and works', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('manager');
    await page.getByLabel('Password').fill('manager123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/manager$/, { timeout: 10000 });

    for (const label of ['Dashboard', 'Users', 'Categories', 'Products', 'Settings']) {
      await expect(page.getByRole('link', { name: label })).toBeVisible();
    }

    await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveClass(/manager-tab-active/);

    await page.getByRole('link', { name: 'Users' }).click();
    await expect(page).toHaveURL(/\/manager\/users$/);
    await expect(page.getByRole('link', { name: 'Users' })).toHaveClass(/manager-tab-active/);
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/manager$/);
    await expect(page.locator('.kpi-card', { hasText: 'Total Sales' })).toBeVisible();
  });
});
