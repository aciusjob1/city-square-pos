import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import knexFactory from 'knex';
import { Pool, QueryResult, QueryResultRow, PoolClient } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;

  async onModuleInit() {
    await this.runMigrations();
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    this.pool.on('error', (err) => {
      this.logger.error('PG pool error: ' + err.message);
    });
    this.logger.log('Database pool initialised');
  }

  /**
   * Upgrades install the new backend over the old data directory, so schema
   * changes must be applied at start-up — the installer only migrates fresh
   * clusters. Knex tracks applied migrations in knex_migrations, so this is a
   * no-op on an up-to-date database.
   */
  private async runMigrations() {
    const directory = join(process.cwd(), 'db', 'migrations');
    if (!existsSync(directory)) {
      this.logger.warn('No db/migrations directory found; skipping migrations');
      return;
    }
    const knex = knexFactory({
      client: 'pg',
      connection: process.env.DATABASE_URL,
      migrations: { directory, tableName: 'knex_migrations' },
    });
    try {
      const [, applied] = await knex.migrate.latest();
      if (applied.length > 0) {
        this.logger.log('Applied database migrations: ' + applied.join(', '));
      }
    } finally {
      await knex.destroy();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query<T extends QueryResultRow = any>(
    text: string,
    params?: any[],
  ): Promise<QueryResult<T>> {
    const start = Date.now();
    const result = await this.pool.query<T>(text, params);
    const ms = Date.now() - start;
    if (ms > 500) this.logger.warn('Slow query (' + ms + 'ms)');
    return result;
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
