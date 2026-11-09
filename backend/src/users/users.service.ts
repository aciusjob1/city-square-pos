import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  full_name: string;
  role_id: string;
  role_name: string;
  is_active: boolean;
  last_login_at: Date | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async findByUsername(username: string): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>(
      `SELECT u.id, u.username, u.email, u.password_hash, u.full_name,
              u.role_id, r.name AS role_name, u.is_active, u.last_login_at
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.username = $1
        LIMIT 1`,
      [username],
    );
    return r.rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>(
      `SELECT u.id, u.username, u.email, u.password_hash, u.full_name,
              u.role_id, r.name AS role_name, u.is_active, u.last_login_at
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1
        LIMIT 1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [id]);
  }
}
