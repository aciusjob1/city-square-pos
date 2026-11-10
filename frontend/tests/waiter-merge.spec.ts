import { test, expect } from '@playwright/test';

async function loginAsWaiter(page: import('@playwright/test').Page) {
  await page.goto('/w/login');
  await page.locator('.keypad button', { hasText: /^1$/ }).click();
  await page.locator('.keypad button', { hasText: /^2$/ }).click();
  await page.locator('.keypad button', { hasText: /^3$/ }).click();
  await page.locator('.keypad button', { hasText: /^4$/ }).click();
  await expect(page).toHaveURL(/\/waiter$/, { timeout: 10000 });
}

test.describe('Waiter-side bill groups', () => {
  // DESIGN NOTE — Waiter sees only their own portion of a merged bill group.
  //
  // The cashier is the one who sees all orders in a group and can print or
  // unmerge. The waiter sees the group exists (with "Awaiting cashier bill"
  // badge), sees their own order within it, but doesn't see other waiters'
  // orders and cannot print or unmerge. This preserves the security boundary
  // from slice 6 where getBillGroup rejects waiter access to cross-waiter
  // groups.

  test('waiter sees merged group with own order — cannot print or unmerge', async ({ page, request }) => {
    // Setup: John creates order A
    const johnLogin = await request.post('http://localhost:3000/api/auth/login', {
      data: { username: 'john', password: 'waiter123' },
    });
    const johnToken = (await johnLogin.json()).accessToken;

    const tablesRes = await request.get('http://localhost:3000/api/tables', {
      headers: { Authorization: `Bearer ${johnToken}` },
    });
    const tables = (await tablesRes.json()).tables;
    const emptyTable = tables.find((t: any) => !t.activeOrderId);
    if (!emptyTable) {
      test.skip(true, 'No empty table available');
      return;
    }

    const productsRes = await request.get('http://localhost:3000/api/products', {
      headers: { Authorization: `Bearer ${johnToken}` },
    });
    const product = (await productsRes.json()).products[0];

    const orderA = await request.post('http://localhost:3000/api/orders', {
      headers: { Authorization: `Bearer ${johnToken}`, 'Content-Type': 'application/json' },
      data: {
        clientUuid: crypto.randomUUID(),
        tableId: emptyTable.id,
        orderType: 'DINE_IN',
        items: [{ productId: product.id, quantity: 1 }],
      },
    });
    const orderABody = await orderA.json();
    expect(orderABody.orderNumber).toMatch(/^CS-/);

    // Setup: Fatma creates order B on same table
    const fatmaLogin = await request.post('http://localhost:3000/api/auth/login', {
      data: { username: 'fatma', password: 'waiter123' },
    });
    const fatmaToken = (await fatmaLogin.json()).accessToken;

    const orderB = await request.post('http://localhost:3000/api/orders', {
      headers: { Authorization: `Bearer ${fatmaToken}`, 'Content-Type': 'application/json' },
      data: {
        clientUuid: crypto.randomUUID(),
        tableId: emptyTable.id,
        orderType: 'DINE_IN',
        items: [{ productId: product.id, quantity: 2 }],
      },
    });
    const orderBBody = await orderB.json();
    expect(orderBBody.orderNumber).toMatch(/^CS-/);

    // Cashier merges them
    const cashierLogin = await request.post('http://localhost:3000/api/auth/login', {
      data: { username: 'cashier1', password: 'waiter123' },
    });
    const cashierToken = (await cashierLogin.json()).accessToken;

    const mergeRes = await request.post('http://localhost:3000/api/bill-groups/merge', {
      headers: { Authorization: `Bearer ${cashierToken}`, 'Content-Type': 'application/json' },
      data: { orderIds: [orderABody.id, orderBBody.id] },
    });
    expect(mergeRes.status()).toBe(201);
    const mergeBody = await mergeRes.json();
    expect(mergeBody.orderCount).toBe(2);

    // John logs in via UI and goes to My Orders
    await loginAsWaiter(page);
    await page.getByRole('link', { name: 'My Orders' }).click();
    await expect(page.getByRole('heading', { name: 'My Orders' })).toBeVisible();

    // John sees a group card
    await expect(page.locator('.order-card-group').first()).toBeVisible({ timeout: 10000 });
    const groupCard = page.locator('.order-card-group').first();

    // The group shows John's own order
    await expect(groupCard).toContainText(orderABody.orderNumber);

    // John does NOT see Fatma's order (role isolation)
    await expect(groupCard).not.toContainText(orderBBody.orderNumber);

    // John sees "Awaiting cashier bill" badge
    await expect(groupCard.locator('.group-badge')).toContainText('Awaiting cashier bill');

    // John does NOT see print or unmerge buttons
    await expect(groupCard.getByRole('button', { name: 'Print Consolidated Bill' })).toHaveCount(0);
    await expect(groupCard.getByRole('button', { name: 'Unmerge' })).toHaveCount(0);
  });
});
