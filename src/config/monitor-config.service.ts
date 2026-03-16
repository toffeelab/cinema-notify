import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MonitorConfig } from '../cinema/interfaces/monitor-target.interface';

@Injectable()
export class MonitorConfigService implements OnModuleInit {
  private readonly logger = new Logger(MonitorConfigService.name);
  private config!: MonitorConfig;

  onModuleInit() {
    this.loadConfig();
  }

  private loadConfig() {
    const configPath = join(process.cwd(), 'config.json');
    const raw = readFileSync(configPath, 'utf-8');
    this.config = JSON.parse(raw) as MonitorConfig;
    this.logger.log(
      `Loaded config: ${this.config.targets.length} target(s), interval=${this.config.checkIntervalMin}min`,
    );
  }

  getConfig(): MonitorConfig {
    return this.config;
  }

  get checkIntervalMin(): number {
    return this.config.checkIntervalMin;
  }

  get checkDaysAhead(): number {
    return this.config.checkDaysAhead;
  }

  get targets() {
    return this.config.targets;
  }
}
