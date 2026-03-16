import { Test, TestingModule } from '@nestjs/testing';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { CinemaService } from '../src/cinema/cinema.service';
import { DetectorService } from '../src/detector/detector.service';
import { DiscordService } from '../src/notification/discord.service';
import { MonitorConfigService } from '../src/config/monitor-config.service';
import { StateService } from '../src/detector/state.service';
import {
  CINEMA_PROVIDERS,
  CinemaProvider,
  ScreeningInfo,
} from '../src/cinema/interfaces/cinema-provider.interface';

describe('App Integration (e2e)', () => {
  let moduleFixture: TestingModule;
  let cinemaService: CinemaService;
  let mockProvider: jest.Mocked<CinemaProvider>;
  let discordService: jest.Mocked<DiscordService>;
  let mockStateService: {
    load: jest.Mock;
    save: jest.Mock;
    isColdStart: boolean;
    clearColdStart: jest.Mock;
  };

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

  beforeEach(async () => {
    mockProvider = {
      name: 'cgv',
      fetchScreeningsForDates: jest.fn().mockResolvedValue([]),
      dispose: jest.fn(),
    };

    discordService = {
      notifyNewScreenings: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DiscordService>;

    // In-memory state that persists across calls within each test
    let savedState: ScreeningInfo[] = [];
    mockStateService = {
      load: jest.fn().mockImplementation(() => savedState),
      save: jest.fn().mockImplementation((data: ScreeningInfo[]) => {
        savedState = data;
      }),
      isColdStart: false,
      clearColdStart: jest.fn(),
    };

    const mockConfigService = {
      checkIntervalMin: 60,
      checkDaysAhead: 7,
      targets: [
        {
          provider: 'cgv',
          cinemaCode: '0013',
          cinemaName: '용산아이파크몰',
          hallTypes: ['IMAX', '4DX', 'SCREENX', 'DOLBY'],
          movieFilter: [],
        },
      ],
      onModuleInit: jest.fn(),
      getConfig: jest.fn(),
    };

    moduleFixture = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), ConfigModule.forRoot()],
      providers: [
        { provide: MonitorConfigService, useValue: mockConfigService },
        { provide: CINEMA_PROVIDERS, useValue: [mockProvider] },
        { provide: DiscordService, useValue: discordService },
        { provide: StateService, useValue: mockStateService },
        DetectorService,
        CinemaService,
      ],
    }).compile();

    cinemaService = moduleFixture.get<CinemaService>(CinemaService);
  });

  afterEach(async () => {
    // Clean up intervals registered by CinemaService.onModuleInit
    try {
      const registry = moduleFixture.get(SchedulerRegistry);
      if (registry.doesExist('interval', 'cinema-check')) {
        registry.deleteInterval('cinema-check');
      }
    } catch {
      // ignore
    }
    await moduleFixture.close();
  });

  it('should be defined', () => {
    expect(cinemaService).toBeDefined();
  });

  it('should run full check flow: fetch -> detect -> notify', async () => {
    const screening = makeScreening();
    mockProvider.fetchScreeningsForDates.mockResolvedValue([screening]);

    // First check - all screenings are new
    await cinemaService.checkAll();

    expect(mockProvider.fetchScreeningsForDates).toHaveBeenCalled();
    expect(discordService.notifyNewScreenings).toHaveBeenCalledWith([
      screening,
    ]);
  });

  it('should not notify on second check with same screenings', async () => {
    const screening = makeScreening();
    mockProvider.fetchScreeningsForDates.mockResolvedValue([screening]);

    // First check - new screening detected
    await cinemaService.checkAll();
    expect(discordService.notifyNewScreenings).toHaveBeenCalledTimes(1);

    discordService.notifyNewScreenings.mockClear();

    // Second check - same screening, should not notify
    await cinemaService.checkAll();
    expect(discordService.notifyNewScreenings).not.toHaveBeenCalled();
  });

  it('should notify when new screening appears in subsequent check', async () => {
    const screening1 = makeScreening({ movieTitle: 'Movie A' });
    const screening2 = makeScreening({ movieTitle: 'Movie B' });

    // First check
    mockProvider.fetchScreeningsForDates.mockResolvedValue([screening1]);
    await cinemaService.checkAll();

    discordService.notifyNewScreenings.mockClear();

    // Second check - new movie added
    mockProvider.fetchScreeningsForDates.mockResolvedValue([
      screening1,
      screening2,
    ]);
    await cinemaService.checkAll();

    expect(discordService.notifyNewScreenings).toHaveBeenCalledWith([
      screening2,
    ]);
  });
});
