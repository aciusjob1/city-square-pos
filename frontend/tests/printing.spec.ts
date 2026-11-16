import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';

async function login(request: any, username: string, password: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  const body = await res.json();
  if (!body.accessToken) throw new Error(`Login failed for ${username}`);
  return body.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test.describe('Printing: station routing', () => {
  test('a mixed kitchen + bar order gets one independent ticket per station', async ({ request }) => {
    const manager = await login(request, 'manager', 'manager123');
    const waiter = await login(request, 'john', 'waiter123');

    const productsRes = await request.get(`${API}/products`, { headers: auth(waiter) });
    const products = (await productsRes.json()).products as Array<{
      id: string;
      name: string;
      preparationStation: string;
    }>;
    const kitchen = products.find((p) => p.preparationStation === 'KITCHEN');
    const bar = products.find((p) => p.preparationStation === 'BAR');
    expect(kitchen, 'a KITCHEN product must exist').toBeTruthy();
    expect(bar, 'a BAR product must exist').toBeTruthy();

    const created = await request.post(`${API}/orders`, {
      headers: auth(waiter),
      data: {
        clientUuid: crypto.randomUUID(),
        orderType: 'TAKEAWAY',
        items: [
          { productId: kitchen!.id, quantity: 2 },
          { productId: bar!.id, quantity: 1 },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const order = await created.json();

    const jobsRes = await request.get(`${API}/print-jobs?limit=100`, {
      headers: auth(manager),
    });
    const jobs = ((await jobsRes.json()).printJobs as any[]).filter(
      (j) => j.order_number === order.orderNumber,
    );

    // Exactly two tickets: the kitchen never receives bar lines and vice versa.
    expect(jobs).toHaveLength(2);
    const byType: Record<string, any> = {};
    for (const job of jobs) byType[job.ticket_type] = JSON.parse(job.payload);

    expect(byType.KITCHEN.header.station).toBe('KITCHEN');
    expect(byType.KITCHEN.lines.map((l: any) => l.productName)).toEqual([kitchen!.name]);
    expect(byType.KITCHEN.lines[0].quantity).toBe(2);

    expect(byType.BAR.header.station).toBe('BAR');
    expect(byType.BAR.lines.map((l: any) => l.productName)).toEqual([bar!.name]);
    expect(byType.BAR.lines[0].quantity).toBe(1);
  });

  test('a station with no active printer keeps its ticket visible as FAILED, never silently dropped', async ({ request }) => {
    const manager = await login(request, 'manager', 'manager123');
    const waiter = await login(request, 'john', 'waiter123');

    const printersRes = await request.get(`${API}/printers`, { headers: auth(manager) });
    const printers = (await printersRes.json()).printers as any[];
    const barPrinter = printers.find((p) => p.stations.includes('BAR') && p.name === 'Test Bar Printer');
    expect(barPrinter, 'the BAR printer fixture must exist').toBeTruthy();

    const productsRes = await request.get(`${API}/products`, { headers: auth(waiter) });
    const products = (await productsRes.json()).products as any[];
    const kitchen = products.find((p) => p.preparationStation === 'KITCHEN');
    const bar = products.find((p) => p.preparationStation === 'BAR');

    try {
      const off = await request.patch(`${API}/printers/${barPrinter.id}`, {
        headers: auth(manager),
        data: { isActive: false },
      });
      expect(off.status()).toBe(200);

      const created = await request.post(`${API}/orders`, {
        headers: auth(waiter),
        data: {
          clientUuid: crypto.randomUUID(),
          orderType: 'TAKEAWAY',
          items: [
            { productId: kitchen.id, quantity: 1 },
            { productId: bar.id, quantity: 1 },
          ],
        },
      });
      expect(created.status()).toBe(201);
      const order = await created.json();

      const jobsRes = await request.get(`${API}/print-jobs?limit=100`, {
        headers: auth(manager),
      });
      const jobs = ((await jobsRes.json()).printJobs as any[]).filter(
        (j) => j.order_number === order.orderNumber,
      );
      const barJob = jobs.find((j) => j.ticket_type === 'BAR');
      expect(barJob).toBeTruthy();
      expect(barJob.status).toBe('FAILED');
      expect(barJob.printer_name).toBeNull();
      expect(barJob.last_error).toContain('BAR');
      expect(JSON.parse(barJob.payload).lines).toHaveLength(1);

      const kitchenJob = jobs.find((j) => j.ticket_type === 'KITCHEN');
      expect(kitchenJob).toBeTruthy();
      expect(kitchenJob.status).not.toBe('FAILED');

      // The waiter's order itself must still have succeeded.
      expect(jobs).toHaveLength(2);
    } finally {
      await request.patch(`${API}/printers/${barPrinter.id}`, {
        headers: auth(manager),
        data: { isActive: true },
      });
    }
  });
});
