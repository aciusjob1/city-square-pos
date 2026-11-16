import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DayController } from './day.controller';
import { DayService } from './day.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DayController],
  providers: [DayService],
})
export class DayModule {}
