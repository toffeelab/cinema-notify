import { ConfigService } from '@nestjs/config';
import { StateService } from './state.service';
import { ScreeningInfo } from '../cinema/interfaces/cinema-provider.interface';

// Mock pg Pool
const mockQuery = jest.fn();
const mockEnd = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: mockQuery,
    end: mockEnd,
  })),
}));

describe('StateService', () => {
  let service: StateService;

  const sampleScreenings: ScreeningInfo[] = [
    {
      movieTitle: '브라이드!',
      hallName: 'IMAX관',
      hallType: 'IMAX',
      date: '20260309',
      times: ['16:50', '19:30'],
      cinemaName: 'CGV 용산아이파크몰',
    },
  ];

  const mockConfigService = {
    getOrThrow: jest.fn().mockReturnValue('postgresql://localhost/test'),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StateService(mockConfigService);
  });

  describe('onModuleInit', () => {
    it('should create table and load existing state', async () => {
      mockQuery
        .mockResolvedValueOnce({}) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [{ data: sampleScreenings }] }); // SELECT

      await service.onModuleInit();

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(service.isColdStart).toBe(false);
      expect(service.load()).toEqual(sampleScreenings);
    });

    it('should set cold start when no previous state', async () => {
      mockQuery
        .mockResolvedValueOnce({}) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }); // SELECT empty

      await service.onModuleInit();

      expect(service.isColdStart).toBe(true);
      expect(service.load()).toEqual([]);
    });
  });

  describe('onModuleDestroy', () => {
    it('should close pool', async () => {
      mockEnd.mockResolvedValue(undefined);

      await service.onModuleDestroy();

      expect(mockEnd).toHaveBeenCalled();
    });
  });

  describe('load', () => {
    it('should return cached screenings', () => {
      // Default cache is empty
      expect(service.load()).toEqual([]);
    });
  });

  describe('save', () => {
    it('should update cache and persist to DB', async () => {
      mockQuery.mockResolvedValue({});

      await service.save(sampleScreenings);

      expect(service.load()).toEqual(sampleScreenings);
      expect(mockQuery).toHaveBeenCalledTimes(2); // INSERT + DELETE cleanup
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO screening_state'),
        [JSON.stringify(sampleScreenings)],
      );
    });

    it('should not throw on DB error', async () => {
      mockQuery.mockRejectedValue(new Error('connection refused'));

      await expect(service.save(sampleScreenings)).resolves.not.toThrow();
      // Cache still updated even on DB error
      expect(service.load()).toEqual(sampleScreenings);
    });
  });

  describe('isColdStart / clearColdStart', () => {
    it('should default to cold start', () => {
      expect(service.isColdStart).toBe(true);
    });

    it('should clear cold start flag', () => {
      service.clearColdStart();
      expect(service.isColdStart).toBe(false);
    });
  });
});
