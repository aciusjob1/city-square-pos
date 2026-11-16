import { Module } from '@nestjs/common';
import { PrintersService } from './printers.service';
import { PrinterDiscoveryService } from './printer-discovery.service';
import { PrinterDispatchService } from './printer-dispatch.service';
import { PrintJobsController } from './print-jobs.controller';
import { PrintersController } from './printers.controller';

@Module({
  providers: [PrintersService, PrinterDiscoveryService, PrinterDispatchService],
  controllers: [PrintJobsController, PrintersController],
  exports: [PrintersService, PrinterDispatchService],
})
export class PrintersModule {}
