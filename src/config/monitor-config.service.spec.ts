import { MonitorConfigService } from './monitor-config.service';
import { readFileSync } from 'fs';

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
}));

const mockReadFileSync = readFileSync as jest.MockedFunction<
  typeof readFileSync
>;

describe('MonitorConfigService', () => {
  let service: MonitorConfigService;

  const sampleConfig = {
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
  };

  beforeEach(() => {
    service = new MonitorConfigService();
    mockReadFileSync.mockReturnValue(JSON.stringify(sampleConfig));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should load config.json successfully', () => {
      service.onModuleInit();

      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining('config.json'),
        'utf-8',
      );
    });

    it('should throw if config.json is missing', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(() => service.onModuleInit()).toThrow('ENOENT');
    });

    it('should throw if config.json has invalid JSON', () => {
      mockReadFileSync.mockReturnValue('{ invalid json }');

      expect(() => service.onModuleInit()).toThrow();
    });
  });

  describe('getters', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should return checkIntervalMin', () => {
      expect(service.checkIntervalMin).toBe(5);
    });

    it('should return checkDaysAhead', () => {
      expect(service.checkDaysAhead).toBe(7);
    });

    it('should return targets', () => {
      expect(service.targets).toHaveLength(1);
      expect(service.targets[0].provider).toBe('cgv');
      expect(service.targets[0].cinemaName).toBe('용산아이파크몰');
    });

    it('should return full config via getConfig()', () => {
      const config = service.getConfig();
      expect(config).toEqual(sampleConfig);
    });
  });
});
