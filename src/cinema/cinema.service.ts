import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MonitorConfigService } from '../config/monitor-config.service';
import {
  CinemaProvider,
  CINEMA_PROVIDERS,
  ScreeningInfo,
} from './interfaces/cinema-provider.interface';
import { MonitorTarget } from './interfaces/monitor-target.interface';
import { DetectorService } from '../detector/detector.service';
import { DiscordService } from '../notification/discord.service';
import { HealthWatchdogService } from '../common/health-watchdog.service';

@Injectable()
export class CinemaService implements OnModuleInit {
  private readonly logger = new Logger(CinemaService.name);

  constructor(
    @Inject(CINEMA_PROVIDERS)
    private readonly providers: CinemaProvider[],
    private readonly configService: MonitorConfigService,
    private readonly detectorService: DetectorService,
    private readonly discordService: DiscordService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly healthWatchdog: HealthWatchdogService,
  ) {}

  onModuleInit() {
    const intervalMs = this.configService.checkIntervalMin * 60 * 1000;

    this.logger.log(
      `Starting scheduler: every ${this.configService.checkIntervalMin} minute(s)`,
    );

    // Run immediately on start, then send startup summary.
    // DB에 이전 상태가 있으면 cold start가 아니므로 new screening 알림을 정상 발송.
    // DetectorService가 진짜 cold start(DB 없음)일 때는 자체적으로 빈 배열을 반환하므로 안전.
    void this.checkAll()
      .then((allScreenings) => this.discordService.notifyStartup(allScreenings))
      .catch((err) => this.logger.error(`Startup notification failed: ${err}`));

    // Then schedule recurring checks with randomized jitter (±20%)
    const scheduleNext = () => {
      const jitter = intervalMs * (0.8 + Math.random() * 0.4); // ±20%
      const timeout = setTimeout(() => {
        void this.checkAll().then(() => scheduleNext());
      }, jitter);
      // Remove previous timer before registering new one
      if (this.schedulerRegistry.doesExist('interval', 'cinema-check')) {
        this.schedulerRegistry.deleteInterval('cinema-check');
      }
      this.schedulerRegistry.addInterval(
        'cinema-check',
        timeout as unknown as ReturnType<typeof setInterval>,
      );
    };
    scheduleNext();
  }

  async checkAll(
    options: { skipNotify?: boolean } = {},
  ): Promise<ScreeningInfo[]> {
    this.logger.log('Starting screening check...');
    const targets = this.configService.targets;
    const allScreenings: ScreeningInfo[] = [];

    for (const target of targets) {
      const screenings = await this.checkTarget(target);
      allScreenings.push(...screenings);
    }

    if (allScreenings.length === 0) {
      this.logger.log('No special screenings found');
      if (!options.skipNotify) {
        await this.healthWatchdog.recordFailure(
          'DOM 구조 또는 API 변경 가능성이 있습니다.',
        );
      }
      return allScreenings;
    }

    this.healthWatchdog.recordSuccess();
    this.logger.log(`Found ${allScreenings.length} special screening(s) total`);

    // Detect new ones (always run to update state)
    const newScreenings =
      await this.detectorService.detectNewScreenings(allScreenings);

    if (newScreenings.length > 0 && !options.skipNotify) {
      const keys = newScreenings.map(
        (s) => `${s.movieTitle}|${s.hallName}|${s.date}`,
      );
      this.logger.log(
        `${newScreenings.length} NEW screening(s) detected: [${keys.join(', ')}]`,
      );
      await this.discordService.notifyNewScreenings(newScreenings);
    } else if (newScreenings.length > 0) {
      this.logger.log(
        `${newScreenings.length} new screening(s) found (startup, skip notify)`,
      );
    } else {
      this.logger.log('No new screenings since last check');
    }

    return allScreenings;
  }

  private async checkTarget(target: MonitorTarget): Promise<ScreeningInfo[]> {
    const provider = this.providers.find((p) => p.name === target.provider);
    if (!provider) {
      this.logger.warn(`No provider found for: ${target.provider}`);
      return [];
    }

    const dates = this.generateDates(this.configService.checkDaysAhead);
    this.logger.debug(
      `Checking ${target.cinemaName} for ${dates.length} date(s)`,
    );

    const screenings = await provider.fetchScreeningsForDates(
      target.cinemaCode,
      target.cinemaName,
      dates,
    );

    // Filter by hall type
    const filtered = screenings.filter((s) =>
      target.hallTypes.includes(s.hallType),
    );

    // Filter by movie if specified
    const movieFiltered =
      target.movieFilter.length > 0
        ? filtered.filter((s) =>
            target.movieFilter.some((f) => s.movieTitle.includes(f)),
          )
        : filtered;

    this.logger.log(
      `${target.cinemaName}: ${movieFiltered.length} special screening(s)`,
    );

    return movieFiltered;
  }

  private generateDates(daysAhead: number): string[] {
    const dates: string[] = [];
    // KST(UTC+9) 기준 오늘 날짜 계산 — 서버 시간대가 UTC여도 한국 날짜 기준으로 동작
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset);
    const today = new Date(
      kstNow.getUTCFullYear(),
      kstNow.getUTCMonth(),
      kstNow.getUTCDate(),
    );

    for (let i = 0; i < daysAhead; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      dates.push(`${year}${month}${day}`);
    }

    return dates;
  }
}
