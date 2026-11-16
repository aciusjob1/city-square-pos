import {
  BadRequestException, ForbiddenException, HttpException, HttpStatus,
  Injectable, Logger, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { DatabaseService } from '../database/database.service';
import { validatePasswordStrength } from '../common/utils/password';
import { LoginDto } from './dto/login.dto';

const IP_WINDOW_SEC = 60;
const IP_MAX_FAILURES = 20;
const USER_WINDOW_SEC = 15 * 60;
const USER_MAX_FAILURES = 5;
const RETENTION_HOURS = 24;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
  ) {}

  async login(dto: LoginDto, ipAddress: string) {
    const username = dto.username.trim().toLowerCase();
    const ip = ipAddress || 'unknown';

    await this.assertNotRateLimited(username, ip);

    const user = await this.users.findByUsername(dto.username);
    if (!user || !user.is_active) {
      await this.recordAttempt(ip, username, false);
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.password_hash);
    if (!ok) {
      await this.recordAttempt(ip, username, false);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.recordAttempt(ip, username, true);
    await this.users.touchLastLogin(user.id);
    const payload = { sub: user.id, username: user.username, role: user.role_name };
    const token = await this.jwt.signAsync(payload);
    this.logger.log('Login OK: ' + user.username + ' (' + user.role_name + ')');
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

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const res = await this.db.query<{ password_hash: string; role_name: string }>(
      `SELECT u.password_hash, r.name AS role_name
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1 AND u.is_active = true`,
      [userId],
    );
    const user = res.rows[0];
    if (!user) throw new UnauthorizedException('Account is inactive or no longer exists');

    // Self-service password changes exist only for the account types that
    // sign in with a password; waiters use PINs and cashiers/kitchen staff
    // get their passwords reset by a manager.
    if (user.role_name !== 'ADMIN' && user.role_name !== 'MANAGER') {
      throw new ForbiddenException({
        code: 'PASSWORD_SELF_SERVICE_UNAVAILABLE',
        message: 'Only admins and managers can change their own password',
      });
    }

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) {
      throw new BadRequestException({
        code: 'INVALID_CURRENT_PASSWORD',
        message: 'Current password is incorrect',
      });
    }

    if (newPassword === currentPassword) {
      throw new BadRequestException({
        code: 'PASSWORD_UNCHANGED',
        message: 'New password must be different from the current password',
      });
    }

    const strength = validatePasswordStrength(newPassword);
    if (!strength.ok) {
      throw new BadRequestException({
        code: 'WEAK_PASSWORD',
        message: `Password too weak: ${strength.errors.join(', ')}`,
        errors: strength.errors,
      });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await this.db.query(
      'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
      [hash, userId],
    );
    this.logger.log(`Password changed for user ${userId}`);
    return { ok: true };
  }

  private async assertNotRateLimited(username: string, ip: string) {
    await this.db.query(
      `DELETE FROM login_attempts_log
        WHERE attempted_at < now() - ($1 || ' hours')::interval`,
      [String(RETENTION_HOURS)],
    );

    const byIp = await this.db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM login_attempts_log
        WHERE ip_address = $1
          AND succeeded = false
          AND attempted_at > now() - ($2 || ' seconds')::interval`,
      [ip, String(IP_WINDOW_SEC)],
    );
    const byUser = await this.db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM login_attempts_log
        WHERE username = $1
          AND succeeded = false
          AND attempted_at > now() - ($2 || ' seconds')::interval`,
      [username, String(USER_WINDOW_SEC)],
    );

    if (
      parseInt(byIp.rows[0].n, 10) >= IP_MAX_FAILURES ||
      parseInt(byUser.rows[0].n, 10) >= USER_MAX_FAILURES
    ) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many failed login attempts. Try again later.',
          code: 'RATE_LIMITED',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordAttempt(ip: string, username: string, succeeded: boolean) {
    await this.db.query(
      `INSERT INTO login_attempts_log (ip_address, username, succeeded)
       VALUES ($1, $2, $3)`,
      [ip, username, succeeded],
    );
  }
}
