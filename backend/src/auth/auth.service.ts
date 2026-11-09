import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.users.findByUsername(dto.username);
    if (!user || !user.is_active) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.password_hash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
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
}
