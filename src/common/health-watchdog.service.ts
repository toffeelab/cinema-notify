import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { DiscordService } from '../notification/discord.service';

@Injectable()
export class HealthWatchdogService implements OnApplicationShutdown {
  private readonly logger = new Logger(HealthWatchdogService.name);
  private consecutiveFailureCount = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 5;

  constructor(private readonly discordService: DiscordService) {}

  async recordFailure(reason: string): Promise<void> {
    this.consecutiveFailureCount++;
    this.logger.warn(
      `연속 실패 ${this.consecutiveFailureCount}/${this.MAX_CONSECUTIVE_FAILURES}`,
    );

    if (this.consecutiveFailureCount >= this.MAX_CONSECUTIVE_FAILURES) {
      this.logger.error('연속 실패 한계 도달. 서버를 종료합니다.');
      await this.discordService.notifyError(
        `스크래핑 연속 ${this.consecutiveFailureCount}회 실패.\n${reason}`,
      );
      process.exit(1);
    }
  }

  recordSuccess(): void {
    if (this.consecutiveFailureCount > 0) {
      this.logger.log('스크래핑 성공. 실패 카운터 리셋.');
    }
    this.consecutiveFailureCount = 0;
  }

  onApplicationShutdown(signal?: string): void {
    this.logger.log(`Application shutting down (signal: ${signal})`);
  }
}
