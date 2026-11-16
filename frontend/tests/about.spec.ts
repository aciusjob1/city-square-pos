import { test, expect } from '@playwright/test';

test.describe('About page', () => {
  test('shows the developer and every contact channel', async ({ page }) => {
    await page.goto('/about');

    await expect(page.getByRole('heading', { name: 'Acius Job Missingo' })).toBeVisible();
    await expect(page.getByText('0772 171 246')).toBeVisible();
    await expect(page.getByText('0613 458 246')).toBeVisible();
    await expect(page.getByText('aciusjob1@gmail.com')).toBeVisible();
    await expect(page.getByText('@Abson_acjo')).toBeVisible();

    await expect(page.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute(
      'href',
      'https://wa.me/255772171246',
    );
    await expect(page.getByRole('link', { name: /Phone/ })).toHaveAttribute(
      'href',
      'tel:+255613458246',
    );
    await expect(page.getByRole('link', { name: /Email/ })).toHaveAttribute(
      'href',
      'mailto:aciusjob1@gmail.com',
    );
    await expect(page.getByRole('link', { name: /Instagram/ })).toHaveAttribute(
      'href',
      'https://instagram.com/Abson_acjo',
    );
  });

  test('is reachable from the staff and waiter login screens', async ({ page }) => {
    await page.goto('/login');
    await page.locator('.login-footer').getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole('heading', { name: 'Acius Job Missingo' })).toBeVisible();

    await page.goto('/w/login');
    await page.locator('.login-footer').getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about$/);
  });

  test('manager sidebar links to About', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('manager');
    await page.getByLabel('Password').fill('manager123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/manager/);

    await page.locator('.manager-tabs').getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole('heading', { name: 'Acius Job Missingo' })).toBeVisible();
  });
});

test.describe('Manager sidebar collapse (desktop)', () => {
  test('collapses, persists across reloads, and expands again', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/login');
    await page.getByLabel('Username').fill('manager');
    await page.getByLabel('Password').fill('manager123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/manager/);

    const shell = page.locator('.manager-shell');
    await expect(shell).not.toHaveClass(/manager-shell-collapsed/);
    await expect(page.locator('.manager-tab-label').first()).toBeVisible();

    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await expect(shell).toHaveClass(/manager-shell-collapsed/);
    await expect(page.locator('.manager-tab-label').first()).toBeHidden();

    await page.reload();
    await expect(page.locator('.manager-shell')).toHaveClass(/manager-shell-collapsed/);
    await expect(page.locator('.manager-tab-label').first()).toBeHidden();

    await page.getByRole('button', { name: 'Expand navigation' }).click();
    await expect(page.locator('.manager-shell')).not.toHaveClass(/manager-shell-collapsed/);
    await expect(page.locator('.manager-tab-label').first()).toBeVisible();
  });
});
