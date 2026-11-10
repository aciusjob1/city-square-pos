import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { BillGroupsService } from './bill-groups.service';
import { BillGroupsController } from './bill-groups.controller';
import { PrintersModule } from '../printers/printers.module';

@Module({
  imports: [PrintersModule],
  controllers: [OrdersController, BillGroupsController],
  providers: [OrdersService, BillGroupsService],
})
export class OrdersModule {}
