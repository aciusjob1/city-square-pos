import { PoolClient } from 'pg';

/**
 * Allocates the next human-readable order number for a given day,
 * using the Africa/Dar_es_Salaam business timezone regardless of server clock.
 *
 * Format: CS-YYYYMMDD-NNNNN
 *
 * Must be called inside an open transaction that has already
 * acquired a lock on the (business_date) counter row.
 */
export async function allocateOrderNumber(client: PoolClient): Promise<string> {
  const dateRow = await client.query<{ biz_date: string }>(
    `SELECT to_char((now() AT TIME ZONE 'Africa/Dar_es_Salaam')::date, 'YYYYMMDD') AS biz_date`,
  );
  const bizDate = dateRow.rows[0].biz_date;

  // Ensure counter row exists, then lock it FOR UPDATE
  await client.query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [`order_counter_${bizDate}`, JSON.stringify(0)],
  );

  const lock = await client.query<{ value: number }>(
    `SELECT (value)::int AS value
       FROM settings
      WHERE key = $1
      FOR UPDATE`,
    [`order_counter_${bizDate}`],
  );
  const next = (lock.rows[0].value ?? 0) + 1;

  await client.query(
    `UPDATE settings SET value = $2::jsonb, updated_at = now() WHERE key = $1`,
    [`order_counter_${bizDate}`, JSON.stringify(next)],
  );

  const seq = String(next).padStart(5, '0');
  return `CS-${bizDate}-${seq}`;
}
