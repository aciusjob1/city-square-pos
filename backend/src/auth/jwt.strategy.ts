import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly users: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev-only-change-me',
    });
  }

  async validate(payload: { sub: string; username: string; role: string }) {
    // Re-verify against DB on every request so deactivation and role
    // changes take effect immediately — not at next token refresh.
    const user = await this.users.findById(payload.sub);
    if (!user || !user.is_active) {
      throw new UnauthorizedException('Account is inactive or no longer exists');
    }
    return { userId: user.id, username: user.username, role: user.role_name };
  }
}
