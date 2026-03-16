/**
 * CgvProvider unit tests - testing pure logic methods only.
 * Browser-dependent methods (fetchScreeningsForDates) are not tested here
 * as they require Playwright browser instances (integration/e2e scope).
 */

// We need to access private methods for unit testing the pure logic.
// We do this by creating an instance and using bracket notation.
import { CgvProvider } from './cgv.provider';

describe('CgvProvider', () => {
  let provider: CgvProvider;

  beforeEach(() => {
    provider = new CgvProvider();
  });

  afterEach(async () => {
    await provider.dispose();
  });

  describe('name', () => {
    it('should be "cgv"', () => {
      expect(provider.name).toBe('cgv');
    });
  });

  describe('classifyHall (private)', () => {
    const classifyHall = (scnsNm: string, movkndDsplNm: string) =>
      (provider as any)['classifyHall'](scnsNm, movkndDsplNm);

    it('should classify IMAX hall', () => {
      expect(classifyHall('IMAX관', '2D')).toBe('IMAX');
      expect(classifyHall('IMAX 레이저', '')).toBe('IMAX');
    });

    it('should classify 4DX hall', () => {
      expect(classifyHall('4DX관', '4DX 2D')).toBe('4DX');
      expect(classifyHall('일반관', '4DX 3D')).toBe('4DX');
    });

    it('should classify SCREENX hall', () => {
      expect(classifyHall('ScreenX관', '')).toBe('SCREENX');
      expect(classifyHall('SCREEN X관', '')).toBe('SCREENX');
    });

    it('should classify DOLBY hall', () => {
      expect(classifyHall('DOLBY ATMOS관', '')).toBe('DOLBY');
      expect(classifyHall('', 'Dolby Cinema')).toBe('DOLBY');
    });

    it('should classify as STANDARD when no special type matches', () => {
      expect(classifyHall('1관', '2D')).toBe('STANDARD');
      expect(classifyHall('프리미엄관', '')).toBe('STANDARD');
    });
  });

  describe('formatTime (private)', () => {
    const formatTime = (tm: string) => (provider as any)['formatTime'](tm);

    it('should format 4-digit time string', () => {
      expect(formatTime('1650')).toBe('16:50');
      expect(formatTime('0900')).toBe('09:00');
      expect(formatTime('2440')).toBe('24:40');
    });
  });

  describe('cleanMovieTitle (private)', () => {
    const cleanMovieTitle = (raw: string) =>
      (provider as any)['cleanMovieTitle'](raw);

    it('should remove parenthetical format info', () => {
      expect(cleanMovieTitle('호퍼스(자막, 4DX 2D)')).toBe('호퍼스');
      expect(cleanMovieTitle('브라이드!(더빙)')).toBe('브라이드!');
    });

    it('should keep title as-is if no parentheses', () => {
      expect(cleanMovieTitle('미션임파서블')).toBe('미션임파서블');
    });

    it('should trim whitespace', () => {
      expect(cleanMovieTitle('  호퍼스  (자막)  ')).toBe('호퍼스');
    });
  });

  describe('parseApiResponse (private)', () => {
    const parseApiResponse = (response: any, date: string) =>
      (provider as any)['parseApiResponse'](response, date);

    it('should return empty array for empty data', () => {
      expect(parseApiResponse({ data: [] }, '20260309')).toEqual([]);
      expect(parseApiResponse({ data: null }, '20260309')).toEqual([]);
    });

    it('should skip STANDARD hall screenings', () => {
      const response = {
        data: [
          {
            scnsNm: '1관',
            movkndDsplNm: '2D',
            prodNm: '테스트영화',
            scnsrtTm: '1400',
            scnendTm: '1600',
            stcnt: '200',
            frSeatCnt: '100',
            scnYmd: '20260309',
            siteNm: 'CGV 용산',
          },
        ],
      };

      const result = parseApiResponse(response, '20260309');
      expect(result).toHaveLength(0);
    });

    it('should parse IMAX screening correctly', () => {
      const response = {
        data: [
          {
            scnsNm: 'IMAX관',
            movkndDsplNm: '2D',
            prodNm: '브라이드!(자막)',
            scnsrtTm: '1650',
            scnendTm: '1900',
            stcnt: '300',
            frSeatCnt: '150',
            scnYmd: '20260309',
            siteNm: 'CGV 용산아이파크몰',
          },
        ],
      };

      const result = parseApiResponse(response, '20260309');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        movieTitle: '브라이드!',
        hallName: 'IMAX관',
        hallType: 'IMAX',
        date: '20260309',
        times: ['16:50'],
        cinemaName: 'CGV 용산아이파크몰',
      });
    });

    it('should group multiple times for same movie/hall/date', () => {
      const response = {
        data: [
          {
            scnsNm: 'IMAX관',
            movkndDsplNm: '2D',
            prodNm: '브라이드!',
            scnsrtTm: '1650',
            scnendTm: '1900',
            stcnt: '300',
            frSeatCnt: '150',
            scnYmd: '20260309',
            siteNm: 'CGV 용산',
          },
          {
            scnsNm: 'IMAX관',
            movkndDsplNm: '2D',
            prodNm: '브라이드!',
            scnsrtTm: '1930',
            scnendTm: '2200',
            stcnt: '300',
            frSeatCnt: '200',
            scnYmd: '20260309',
            siteNm: 'CGV 용산',
          },
        ],
      };

      const result = parseApiResponse(response, '20260309');
      expect(result).toHaveLength(1);
      expect(result[0].times).toEqual(['16:50', '19:30']);
    });

    it('should separate different movies into different entries', () => {
      const response = {
        data: [
          {
            scnsNm: 'IMAX관',
            movkndDsplNm: '2D',
            prodNm: '영화A',
            scnsrtTm: '1400',
            scnendTm: '1600',
            stcnt: '300',
            frSeatCnt: '150',
            scnYmd: '20260309',
            siteNm: 'CGV',
          },
          {
            scnsNm: 'IMAX관',
            movkndDsplNm: '2D',
            prodNm: '영화B',
            scnsrtTm: '1700',
            scnendTm: '1900',
            stcnt: '300',
            frSeatCnt: '200',
            scnYmd: '20260309',
            siteNm: 'CGV',
          },
        ],
      };

      const result = parseApiResponse(response, '20260309');
      expect(result).toHaveLength(2);
      expect(result.map((r: any) => r.movieTitle)).toEqual(['영화A', '영화B']);
    });
  });
});
