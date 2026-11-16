import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';

async function loginToken(request: any, username: string, password: string) {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  return (await res.json()).accessToken as string;
}

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

test.describe('Sales reports', () => {
  test('cashier, manager and admin can read the summary; waiter cannot', async ({ request }) => {
    const cashier = await loginToken(request, 'cashier1', 'waiter123');
    const manager = await loginToken(request, 'manager', 'manager123');
    const admin = await loginToken(request, 'admin', 'admin123');
    const waiter = await loginToken(request, 'john', 'waiter123');

    for (const token of [cashier, manager, admin]) {
      const res = await request.get(
        `${API}/reports/summary?from=${yearStart()}&to=${today()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.summary.totalSales).toBeDefined();
      expect(Array.isArray(body.byProduct)).toBe(true);
      expect(Array.isArray(body.byWaiter)).toBe(true);
      expect(['day', 'month']).toContain(body.trend.granularity);
    }

    const denied = await request.get(
      `${API}/reports/summary?from=${yearStart()}&to=${today()}`,
      { headers: { Authorization: `Bearer ${waiter}` } },
    );
    expect(denied.status()).toBe(403);
  });

  test('rejects an inverted date range', async ({ request }) => {
    const cashier = await loginToken(request, 'cashier1', 'waiter123');
    const res = await request.get(`${API}/reports/summary?from=2026-12-31&to=2026-01-01`, {
      headers: { Authorization: `Bearer ${cashier}` },
    });
    expect(res.status()).toBe(400);
  });

  test('rejects malformed waiter and product filters', async ({ request }) => {
    const cashier = await loginToken(request, 'cashier1', 'waiter123');
    for (const qs of ['waiterId=0', 'productId=-3', 'waiterId=abc', 'productId=1.5']) {
      const res = await request.get(
        `${API}/reports/summary?from=${yearStart()}&to=${today()}&${qs}`,
        { headers: { Authorization: `Bearer ${cashier}` } },
      );
      expect(res.status(), qs).toBe(400);
    }
  });

  test('waiter sales group by day, week, month or year', async ({ request }) => {
    const cashier = await loginToken(request, 'cashier1', 'waiter123');
    const headers = { Authorization: `Bearer ${cashier}` };
    const range = `from=${yearStart()}&to=${today()}`;

    const patterns: Record<string, RegExp> = {
      day: /^\d{4}-\d{2}-\d{2}$/,
      week: /^\d{4}-W\d{2}$/,
      month: /^\d{4}-\d{2}$/,
      year: /^\d{4}$/,
    };
    for (const g of ['day', 'week', 'month', 'year']) {
      const res = await request.get(
        `${API}/reports/summary?${range}&granularity=${g}`,
        { headers },
      );
      expect(res.status(), g).toBe(200);
      const body = await res.json();
      expect(body.trend.granularity).toBe(g);
      for (const row of body.trend.rows) {
        expect(row.period, `${g} period`).toMatch(patterns[g]);
      }
    }

    const bad = await request.get(
      `${API}/reports/summary?${range}&granularity=hour`,
      { headers },
    );
    expect(bad.status()).toBe(400);

    const full = await (await request.get(`${API}/reports/summary?${range}`, { headers })).json();
    test.skip(full.byWaiter.length === 0, 'No waiter sales data');
    const waiter = full.byWaiter[0];
    const waiterRes = await request.get(
      `${API}/reports/summary?${range}&waiterId=${waiter.id}&granularity=week`,
      { headers },
    );
    expect(waiterRes.status()).toBe(200);
    const waiterBody = await waiterRes.json();
    expect(waiterBody.filters.waiter.id).toBe(waiter.id);
    expect(waiterBody.trend.granularity).toBe('week');
    expect(waiterBody.byWaiter).toHaveLength(1);
  });

  test('product and waiter filters scope totals to each other', async ({ request }) => {
    const cashier = await loginToken(request, 'cashier1', 'waiter123');
    const headers = { Authorization: `Bearer ${cashier}` };
    const range = `from=${yearStart()}&to=${today()}`;

    const fullRes = await request.get(`${API}/reports/summary?${range}`, { headers });
    expect(fullRes.status()).toBe(200);
    const full = await fullRes.json();
    test.skip(full.byProduct.length === 0, 'No sales data to filter');

    const product = full.byProduct[0];
    const byProductRes = await request.get(
      `${API}/reports/summary?${range}&productId=${product.id}`,
      { headers },
    );
    expect(byProductRes.status()).toBe(200);
    const byProduct = await byProductRes.json();
    expect(byProduct.filters.product.id).toBe(product.id);
    expect(byProduct.byProduct.every((p: any) => p.id === product.id)).toBe(true);
    expect(Number(byProduct.summary.totalSales)).toBeCloseTo(Number(product.revenue), 2);

    const waiterSum = byProduct.byWaiter.reduce((s: number, w: any) => s + Number(w.total), 0);
    expect(waiterSum).toBeCloseTo(Number(product.revenue), 2);

    const waiter = byProduct.byWaiter[0];
    const combinedRes = await request.get(
      `${API}/reports/summary?${range}&productId=${product.id}&waiterId=${waiter.id}`,
      { headers },
    );
    expect(combinedRes.status()).toBe(200);
    const combined = await combinedRes.json();
    expect(combined.filters.waiter.id).toBe(waiter.id);
    expect(combined.filters.product.id).toBe(product.id);
    expect(Number(combined.summary.totalSales)).toBeCloseTo(Number(waiter.total), 2);
    expect(combined.byWaiter).toHaveLength(1);
    expect(combined.byWaiter[0].id).toBe(waiter.id);

    const byWaiterRes = await request.get(
      `${API}/reports/summary?${range}&waiterId=${waiter.id}`,
      { headers },
    );
    expect(byWaiterRes.status()).toBe(200);
    const byWaiter = await byWaiterRes.json();
    expect(byWaiter.filters.waiter.id).toBe(waiter.id);
    expect(byWaiter.byWaiter).toHaveLength(1);
    // Waiter-only scope reports the waiter's full totals, which must be an
    // internal-consistent superset of the product-scoped numbers.
    expect(Number(byWaiter.byWaiter[0].total)).toBeCloseTo(Number(byWaiter.summary.totalSales), 2);
    expect(byWaiter.summary.orderCount).toBe(Number(byWaiter.byWaiter[0].order_count));
    expect(Number(byWaiter.byWaiter[0].total)).toBeGreaterThanOrEqual(Number(waiter.total));
    expect(byWaiter.summary.orderCount).toBeGreaterThanOrEqual(Number(waiter.order_count));
  });

  test('waiters only see their own sales on my-sales', async ({ request }) => {
    const john = await loginToken(request, 'john', 'waiter123');
    const fatma = await loginToken(request, 'fatma', 'waiter123');
    const range = `from=${yearStart()}&to=${today()}`;

    const johnRes = await request.get(
      `${API}/reports/my-sales?${range}&granularity=week`,
      { headers: { Authorization: `Bearer ${john}` } },
    );
    expect(johnRes.status()).toBe(200);
    const johnBody = await johnRes.json();
    expect(johnBody.filters.waiter.username).toBe('john');
    expect(johnBody.byWaiter).toHaveLength(1);
    expect(johnBody.byWaiter[0].username).toBe('john');
    expect(johnBody.trend.granularity).toBe('week');

    const fatmaBody = await (await request.get(
      `${API}/reports/my-sales?${range}`,
      { headers: { Authorization: `Bearer ${fatma}` } },
    )).json();
    expect(fatmaBody.filters.waiter.username).toBe('fatma');

    // Passing another waiter's id must not widen the scope.
    const forged = await request.get(
      `${API}/reports/my-sales?${range}&waiterId=${fatmaBody.filters.waiter.id}`,
      { headers: { Authorization: `Bearer ${john}` } },
    );
    expect(forged.status()).toBe(200);
    expect((await forged.json()).filters.waiter.username).toBe('john');

    const cashier = await loginToken(request, 'cashier1', 'waiter123');
    const denied = await request.get(`${API}/reports/my-sales?${range}`, {
      headers: { Authorization: `Bearer ${cashier}` },
    });
    expect(denied.status()).toBe(403);
  });

  test('cashier can open Reports, change period and search products/waiters', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#staff-username', 'cashier1');
    await page.fill('#staff-password', 'waiter123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/cashier/);

    await page.getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sales Reports' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Product sales' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Waiter sales' })).toBeVisible();

    await page.getByRole('button', { name: 'This year' }).click();
    await expect(page.getByText(/Product and waiter totals/)).toBeVisible();

    const search = page.getByLabel('Search product, category or waiter');
    await search.fill('zzz-no-such-product');
    await expect(page.getByText('No products match your search.')).toBeVisible();
    await expect(page.getByText('No waiters match your search.')).toBeVisible();

    await search.fill('John');
    await expect(page.getByRole('cell', { name: 'John Waiter' })).toBeVisible();
  });

  test('clicking products and waiters cross-filters the report', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#staff-username', 'cashier1');
    await page.fill('#staff-password', 'waiter123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/cashier$/);
    await page.getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sales Reports' })).toBeVisible();
    await page.getByRole('button', { name: 'This year' }).click();

    const productSection = page.locator('.reports-section').nth(1);
    const waiterSection = page.locator('.reports-section').nth(2);

    const firstProduct = productSection.locator('.reports-row-clickable').first();
    if (await firstProduct.count() === 0) {
      test.skip(true, 'No product sales in this period');
      return;
    }
    const productName = (await firstProduct.locator('td').first().innerText()).trim();
    await firstProduct.click();

    await expect(page.getByText('Filtered to')).toBeVisible();
    await expect(page.getByRole('heading', { name: `Waiters who sold ${productName}` })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Product:/ })).toBeVisible();

    const firstWaiter = waiterSection.locator('.reports-row-clickable').first();
    await expect(firstWaiter).toBeVisible();
    const waiterName = (await firstWaiter.locator('td').first().innerText()).trim();
    await firstWaiter.click();

    await expect(page.getByRole('heading', { name: `Products sold by ${waiterName}` })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Waiter:/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Product:/ })).toBeVisible();

    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByText('Filtered to')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Product sales' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Waiter sales' })).toBeVisible();
  });

  test('waiter sees only their own sales under My Sales', async ({ page }) => {
    await page.goto('/w/login');
    for (const d of ['1', '2', '3', '4']) {
      await page.locator('.keypad button', { hasText: new RegExp(`^${d}$`) }).click();
    }
    await expect(page).toHaveURL(/\/waiter$/, { timeout: 15000 });

    await page.getByRole('link', { name: 'My Sales' }).click();
    await expect(page.getByRole('heading', { name: 'My Sales' })).toBeVisible();
    await expect(page.getByText(/Your own sales/)).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Waiter' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Waiter sales' })).toHaveCount(0);

    // One filter row only: the period buttons drive the grouping, so the
    // separate "Group by" row must not appear for waiters.
    await expect(page.getByText('Group by')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Daily' })).toHaveCount(0);

    await page.getByRole('button', { name: 'This year' }).click();
    await expect(page.getByRole('button', { name: 'This year' })).toHaveClass(/active/);

    // Custom is the only period that reveals explicit dates.
    await expect(page.getByLabel('From')).toHaveCount(0);
    await page.getByRole('button', { name: 'Custom' }).click();
    await expect(page.getByLabel('From')).toBeVisible();
    await expect(page.getByLabel('To')).toBeVisible();
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.getByLabel('From')).toHaveCount(0);
  });

  test('manager sees the Reports tab inside the manager layout', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#staff-username', 'manager');
    await page.fill('#staff-password', 'manager123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/manager/);

    await page.locator('.manager-tab', { hasText: 'Reports' }).click();
    await expect(page).toHaveURL(/\/manager\/reports/);
    await expect(page.getByRole('heading', { name: 'Sales Reports' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Product sales' })).toBeVisible();
  });
});
