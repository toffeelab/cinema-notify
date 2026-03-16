import { DiscordBotService } from './discord-bot.service';
import { ConfigService } from '@nestjs/config';
import { StateService } from '../detector/state.service';
import { ScreeningInfo } from '../cinema/interfaces/cinema-provider.interface';

// Mock discord.js
jest.mock('discord.js', () => {
  const mockLogin = jest.fn().mockResolvedValue('token');
  const mockDestroy = jest.fn();
  const mockOn = jest.fn();
  const mockClient = jest.fn().mockImplementation(() => ({
    login: mockLogin,
    destroy: mockDestroy,
    on: mockOn,
    user: { tag: 'TestBot#1234' },
  }));

  const mockPut = jest.fn().mockResolvedValue(undefined);
  const mockSetToken = jest.fn().mockReturnValue({ put: mockPut });
  const mockREST = jest.fn().mockImplementation(() => ({
    setToken: mockSetToken,
  }));

  return {
    Client: mockClient,
    GatewayIntentBits: { Guilds: 1 },
    REST: mockREST,
    Routes: {
      applicationCommands: jest.fn().mockReturnValue('/commands'),
      applicationGuildCommands: jest.fn().mockReturnValue('/guild-commands'),
    },
    SlashCommandBuilder: jest.fn().mockImplementation(() => ({
      setName: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({}),
    })),
    EmbedBuilder: jest.fn().mockImplementation(() => ({
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setURL: jest.fn().mockReturnThis(),
    })),
    ChatInputCommandInteraction: jest.fn(),
  };
});

describe('DiscordBotService', () => {
  let service: DiscordBotService;
  let configService: jest.Mocked<ConfigService>;
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

  describe('when bot token is not set', () => {
    beforeEach(() => {
      configService = {
        get: jest.fn().mockReturnValue(undefined),
      } as unknown as jest.Mocked<ConfigService>;
      stateService = {
        load: jest.fn().mockReturnValue([]),
        save: jest.fn(),
      } as unknown as jest.Mocked<StateService>;

      service = new DiscordBotService(configService, stateService);
    });

    it('should skip initialization gracefully', async () => {
      await service.onModuleInit();
      // No error thrown, bot not started
    });

    it('should handle onModuleDestroy without error', () => {
      service.onModuleDestroy();
    });
  });

  describe('when bot token is set', () => {
    beforeEach(() => {
      configService = {
        get: jest.fn().mockImplementation((key: string) => {
          const values: Record<string, string> = {
            DISCORD_BOT_TOKEN: 'test-token',
            DISCORD_APPLICATION_ID: 'test-app-id',
            DISCORD_GUILD_ID: 'test-guild-id',
          };
          return values[key];
        }),
      } as unknown as jest.Mocked<ConfigService>;
      stateService = {
        load: jest.fn().mockReturnValue([makeScreening()]),
        save: jest.fn(),
      } as unknown as jest.Mocked<StateService>;

      service = new DiscordBotService(configService, stateService);
    });

    it('should initialize bot and register commands', async () => {
      await service.onModuleInit();
      // If no error, bot was initialized
    });

    it('should register guild commands when GUILD_ID is set', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Routes } = require('discord.js');
      await service.onModuleInit();
      expect(Routes.applicationGuildCommands).toHaveBeenCalledWith(
        'test-app-id',
        'test-guild-id',
      );
    });

    it('should destroy client on module destroy', async () => {
      await service.onModuleInit();
      service.onModuleDestroy();
    });
  });

  describe('when only bot token set (no guild)', () => {
    beforeEach(() => {
      configService = {
        get: jest.fn().mockImplementation((key: string) => {
          const values: Record<string, string | undefined> = {
            DISCORD_BOT_TOKEN: 'test-token',
            DISCORD_APPLICATION_ID: 'test-app-id',
            DISCORD_GUILD_ID: undefined,
          };
          return values[key];
        }),
      } as unknown as jest.Mocked<ConfigService>;
      stateService = {
        load: jest.fn().mockReturnValue([]),
        save: jest.fn(),
      } as unknown as jest.Mocked<StateService>;

      service = new DiscordBotService(configService, stateService);
    });

    it('should register global commands when GUILD_ID is not set', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Routes } = require('discord.js');
      await service.onModuleInit();
      expect(Routes.applicationCommands).toHaveBeenCalledWith('test-app-id');
    });
  });
});
