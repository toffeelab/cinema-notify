import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { ScreeningInfo } from '../cinema/interfaces/cinema-provider.interface';

@Injectable()
export class StateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StateService.name);
  private readonly pool: Pool;
  private _coldStart = true;

  /** 메모리 캐시: DB 읽기 최소화 */
  private cache: ScreeningInfo[] = [];

  constructor(configService: ConfigService) {
    const dbUrl = configService.getOrThrow<string>('DATABASE_URL');
    const separator = dbUrl.includes('?') ? '&' : '?';
    this.pool = new Pool({
      connectionString: `${dbUrl}${separator}sslmode=verify-full`,
      max: 3,
    });
  }

  async onModuleInit() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS screening_state (
        id SERIAL PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 기존 데이터가 있으면 cold start가 아님
    const result = await this.pool.query<{ data: ScreeningInfo[] }>(
      'SELECT data FROM screening_state ORDER BY id DESC LIMIT 1',
    );
    if (result.rows.length > 0) {
      this.cache = result.rows[0].data;
      this._coldStart = false;
      this.logger.log(
        `State loaded from DB: ${this.cache.length} screening(s)`,
      );
    } else {
      this.logger.log('No previous state in DB — cold start');
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  get isColdStart(): boolean {
    return this._coldStart;
  }

  clearColdStart() {
    this._coldStart = false;
  }

  load(): ScreeningInfo[] {
    return this.cache;
  }

  async save(screenings: ScreeningInfo[]) {
    this.cache = screenings;
    try {
      await this.pool.query(`INSERT INTO screening_state (data) VALUES ($1)`, [
        JSON.stringify(screenings),
      ]);
      // 오래된 row 정리 (최신 1개만 유지)
      await this.pool.query(`
        DELETE FROM screening_state
        WHERE id NOT IN (SELECT id FROM screening_state ORDER BY id DESC LIMIT 1)
      `);
    } catch (error) {
      this.logger.error(`Failed to save state to DB: ${error}`);
    }
  }
}
