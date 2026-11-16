import { test, expect } from '@playwright/test';

const API = process.env.TEST_API_BASE || 'http://localhost:3000/api';

async function login(request: any, username: string, password: string) {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  const body = await res.json();
  return { status: res.status(), token: body.accessToken as string | undefined };
}

async function changePassword(
  request: any,
  token: string,
  currentPassword: string,
  newPassword: string,
) {
  return request.patch(`${API}/auth/password`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { currentPassword, newPassword },
  });
}

test.describe('Self-service password change (admin + manager)', () => {
  const stamp = Date.now();
  const tempAdmin = `test-pwadmin-${stamp}`;
  const tempManager = `test-pwmanager-${stamp}`;
  let adminToken = '';
  let tempAdminId = '';
  let tempManagerId = '';

  test.beforeAll(async ({ request }) => {
    const admin = await login(request, 'admin', 'admin123');
    adminToken = admin.token!;

    const headers = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
    const a = await request.post(`${API}/users`, {
      headers,
      data: { username: tempAdmin, fullName: 'Temp Admin', role: 'ADMIN', password: 'TempAdmin123' },
    });
    tempAdminId = (await a.json()).id;
    const m = await request.post(`${API}/users`, {
      headers,
      data: { username: tempManager, fullName: 'Temp Manager', role: 'MANAGER', password: 'TempManager123' },
    });
    tempManagerId = (await m.json()).id;
  });

  test.afterAll(async ({ request }) => {
    const admin = await login(request, 'admin', 'admin123');
    const headers = { Authorization: `Bearer ${admin.token}` };
    if (tempAdminId) await request.delete(`${API}/users/${tempAdminId}`, { headers });
    if (tempManagerId) await request.delete(`${API}/users/${tempManagerId}`, { headers });
  });

  test('admin can change password with the current one', async ({ request }) => {
    const account = await login(request, tempAdmin, 'TempAdmin123');
    expect(account.token).toBeTruthy();

    const change = await changePassword(request, account.token!, 'TempAdmin123', 'TempAdmin456');
    expect(change.status()).toBe(200);

    const withNew = await login(request, tempAdmin, 'TempAdmin456');
    expect(withNew.token).toBeTruthy();

    const revert = await changePassword(request, withNew.token!, 'TempAdmin456', 'TempAdmin123');
    expect(revert.status()).toBe(200);
  });

  test('manager can change password with the current one', async ({ request }) => {
    const account = await login(request, tempManager, 'TempManager123');
    expect(account.token).toBeTruthy();

    const change = await changePassword(request, account.token!, 'TempManager123', 'TempManager456');
    expect(change.status()).toBe(200);

    const withNew = await login(request, tempManager, 'TempManager456');
    expect(withNew.token).toBeTruthy();

    const revert = await changePassword(request, withNew.token!, 'TempManager456', 'TempManager123');
    expect(revert.status()).toBe(200);
  });

  test('wrong current password is rejected', async ({ request }) => {
    const account = await login(request, tempAdmin, 'TempAdmin123');
    const res = await changePassword(request, account.token!, 'not-my-password', 'TempAdmin456');
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_CURRENT_PASSWORD');
  });

  test('new password must differ and be strong', async ({ request }) => {
    const account = await login(request, tempAdmin, 'TempAdmin123');

    const same = await changePassword(request, account.token!, 'TempAdmin123', 'TempAdmin123');
    expect(same.status()).toBe(400);
    expect((await same.json()).code).toBe('PASSWORD_UNCHANGED');

    const weak = await changePassword(request, account.token!, 'TempAdmin123', 'short');
    expect(weak.status()).toBe(400);
    expect((await weak.json()).code).toBe('WEAK_PASSWORD');
  });

  test('cashier cannot change their own password', async ({ request }) => {
    const cashier = await login(request, 'cashier1', 'waiter123');
    expect(cashier.token).toBeTruthy();
    const res = await changePassword(request, cashier.token!, 'waiter123', 'CashierNew123');
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('PASSWORD_SELF_SERVICE_UNAVAILABLE');
  });

  test('unauthenticated request is rejected', async ({ request }) => {
    const res = await request.patch(`${API}/auth/password`, {
      data: { currentPassword: 'admin123', newPassword: 'AdminNew123' },
    });
    expect(res.status()).toBe(401);
  });
});
