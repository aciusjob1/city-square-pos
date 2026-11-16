import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { BrandingController, SettingsController } from './settings.controller';

@Module({
  providers: [SettingsService],
  controllers: [BrandingController, SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
