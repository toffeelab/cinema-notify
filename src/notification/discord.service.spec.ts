import { DiscordService } from './discord.service';
import { ConfigService } from '@nestjs/config';
import { ScreeningInfo } from '../cinema/interfaces/cinema-provider.interface';
import { DiscordBotService } from './discord-bot.service';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('DiscordService', () => {
  let service: DiscordService;
  const webhookUrl = 'https://discord.com/api/webhooks/test/token';
  let mockBotService: jest.Mocked<Pick<DiscordBotService, 'isAvailable' | 'sendEmbeds'>>;

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
    mockBotService = {
      isAvailable: jest.fn().mockReturnValue(false),
      sendEmbeds: jest.fn().mockResolvedValue(false),
    };
    const configService = {
      get: jest.fn().mockReturnValue(webhookUrl),
    } as unknown as ConfigService;
    service = new DiscordService(
      configService,
      mockBotService as unknown as DiscordBotService,
    );
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });
  });

  describe('notifyNewScreenings', () => {
    it('should not call webhook when screenings is empty', async () => {
      await service.notifyNewScreenings([]);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should send webhook with embed for single screening', async () => {
      await service.notifyNewScreenings([makeScreening()]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(webhookUrl);
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0].title).toContain('CGV 용산아이파크몰');
      expect(body.embeds[0].description).toContain('브라이드!');
    });

    it('should format date correctly in embed', async () => {
      await service.notifyNewScreenings([makeScreening({ date: '20260313' })]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const dateField = body.embeds[0].fields.find(
        (f: { name: string }) => f.name === '📅 날짜',
      );
      expect(dateField.value).toBe('2026.03.13(금)');
    });

    it('should set correct color for each hall type', async () => {
      const hallTypes = [
        { type: 'IMAX', color: 0x1e90ff },
        { type: '4DX', color: 0xff4500 },
        { type: 'SCREENX', color: 0x32cd32 },
        { type: 'DOLBY', color: 0x9b59b6 },
      ] as const;

      for (const { type, color } of hallTypes) {
        mockFetch.mockClear();
        await service.notifyNewScreenings([makeScreening({ hallType: type })]);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.embeds[0].color).toBe(color);
      }
    });

    it('should use gray color for unknown hall type', async () => {
      await service.notifyNewScreenings([
        makeScreening({ hallType: 'STANDARD' }),
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].color).toBe(0x808080);
    });

    it('should batch embeds in groups of 10', async () => {
      const screenings = Array.from({ length: 15 }, (_, i) =>
        makeScreening({ movieTitle: `Movie ${i}` }),
      );

      await service.notifyNewScreenings(screenings);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const firstBatch = JSON.parse(mockFetch.mock.calls[0][1].body);
      const secondBatch = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(firstBatch.embeds).toHaveLength(10);
      expect(secondBatch.embeds).toHaveLength(5);
    });

    it('should join times with pipe separator', async () => {
      await service.notifyNewScreenings([
        makeScreening({ times: ['10:00', '14:30', '19:00'] }),
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const timeField = body.embeds[0].fields.find(
        (f: { name: string }) => f.name === '⏰ 시간',
      );
      expect(timeField.value).toBe('10:00 | 14:30 | 19:00');
    });

    it('should show "시간 미정" when times is empty', async () => {
      await service.notifyNewScreenings([makeScreening({ times: [] })]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const timeField = body.embeds[0].fields.find(
        (f: { name: string }) => f.name === '⏰ 시간',
      );
      expect(timeField.value).toBe('시간 미정');
    });

    it('should not throw on webhook failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'ISE',
      });

      await expect(
        service.notifyNewScreenings([makeScreening()]),
      ).resolves.not.toThrow();
    });

    it('should not throw on network error', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));

      await expect(
        service.notifyNewScreenings([makeScreening()]),
      ).resolves.not.toThrow();
    });
  });

  describe('notifyStartup', () => {
    it('should send summary embed when no screenings', async () => {
      await service.notifyStartup([]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0].title).toContain('서버 재기동 완료');
      expect(body.embeds[0].description).toContain('없습니다');
    });

    it('should send only summary embed when screenings exist', async () => {
      const screenings = [
        makeScreening(),
        makeScreening({ movieTitle: 'B', date: '20260310' }),
      ];

      await service.notifyStartup(screenings);

      // Only 1 summary message, no detail embeds
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const summary = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(summary.embeds[0].description).toContain('2개');
      expect(summary.embeds[0].fields.length).toBeGreaterThan(0);
    });

    it('should group summary fields by date with movie details', async () => {
      const screenings = [
        makeScreening({ date: '20260309' }),
        makeScreening({
          movieTitle: 'B',
          date: '20260309',
          hallType: '4DX',
          times: ['14:00'],
        }),
        makeScreening({ movieTitle: 'C', date: '20260310', times: [] }),
      ];

      await service.notifyStartup(screenings);

      const summary = JSON.parse(mockFetch.mock.calls[0][1].body);
      const dateFields = summary.embeds[0].fields;
      expect(dateFields).toHaveLength(2);
      expect(dateFields[0].name).toContain('2026.03.09(월)');
      expect(dateFields[0].name).toContain('2개');
      expect(dateFields[0].value).toContain('브라이드!');
      expect(dateFields[0].value).toContain('[IMAX]');
      expect(dateFields[0].value).toContain('B');
      expect(dateFields[0].value).toContain('[4DX]');
      expect(dateFields[1].name).toContain('2026.03.10(화)');
      expect(dateFields[1].value).toContain('시간 미정');
    });
  });
});
