import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrintersModule } from '../printers/printers.module';

@Module({
  imports: [PrintersModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
