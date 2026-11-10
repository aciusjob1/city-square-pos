import {
  HttpException, HttpStatus, Injectable, Logger, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';

const RATE_LIMIT_WINDOW_SEC = 60;
const RATE_LIMIT_MAX = 20;
const CLEANUP_WINDOW_MIN = 10;

interface PinUserRow {
  id: string;
  username: string;
  full_name: string;
  role_name: string;
  pin_hash: string;
}

@Injectable()
export class AuthPinService {
  private readonly logger = new Logger(AuthPinService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async loginWithPin(pin: string, ipAddress: string) {
    // 1) Rate limit per IP
    const rl = await this.db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM pin_attempts_log
        WHERE ip_address = $1
          AND attempted_at > now() - ($2 || ' seconds')::interval`,
      [ipAddress, String(RATE_LIMIT_WINDOW_SEC)],
    );
    if (parseInt(rl.rows[0].n, 10) >= RATE_LIMIT_MAX) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many PIN attempts. Try again in a minute.',
          code: 'RATE_LIMITED',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2) Log this attempt (before validation — failed attempts count too)
    await this.db.query(
      `INSERT INTO pin_attempts_log (ip_address) VALUES ($1)`,
      [ipAddress],
    );

    // 3) Deterministic lookup
    const secret = process.env.JWT_SECRET || 'dev-only-change-me';
    const lookup = crypto.createHash('sha256').update(pin + ':' + secret).digest('hex');

    const found = await this.db.query<PinUserRow>(
      `SELECT u.id, u.username, u.full_name,
              r.name AS role_name, u.pin_hash
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.pin_lookup = $1
          AND u.is_active = true
          AND r.name = 'WAITER'
        LIMIT 1`,
      [lookup],
    );
    if (!found.rows[0]) {
      throw new UnauthorizedException('Incorrect PIN');
    }
    const user = found.rows[0];

    // 4) bcrypt verification (defense in depth)
    const ok = await bcrypt.compare(pin, user.pin_hash);
    if (!ok) {
      throw new UnauthorizedException('Incorrect PIN');
    }

    // 5) Issue JWT — same shape as password login
    await this.db.query(
      `UPDATE users SET last_login_at = now() WHERE id = $1`,
      [user.id],
    );

    const payload = { sub: user.id, username: user.username, role: user.role_name };
    const token = await this.jwt.signAsync(payload);

    this.logger.log(`PIN login OK: ${user.username} from ${ipAddress}`);

    // Opportunistic cleanup of old attempts
    await this.db.query(
      `DELETE FROM pin_attempts_log
        WHERE attempted_at < now() - ($1 || ' minutes')::interval`,
      [String(CLEANUP_WINDOW_MIN)],
    );

    return {
      accessToken: token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: user.role_name,
      },
    };
  }
}
