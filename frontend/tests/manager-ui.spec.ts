import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';

async function loginAsManager(page: any) {
  await page.goto('/login');
  await page.fill('#staff-username', 'manager');
  await page.fill('#staff-password', 'manager123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/manager/);
}

test.describe('Manager UI: sold out, stock, printers', () => {
  test('Sold Out toggle hides the product from the waiter catalog', async ({ page, request }) => {
    const login = await request.post(`${API}/auth/login`, {
      data: { username: 'john', password: 'waiter123' },
    });
    const waiterToken = (await login.json()).accessToken;

    await loginAsManager(page);
    await page.getByRole('link', { name: 'Sold Out' }).click();
    await expect(page.getByRole('heading', { name: 'Sold Out' })).toBeVisible();

    const row = page.getByRole('row', { name: /Chipsi kavu/ });
    await expect(row.getByText('Available')).toBeVisible();
    await row.locator('.manager-soldout-slider').click();
    await expect(row.getByText('Sold out')).toBeVisible();

    const catalog = await request.get(`${API}/products`, {
      headers: { Authorization: `Bearer ${waiterToken}` },
    });
    const body = await catalog.json();
    expect(body.products.some((p: any) => p.name === 'Chipsi kavu')).toBe(false);

    await page.screenshot({ path: test.info().outputPath('soldout-ui.png'), fullPage: true });

    // Restore availability for the rest of the suite.
    await row.locator('.manager-soldout-slider').click();
    await expect(row.getByText('Available')).toBeVisible();
  });

  test('Stock page offers an Add Stock form for any product', async ({ page }) => {
    await loginAsManager(page);
    await page.getByRole('link', { name: 'Stock' }).click();
    await page.getByRole('button', { name: /Add Stock/ }).click();
    await expect(page.getByText('Track this product in stock')).toBeVisible();
    await expect(page.locator('.manager-stock-addform select')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('stock-add-ui.png'), fullPage: true });
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Settings printer table shows fixtures without leftover test printers', async ({ page }) => {
    await loginAsManager(page);
    await page.getByRole('link', { name: 'Settings' }).click();

    const rows = page.locator('.manager-table tbody tr');
    await expect(rows.filter({ hasText: 'Test Kitchen Printer' })).toHaveCount(1);
    await expect(rows.filter({ hasText: /Test-OS-Printer-|Test Multi-/ })).toHaveCount(0);

    await page.screenshot({ path: test.info().outputPath('printer-list-ui.png'), fullPage: true });
  });

  test('Settings can search the computer for printers', async ({ page }) => {
    await loginAsManager(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /Search this computer/ }).click();
    await expect(
      page.getByText(/Found printer|No printers were found|Could not list printers/),
    ).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: test.info().outputPath('printer-search-ui.png'), fullPage: true });
  });

  test('manager lists can be filtered with the page search box', async ({ page }) => {
    await loginAsManager(page);

    await page.getByRole('link', { name: 'Users' }).click();
    const usersSearch = page.getByPlaceholder('Search users by name, role or status…');
    await expect(usersSearch).toBeVisible();
    await usersSearch.fill('john');
    const userRows = page.locator('.manager-table tbody tr');
    await expect(userRows.filter({ hasText: 'john' })).toHaveCount(1);
    await expect(userRows.filter({ hasText: 'admin' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Products' }).click();
    const productSearch = page.getByPlaceholder('Search products by name, SKU, category or station…');
    await expect(productSearch).toBeVisible();
    await productSearch.fill('Chipsi kavu');
    const productRows = page.locator('.manager-table tbody tr');
    await expect(productRows.filter({ hasText: 'Chipsi kavu' })).toHaveCount(1);
    await expect(productRows.filter({ hasText: 'Ugali dona' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Sold Out' }).click();
    const soldOutSearch = page.getByPlaceholder('Search products by name, category or status…');
    await expect(soldOutSearch).toBeVisible();
    await soldOutSearch.fill('Ugali dona');
    const soldOutRows = page.locator('.manager-table tbody tr');
    await expect(soldOutRows.filter({ hasText: 'Ugali dona' })).toHaveCount(1);
    await expect(soldOutRows.filter({ hasText: 'Chipsi kavu' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Settings' }).click();
    const printerSearch = page.getByPlaceholder('Search printers by name, type, IP or station…');
    await expect(printerSearch).toBeVisible();
    await printerSearch.fill('Bar');
    const printerRows = page.locator('.manager-table tbody tr');
    await expect(printerRows.filter({ hasText: 'Test Bar Printer' })).toHaveCount(1);
    await expect(printerRows.filter({ hasText: 'Test Kitchen Printer' })).toHaveCount(0);
  });

  test('Settings can deactivate and reactivate a printer', async ({ page }) => {
    await loginAsManager(page);
    await page.getByRole('link', { name: 'Settings' }).click();

    const row = page.locator('.manager-table tbody tr').filter({ hasText: 'Test Extra Printer' });
    await expect(row).toHaveCount(1);

    page.on('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await expect(row.getByText('Inactive')).toBeVisible();

    await row.getByRole('button', { name: 'Activate' }).click();
    await expect(row.getByText('Active')).toBeVisible();
  });
});
