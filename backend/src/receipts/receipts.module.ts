import { Module } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { PrintersModule } from '../printers/printers.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [PrintersModule, StockModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
})
export class ReceiptsModule {}
