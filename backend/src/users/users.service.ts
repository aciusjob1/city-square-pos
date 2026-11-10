import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { validatePasswordStrength } from '../common/utils/password';
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

export interface AuthUser {
  userId: string;
  username: string;
  role: string;
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


  // -------- Manager CRUD --------

  async listAll() {
    const r = await this.db.query(
      `SELECT u.id, u.username, u.email, u.full_name, u.is_active, u.last_login_at,
              r.name AS role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
        ORDER BY r.name ASC, u.username ASC`,
    );
    return {
      users: r.rows.map((u: any) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        fullName: u.full_name,
        role: u.role_name,
        isActive: u.is_active,
        lastLoginAt: u.last_login_at,
      })),
    };
  }

  async listRoles() {
    const r = await this.db.query('SELECT name FROM roles ORDER BY name');
    return { roles: r.rows.map((x: any) => x.name) };
  }

  private assertCanActOn(actor: AuthUser, targetRole: string) {
    if (actor.role === 'ADMIN') return;
    if (targetRole === 'ADMIN' || targetRole === 'MANAGER') {
      throw new ForbiddenException('Managers cannot modify manager or admin accounts');
    }
  }

  private assertCanAssignRole(actor: AuthUser, newRole: string) {
    if (actor.role === 'ADMIN') return;
    if (newRole === 'ADMIN' || newRole === 'MANAGER') {
      throw new ForbiddenException('Managers cannot assign manager or admin roles');
    }
  }

  private async roleIdByName(name: string): Promise<string> {
    const r = await this.db.query('SELECT id FROM roles WHERE name = $1', [name]);
    if (!r.rows[0]) throw new BadRequestException('Unknown role');
    return r.rows[0].id;
  }

  async create(input: {
    username: string;
    fullName: string;
    email?: string;
    role: string;
    password: string;
    pin?: string;
  }, actor: AuthUser) {
    this.assertCanAssignRole(actor, input.role);

    const pw = validatePasswordStrength(input.password);
    if (!pw.ok) throw new BadRequestException({ code: 'WEAK_PASSWORD', errors: pw.errors });

    if (input.pin !== undefined) {
      if (input.role !== 'WAITER') throw new BadRequestException('PINs are only available for waiters');
      if (!/^\d{4}$/.test(input.pin)) throw new BadRequestException('PIN must be exactly 4 digits');
    }

    const roleId = await this.roleIdByName(input.role);
    const passwordHash = await bcrypt.hash(input.password, 10);
    const pinHash = input.pin ? await bcrypt.hash(input.pin, 10) : null;
    const pinLookup = input.pin
      ? crypto.createHash('sha256').update(input.pin + ':' + (process.env.JWT_SECRET || 'dev-only-change-me')).digest('hex')
      : null;

    try {
      const r = await this.db.query(
        `INSERT INTO users (username, full_name, email, password_hash, role_id, is_active,
                            pin_hash, pin_lookup, pin_set_at)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8)
         RETURNING id, username, full_name, email, is_active`,
        [
          input.username.trim(),
          input.fullName.trim(),
          input.email?.trim() || null,
          passwordHash,
          roleId,
          pinHash,
          pinLookup,
          input.pin ? new Date() : null,
        ],
      );
      return {
        id: r.rows[0].id,
        username: r.rows[0].username,
        fullName: r.rows[0].full_name,
        email: r.rows[0].email,
        role: input.role,
        isActive: r.rows[0].is_active,
      };
    } catch (e: any) {
      if (e.code === '23505') {
        const constraint = e.constraint || '';
        if (constraint.includes('username')) throw new ConflictException({ code: 'DUPLICATE_USERNAME', message: 'Username already exists' });
        if (constraint.includes('email')) throw new ConflictException({ code: 'DUPLICATE_EMAIL', message: 'Email already exists' });
        if (constraint.includes('pin_lookup')) throw new ConflictException({ code: 'DUPLICATE_PIN', message: 'PIN already in use by another waiter' });
      }
      throw e;
    }
  }

  async update(id: string, input: {
    fullName?: string;
    email?: string;
    role?: string;
  }, actor: AuthUser) {
    const target = await this.findById(id);
    if (!target) throw new NotFoundException('User not found');
    if (actor.userId === id && input.role !== undefined && input.role !== target.role_name) {
      throw new BadRequestException('Cannot change your own role');
    }
    this.assertCanActOn(actor, target.role_name);
    if (input.role !== undefined) this.assertCanAssignRole(actor, input.role);

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (input.fullName !== undefined) {
      sets.push(`full_name = $${i++}`); params.push(input.fullName.trim());
    }
    if (input.email !== undefined) {
      sets.push(`email = $${i++}`); params.push(input.email.trim() || null);
    }
    if (input.role !== undefined) {
      const roleId = await this.roleIdByName(input.role);
      sets.push(`role_id = $${i++}`); params.push(roleId);
    }
    if (sets.length === 0) throw new BadRequestException('No fields to update');
    sets.push(`updated_at = now()`);
    params.push(id);

    try {
      const r = await this.db.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${i}
         RETURNING id, username, full_name, email, is_active`,
        params,
      );
      const u = r.rows[0];
      return {
        id: u.id,
        username: u.username,
        fullName: u.full_name,
        email: u.email,
        role: input.role ?? target.role_name,
        isActive: u.is_active,
      };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint || '').includes('email')) {
        throw new ConflictException({ code: 'DUPLICATE_EMAIL', message: 'Email already exists' });
      }
      throw e;
    }
  }

  async resetPassword(id: string, newPassword: string, actor: AuthUser) {
    const target = await this.findById(id);
    if (!target) throw new NotFoundException('User not found');
    this.assertCanActOn(actor, target.role_name);

    const pw = validatePasswordStrength(newPassword);
    if (!pw.ok) throw new BadRequestException({ code: 'WEAK_PASSWORD', errors: pw.errors });

    const hash = await bcrypt.hash(newPassword, 10);
    await this.db.query(
      'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
      [hash, id],
    );
    return { ok: true };
  }

  async setPin(id: string, pin: string, actor: AuthUser) {
    const target = await this.findById(id);
    if (!target) throw new NotFoundException('User not found');
    if (target.role_name !== 'WAITER') throw new BadRequestException('PINs are only available for waiters');
    this.assertCanActOn(actor, target.role_name);
    if (!/^\d{4}$/.test(pin)) throw new BadRequestException('PIN must be exactly 4 digits');

    const pinHash = await bcrypt.hash(pin, 10);
    const pinLookup = crypto.createHash('sha256').update(pin + ':' + (process.env.JWT_SECRET || 'dev-only-change-me')).digest('hex');

    try {
      await this.db.query(
        'UPDATE users SET pin_hash = $1, pin_lookup = $2, pin_set_at = now(), updated_at = now() WHERE id = $3',
        [pinHash, pinLookup, id],
      );
      return { ok: true };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint || '').includes('pin_lookup')) {
        throw new ConflictException({ code: 'DUPLICATE_PIN', message: 'PIN already in use by another waiter' });
      }
      throw e;
    }
  }

  async deactivate(id: string, actor: AuthUser) {
    const target = await this.findById(id);
    if (!target) throw new NotFoundException('User not found');
    if (actor.userId === id) throw new BadRequestException('Cannot deactivate your own account');
    this.assertCanActOn(actor, target.role_name);

    if (target.role_name === 'ADMIN') {
      const count = await this.db.query<{ n: string }>(
        'SELECT COUNT(*)::text AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = \'ADMIN\' AND u.is_active = true AND u.id <> $1',
        [id],
      );
      if (parseInt(count.rows[0].n, 10) === 0) {
        throw new ConflictException({ code: 'LAST_ADMIN', message: 'Cannot deactivate the last active admin' });
      }
    }

    await this.db.query(
      'UPDATE users SET is_active = false, updated_at = now() WHERE id = $1',
      [id],
    );
    return { id, isActive: false };
  }
}
