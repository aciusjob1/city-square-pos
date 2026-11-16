import { Module } from '@nestjs/common';
import { TlsController } from './tls.controller';

@Module({
  controllers: [TlsController],
})
export class TlsModule {}
