import { DatabaseService } from '../database/database.service';

export const DEFAULT_RESTAURANT_NAME = 'City Square';

export async function loadRestaurantName(db: DatabaseService): Promise<string> {
  const r = await db.query<{ name: string | null }>(
    `SELECT value #>> '{}' AS name FROM settings WHERE key = 'restaurant_name'`,
  );
  const name = r.rows[0]?.name?.trim();
  return name || DEFAULT_RESTAURANT_NAME;
}
