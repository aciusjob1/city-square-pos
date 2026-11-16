import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { NetworkModule } from './network/network.module';
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
import { SettingsModule } from './settings/settings.module';
import { StockModule } from './stock/stock.module';
import { DayModule } from './day/day.module';
import { BackupsModule } from './backups/backups.module';
import { TlsModule } from './tls/tls.module';

@Module({
  imports: [
    DatabaseModule,
    NetworkModule,
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
    SettingsModule,
    StockModule,
    DayModule,
    BackupsModule,
    TlsModule,
  ],
})
export class AppModule {}
