import { DetectorService } from './detector.service';
import { StateService } from './state.service';
import { ScreeningInfo } from '../cinema/interfaces/cinema-provider.interface';

describe('DetectorService', () => {
  let detectorService: DetectorService;
  let stateService: jest.Mocked<StateService>;

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
    stateService = {
      load: jest.fn().mockReturnValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      isColdStart: false,
      clearColdStart: jest.fn(),
    } as unknown as jest.Mocked<StateService>;

    detectorService = new DetectorService(stateService);
  });

  describe('detectNewScreenings', () => {
    it('should return all screenings when no previous state exists', async () => {
      stateService.load.mockReturnValue([]);
      const current = [makeScreening()];

      const result = await detectorService.detectNewScreenings(current);

      expect(result).toHaveLength(1);
      expect(result[0].movieTitle).toBe('브라이드!');
    });

    it('should return empty when screenings are unchanged', async () => {
      const screening = makeScreening();
      stateService.load.mockReturnValue([screening]);

      const result = await detectorService.detectNewScreenings([screening]);

      expect(result).toHaveLength(0);
    });

    it('should detect new screenings added alongside existing ones', async () => {
      const existing = makeScreening();
      const newOne = makeScreening({
        movieTitle: '미션임파서블',
        date: '20260310',
      });
      stateService.load.mockReturnValue([existing]);

      const result = await detectorService.detectNewScreenings([existing, newOne]);

      expect(result).toHaveLength(1);
      expect(result[0].movieTitle).toBe('미션임파서블');
    });

    it('should not treat time changes as new screening', async () => {
      const existing = makeScreening({ times: ['16:50'] });
      const updated = makeScreening({ times: ['16:50', '21:00'] });
      stateService.load.mockReturnValue([existing]);

      const result = await detectorService.detectNewScreenings([updated]);

      expect(result).toHaveLength(0);
    });

    it('should not treat cinemaName change as new screening', async () => {
      const existing = makeScreening({ cinemaName: 'CGV 용산아이파크몰' });
      const updated = makeScreening({ cinemaName: 'CGV용산아이파크몰' });
      stateService.load.mockReturnValue([existing]);

      const result = await detectorService.detectNewScreenings([updated]);

      expect(result).toHaveLength(0);
    });

    it('should save current screenings to state', async () => {
      stateService.load.mockReturnValue([]);
      const current = [makeScreening()];

      await detectorService.detectNewScreenings(current);

      expect(stateService.save).toHaveBeenCalledWith(current);
    });

    it('should handle multiple new screenings', async () => {
      stateService.load.mockReturnValue([]);
      const screenings = [
        makeScreening({ movieTitle: 'A' }),
        makeScreening({ movieTitle: 'B' }),
        makeScreening({ movieTitle: 'C' }),
      ];

      const result = await detectorService.detectNewScreenings(screenings);

      expect(result).toHaveLength(3);
    });
  });
});
