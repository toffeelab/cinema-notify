import { CinemaService } from './cinema.service';
import { MonitorConfigService } from '../config/monitor-config.service';
import { DetectorService } from '../detector/detector.service';
import { DiscordService } from '../notification/discord.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { HealthWatchdogService } from '../common/health-watchdog.service';
import {
  CinemaProvider,
  ScreeningInfo,
} from './interfaces/cinema-provider.interface';

describe('CinemaService', () => {
  let service: CinemaService;
  let mockProvider: jest.Mocked<CinemaProvider>;
  let configService: jest.Mocked<MonitorConfigService>;
  let detectorService: jest.Mocked<DetectorService>;
  let discordService: jest.Mocked<DiscordService>;
  let schedulerRegistry: jest.Mocked<SchedulerRegistry>;
  let healthWatchdog: jest.Mocked<HealthWatchdogService>;

  const makeScreening = (
    overrides: Partial<ScreeningInfo> = {},
  ): ScreeningInfo => ({
    movieTitle: '브라이드!',
    hallName: 'IMAX관',
    hallType: 'IMAX',
    date: '20260309',
    times: ['16:50', '19:30'],
    cinemaName: 'CGV 용산아이파크몰',
    ...overrides,
  });

  beforeEach(() => {
    mockProvider = {
      name: 'cgv',
      fetchScreeningsForDates: jest.fn().mockResolvedValue([]),
      dispose: jest.fn(),
    } as jest.Mocked<CinemaProvider>;

    configService = {
      checkIntervalMin: 5,
      checkDaysAhead: 7,
      targets: [
        {
          provider: 'cgv',
          cinemaCode: '0013',
          cinemaName: '용산아이파크몰',
          hallTypes: ['IMAX', '4DX'],
          movieFilter: [],
        },
      ],
    } as unknown as jest.Mocked<MonitorConfigService>;

    detectorService = {
      detectNewScreenings: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<DetectorService>;

    discordService = {
      notifyNewScreenings: jest.fn().mockResolvedValue(undefined),
      notifyStartup: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DiscordService>;

    schedulerRegistry = {
      addInterval: jest.fn(),
      deleteInterval: jest.fn(),
      doesExist: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<SchedulerRegistry>;

    healthWatchdog = {
      recordFailure: jest.fn().mockResolvedValue(undefined),
      recordSuccess: jest.fn(),
    } as unknown as jest.Mocked<HealthWatchdogService>;

    service = new CinemaService(
      [mockProvider],
      configService,
      detectorService,
      discordService,
      schedulerRegistry,
      healthWatchdog,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('onModuleInit', () => {
    it('should register interval and run checkAll immediately', () => {
      jest.useFakeTimers();
      service.onModuleInit();

      expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
        'cinema-check',
        expect.any(Object),
      );
    });
  });

  describe('checkAll', () => {
    it('should call provider with generated dates', async () => {
      mockProvider.fetchScreeningsForDates.mockResolvedValue([]);

      await service.checkAll();

      expect(mockProvider.fetchScreeningsForDates).toHaveBeenCalledWith(
        '0013',
        '용산아이파크몰',
        expect.any(Array),
      );
      // Should generate 7 dates (checkDaysAhead)
      const dates = mockProvider.fetchScreeningsForDates.mock.calls[0][2];
      expect(dates).toHaveLength(7);
      // Each date should be YYYYMMDD format
      for (const d of dates) {
        expect(d).toMatch(/^\d{8}$/);
      }
    });

    it('should filter by hallType', async () => {
      const screenings = [
        makeScreening({ hallType: 'IMAX' }),
        makeScreening({ hallType: 'DOLBY', movieTitle: 'DolbyFilm' }),
        makeScreening({ hallType: '4DX', movieTitle: '4DXFilm' }),
      ];
      mockProvider.fetchScreeningsForDates.mockResolvedValue(screenings);

      await service.checkAll();

      // Only IMAX and 4DX should pass (target.hallTypes = ['IMAX', '4DX'])
      const passedToDetector =
        detectorService.detectNewScreenings.mock.calls[0][0];
      expect(passedToDetector).toHaveLength(2);
      expect(passedToDetector.map((s: ScreeningInfo) => s.hallType)).toEqual([
        'IMAX',
        '4DX',
      ]);
    });

    it('should apply movieFilter when specified', async () => {
      (configService as any).targets = [
        {
          provider: 'cgv',
          cinemaCode: '0013',
          cinemaName: '용산아이파크몰',
          hallTypes: ['IMAX'],
          movieFilter: ['브라이드'],
        },
      ];
      const screenings = [
        makeScreening({ movieTitle: '브라이드!' }),
        makeScreening({ movieTitle: '미션임파서블' }),
      ];
      mockProvider.fetchScreeningsForDates.mockResolvedValue(screenings);

      await service.checkAll();

      const passedToDetector =
        detectorService.detectNewScreenings.mock.calls[0][0];
      expect(passedToDetector).toHaveLength(1);
      expect(passedToDetector[0].movieTitle).toBe('브라이드!');
    });

    it('should send new screenings to Discord', async () => {
      const screening = makeScreening();
      mockProvider.fetchScreeningsForDates.mockResolvedValue([screening]);
      detectorService.detectNewScreenings.mockReturnValue([screening]);

      await service.checkAll();

      expect(discordService.notifyNewScreenings).toHaveBeenCalledWith([
        screening,
      ]);
    });

    it('should not send Discord notification when no new screenings', async () => {
      const screening = makeScreening();
      mockProvider.fetchScreeningsForDates.mockResolvedValue([screening]);
      detectorService.detectNewScreenings.mockReturnValue([]);

      await service.checkAll();

      expect(discordService.notifyNewScreenings).not.toHaveBeenCalled();
    });

    it('should skip target with unknown provider', async () => {
      (configService as any).targets = [
        {
          provider: 'lotte',
          cinemaCode: '001',
          cinemaName: '롯데시네마',
          hallTypes: ['IMAX'],
          movieFilter: [],
        },
      ];

      await service.checkAll();

      expect(mockProvider.fetchScreeningsForDates).not.toHaveBeenCalled();
    });

    it('should handle no screenings found', async () => {
      mockProvider.fetchScreeningsForDates.mockResolvedValue([]);

      await service.checkAll();

      expect(detectorService.detectNewScreenings).not.toHaveBeenCalled();
      expect(discordService.notifyNewScreenings).not.toHaveBeenCalled();
    });

    it('should return allScreenings from checkAll', async () => {
      const screening = makeScreening();
      mockProvider.fetchScreeningsForDates.mockResolvedValue([screening]);
      detectorService.detectNewScreenings.mockReturnValue([]);

      const result = await service.checkAll();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(screening);
    });

    it('should return empty array when no screenings found', async () => {
      mockProvider.fetchScreeningsForDates.mockResolvedValue([]);

      const result = await service.checkAll();

      expect(result).toEqual([]);
    });

    it('should skip notification when skipNotify is true', async () => {
      const screening = makeScreening();
      mockProvider.fetchScreeningsForDates.mockResolvedValue([screening]);
      detectorService.detectNewScreenings.mockReturnValue([screening]);

      await service.checkAll({ skipNotify: true });

      // State should still be updated (detectNewScreenings called)
      expect(detectorService.detectNewScreenings).toHaveBeenCalled();
      // But no Discord notification sent
      expect(discordService.notifyNewScreenings).not.toHaveBeenCalled();
    });
  });
});
