import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async health() {
    const dbOk = await this.db.ping();
    return {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'ok' : 'unreachable',
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      service: 'city-square-pos-backend',
      version: '0.1.0',
    };
  }
}
