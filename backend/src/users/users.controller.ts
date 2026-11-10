import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { UsersService, AuthUser } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('MANAGER', 'ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.listAll();
  }

  @Post()
  create(@Body() dto: CreateUserDto, @Req() req: { user: AuthUser }) {
    return this.users.create(dto, req.user);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.users.update(id, dto, req.user);
  }

  @Patch(':id/password')
  resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.users.resetPassword(id, dto.newPassword, req.user);
  }

  @Patch(':id/pin')
  setPin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { pin: string },
    @Req() req: { user: AuthUser },
  ) {
    return this.users.setPin(id, body.pin, req.user);
  }

  @Delete(':id')
  deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: { user: AuthUser },
  ) {
    return this.users.deactivate(id, req.user);
  }
}
