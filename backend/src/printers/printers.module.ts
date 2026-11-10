import { Module } from '@nestjs/common';
import { PrintersService } from './printers.service';
import { PrintJobsController } from './print-jobs.controller';
import { PrintersController } from './printers.controller';

@Module({
  providers: [PrintersService],
  controllers: [PrintJobsController, PrintersController],
  exports: [PrintersService],
})
export class PrintersModule {}
