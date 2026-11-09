import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { HealthModule } from './health/health.module';
import { PrintersModule } from './printers/printers.module';
import { OrdersModule } from './orders/orders.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { ReportsModule } from './reports/reports.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { TablesModule } from './tables/tables.module';
import { CatalogModule } from './catalog/catalog.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    UsersModule,
    HealthModule,
    PrintersModule,
    OrdersModule,
    ReceiptsModule,
    ReportsModule,
    PaymentMethodsModule,
    TablesModule,
    CatalogModule,
  ],
})
export class AppModule {}
