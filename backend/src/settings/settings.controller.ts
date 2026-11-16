import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PatchSettingsDto } from './dto/patch-settings.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('settings')
export class BrandingController {
  constructor(private readonly settings: SettingsService) {}

  // Public: login screens and the top bar need branding before sign-in.
  @Get('branding')
  branding() {
    return this.settings.branding();
  }
}

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('MANAGER', 'ADMIN')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list() {
    return this.settings.list();
  }

  @Patch()
  patch(@Body() dto: PatchSettingsDto) {
    return this.settings.patch(dto);
  }
}
