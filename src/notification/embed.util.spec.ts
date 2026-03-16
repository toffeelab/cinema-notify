import {
  buildScreeningEmbed,
  getColorForHallType,
  formatDate,
} from './embed.util';
import { ScreeningInfo } from '../cinema/interfaces/cinema-provider.interface';

describe('embed.util', () => {
  describe('getColorForHallType', () => {
    it('should return blue for IMAX', () => {
      expect(getColorForHallType('IMAX')).toBe(0x1e90ff);
    });

    it('should return red-orange for 4DX', () => {
      expect(getColorForHallType('4DX')).toBe(0xff4500);
    });

    it('should return green for SCREENX', () => {
      expect(getColorForHallType('SCREENX')).toBe(0x32cd32);
    });

    it('should return purple for DOLBY', () => {
      expect(getColorForHallType('DOLBY')).toBe(0x9b59b6);
    });

    it('should return gray for unknown type', () => {
      expect(getColorForHallType('STANDARD')).toBe(0x808080);
      expect(getColorForHallType('UNKNOWN')).toBe(0x808080);
    });
  });

  describe('formatDate', () => {
    it('should format YYYYMMDD to YYYY.MM.DD(요일)', () => {
      expect(formatDate('20260309')).toBe('2026.03.09(월)');
      expect(formatDate('20261231')).toBe('2026.12.31(목)');
    });
  });

  describe('buildScreeningEmbed', () => {
    const screening: ScreeningInfo = {
      movieTitle: '브라이드!',
      hallName: 'IMAX관',
      hallType: 'IMAX',
      date: '20260309',
      times: ['16:50', '19:30'],
      cinemaName: 'CGV 용산아이파크몰',
    };

    it('should build embed with correct title', () => {
      const embed = buildScreeningEmbed(screening);
      expect(embed.title).toContain('CGV 용산아이파크몰');
    });

    it('should build embed with movie title in description', () => {
      const embed = buildScreeningEmbed(screening);
      expect(embed.description).toContain('브라이드!');
    });

    it('should set color based on hall type', () => {
      const embed = buildScreeningEmbed(screening);
      expect(embed.color).toBe(0x1e90ff);
    });

    it('should include all fields', () => {
      const embed = buildScreeningEmbed(screening);
      expect(embed.fields).toHaveLength(4);

      const fieldNames = embed.fields.map((f) => f.name);
      expect(fieldNames).toContain('🏛️ 상영관');
      expect(fieldNames).toContain('🎞️ 타입');
      expect(fieldNames).toContain('📅 날짜');
      expect(fieldNames).toContain('⏰ 시간');
    });

    it('should join times with pipe separator', () => {
      const embed = buildScreeningEmbed(screening);
      const timeField = embed.fields.find((f) => f.name === '⏰ 시간');
      expect(timeField!.value).toBe('16:50 | 19:30');
    });

    it('should show "시간 미정" for empty times', () => {
      const embed = buildScreeningEmbed({ ...screening, times: [] });
      const timeField = embed.fields.find((f) => f.name === '⏰ 시간');
      expect(timeField!.value).toBe('시간 미정');
    });

    it('should include CGV booking URL', () => {
      const embed = buildScreeningEmbed(screening);
      expect(embed.url).toBe('https://cgv.co.kr/cnm/movieBook/movie');
    });
  });
});
