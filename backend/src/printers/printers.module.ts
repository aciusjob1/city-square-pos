import { Module } from '@nestjs/common';
import { PrintersService } from './printers.service';
import { PrintJobsController } from './print-jobs.controller';

@Module({
  providers: [PrintersService],
  controllers: [PrintJobsController],
  exports: [PrintersService],
})
export class PrintersModule {}
