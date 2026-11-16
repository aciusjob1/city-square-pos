import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';

async function loginToken(request: any, username: string, password: string) {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  return (await res.json()).accessToken as string;
}

async function setCount(request: any, token: string, count: number) {
  return request.put(`${API}/tables/count`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { count },
  });
}

test.describe('Configurable table count', () => {
  test('manager can set the count waiters see and cashier cannot', async ({ request }) => {
    const manager = await loginToken(request, 'manager', 'manager123');
    const cashier = await loginToken(request, 'cashier1', 'waiter123');
    const waiter = await loginToken(request, 'john', 'waiter123');

    try {
      const increase = await setCount(request, manager, 12);
      expect(increase.status()).toBe(200);
      expect((await increase.json()).tableCount).toBe(12);

      const visible = await request.get(`${API}/tables`, {
        headers: { Authorization: `Bearer ${waiter}` },
      });
      const tables = (await visible.json()).tables;
      expect(tables).toHaveLength(12);
      expect(tables[10].name).toBe('Table 11');
      expect(tables[11].name).toBe('Table 12');

      const forbidden = await setCount(request, cashier, 8);
      expect(forbidden.status()).toBe(403);

      const invalid = await setCount(request, manager, 0);
      expect(invalid.status()).toBe(400);
    } finally {
      const reset = await setCount(request, manager, 10);
      expect(reset.status()).toBe(200);
    }

    const after = await request.get(`${API}/tables`, {
      headers: { Authorization: `Bearer ${waiter}` },
    });
    expect((await after.json()).tables).toHaveLength(10);
  });

  test('manager can change the count from Settings', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#staff-username', 'manager');
    await page.fill('#staff-password', 'manager123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/manager/);

    await page.getByRole('link', { name: 'Settings' }).click();
    const section = page.locator('.manager-section').filter({ hasText: 'Number of tables' });
    const input = section.getByLabel('Number of tables');
    await expect(input).toHaveValue('10');

    await input.fill('12');
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('12 tables are now active')).toBeVisible();
    await expect(input).toHaveValue('12');

    await input.fill('10');
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('10 tables are now active')).toBeVisible();
    await expect(input).toHaveValue('10');
  });
});
