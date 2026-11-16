import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://localhost:3000/api';
const CLOUD_DIR = path.resolve(process.cwd(), '.tmp-backups');

async function loginAs(request: any, username: string, password: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  const body = await res.json();
  if (!body.accessToken) throw new Error(`Login failed for ${username}`);
  return body.accessToken as string;
}

test.describe('Data backups (manager)', () => {
  let token = '';
  let existingLocal: string[] = [];
  let existingCloud: string[] = [];

  test.beforeAll(async ({ request }) => {
    token = await loginAs(request, 'manager', 'manager123');
    fs.rmSync(CLOUD_DIR, { recursive: true, force: true });
    fs.mkdirSync(CLOUD_DIR, { recursive: true });

    const res = await request.get(`${API}/backups`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    existingLocal = body.backups.filter((b: any) => b.location === 'local').map((b: any) => b.name);
    existingCloud = body.backups.filter((b: any) => b.location === 'cloud').map((b: any) => b.name);
  });

  test.afterAll(async ({ request }) => {
    // Restore default backup settings so the dev environment is left clean.
    await request.patch(`${API}/backups/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        autoEnabled: false,
        autoTime: '21:00',
        retention: 14,
        cloudEnabled: false,
        cloudPath: null,
      },
    });

    const res = await request.get(`${API}/backups`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    for (const item of body.backups) {
      if (item.location === 'found') continue;
      const known = item.location === 'local' ? existingLocal : existingCloud;
      if (known.includes(item.name)) continue;
      await request.delete(`${API}/backups/${item.location}/${encodeURIComponent(item.name)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    fs.rmSync(CLOUD_DIR, { recursive: true, force: true });
  });

  test('manager can configure cloud storage, back up locally and to the cloud, and search', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('manager');
    await page.getByLabel('Password').fill('manager123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/manager/);

    await page.goto('/manager/settings');
    const section = page.locator('.backup-section');
    await expect(section.getByRole('heading', { name: 'Data & Backups' })).toBeVisible();
    await expect(section).toContainText('Local backup folder');

    await section.getByRole('button', { name: 'Find OneDrive folders' }).click();
    await expect(page.locator('.backup-folders')).toBeVisible({ timeout: 20_000 });

    await section.getByLabel('Cloud backup folder').fill(CLOUD_DIR);
    await section.getByRole('button', { name: 'Test folder' }).click();
    await expect(section).toContainText('Folder is writable', { timeout: 15_000 });

    const cloudToggle = section.getByRole('checkbox', { name: 'Use cloud folder' });
    if (!(await cloudToggle.isChecked())) await cloudToggle.check();
    await section.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(section).toContainText('Backup settings saved', { timeout: 15_000 });

    const cloudCopy = section.getByRole('checkbox', { name: 'Also copy to cloud' });
    await expect(cloudCopy).toBeEnabled({ timeout: 10_000 });
    await cloudCopy.check();

    await section.getByRole('button', { name: 'Back up now' }).click();
    await expect(section).toContainText('Backup created', { timeout: 30_000 });

    await expect(section.locator('.backup-table .backup-pill-local').first()).toBeVisible();
    await expect(section.locator('.backup-table .backup-pill-cloud').first()).toBeVisible();

    const search = section.getByPlaceholder('Search backups by name, date, location or folder…');
    await search.fill('citysquare');
    await expect(section.locator('.backup-table tbody tr').first()).toContainText('citysquare-');

    await section.getByRole('button', { name: 'Search this PC' }).click();
    await expect(section).toContainText('Found', { timeout: 30_000 });
    await section.getByRole('button', { name: 'Clear search results' }).click();

    page.once('dialog', (dialog) => dialog.accept());
    await section.locator('.backup-table tbody tr').first().getByRole('button', { name: 'Delete' }).click();
    await expect(section).toContainText('Backup deleted', { timeout: 15_000 });
  });

  test('cashiers cannot manage backups', async ({ request }) => {
    const cashier = await loginAs(request, 'cashier1', 'waiter123');
    const res = await request.get(`${API}/backups`, {
      headers: { Authorization: `Bearer ${cashier}` },
    });
    expect(res.status()).toBe(403);
  });

  test('rejects relative backup folder paths', async ({ request }) => {
    const res = await request.post(`${API}/backups/folders/test`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { path: 'relative/folder' },
    });
    expect(res.status()).toBe(400);
  });
});
