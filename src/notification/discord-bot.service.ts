import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import { StateService } from '../detector/state.service';
import { ScreeningInfo } from '../cinema/interfaces/cinema-provider.interface';
import { DiscordEmbed, formatDate, getColorForHallType } from './embed.util';

@Injectable()
export class DiscordBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordBotService.name);
  private client: Client | null = null;
  private ready = false;

  private readonly botToken: string | undefined;
  private readonly applicationId: string | undefined;
  private readonly guildId: string | undefined;
  private readonly channelId: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly stateService: StateService,
  ) {
    this.botToken = this.configService.get<string>('DISCORD_BOT_TOKEN');
    this.applicationId = this.configService.get<string>(
      'DISCORD_APPLICATION_ID',
    );
    this.guildId = this.configService.get<string>('DISCORD_GUILD_ID');
    this.channelId = this.configService.get<string>('DISCORD_CHANNEL_ID');
  }

  onModuleInit() {
    this.logger.log(
      `Bot init check: token=${!!this.botToken}, appId=${!!this.applicationId}, channelId=${!!this.channelId}`,
    );

    if (!this.botToken || !this.applicationId) {
      this.logger.warn(
        'DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID not set, bot disabled',
      );
      return;
    }

    // Discord API 연결을 백그라운드로 실행하여 앱 시작을 차단하지 않음.
    // Render 등 환경에서 Discord API가 느리면 onModuleInit이 hang되어
    // 전체 NestJS 초기화가 완료되지 않는 문제 방지.
    void this.initBot();
  }

  private async initBot() {
    try {
      await this.registerSlashCommands();
      await this.startBot();
    } catch (error) {
      this.logger.error(`Discord bot initialization failed: ${error}`);
    }
  }

  onModuleDestroy() {
    if (this.client) {
      void this.client.destroy();
      this.client = null;
      this.ready = false;
      this.logger.log('Discord bot disconnected');
    }
  }

  /** Bot API로 채널에 메시지를 보낼 수 있는지 여부 */
  isAvailable(): boolean {
    return this.ready && !!this.channelId;
  }

  /** Bot API로 채널에 embed 메시지 전송 */
  async sendEmbeds(embeds: DiscordEmbed[]): Promise<boolean> {
    if (!this.isAvailable()) return false;

    const channel = await this.getTextChannel();
    if (!channel) return false;

    try {
      for (let i = 0; i < embeds.length; i += 10) {
        const batch = embeds.slice(i, i + 10);
        const builders = batch.map((e) => {
          const builder = new EmbedBuilder()
            .setTitle(e.title)
            .setDescription(e.description)
            .setColor(e.color);
          if (e.fields.length > 0) builder.addFields(e.fields);
          if (e.url) builder.setURL(e.url);
          if (e.timestamp) builder.setTimestamp(new Date(e.timestamp));
          if (e.footer) builder.setFooter(e.footer);
          return builder;
        });
        await channel.send({ embeds: builders });
      }
      this.logger.log('Discord notification sent via Bot API');
      return true;
    } catch (error) {
      this.logger.error(`Bot API send failed: ${error}`);
      return false;
    }
  }

  private async getTextChannel(): Promise<TextChannel | null> {
    if (!this.client || !this.channelId) return null;

    try {
      const channel = await this.client.channels.fetch(this.channelId);
      if (channel instanceof TextChannel) {
        return channel;
      }
      this.logger.error(`Channel ${this.channelId} is not a text channel`);
      return null;
    } catch (error) {
      this.logger.error(`Failed to fetch channel ${this.channelId}: ${error}`);
      return null;
    }
  }

  private async registerSlashCommands() {
    const rest = new REST({ version: '10' }).setToken(this.botToken!);

    const commands = [
      new SlashCommandBuilder()
        .setName('상영중')
        .setDescription('현재 추적 중인 특별관 상영 정보를 조회합니다')
        .toJSON(),
    ];

    try {
      if (this.guildId) {
        await rest.put(
          Routes.applicationGuildCommands(this.applicationId!, this.guildId),
          { body: commands },
        );
        this.logger.log(`Slash commands registered for guild ${this.guildId}`);
      } else {
        await rest.put(Routes.applicationCommands(this.applicationId!), {
          body: commands,
        });
        this.logger.log('Slash commands registered globally');
      }
    } catch (error) {
      this.logger.error(`Failed to register slash commands: ${error}`);
    }
  }

  private async startBot() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });

    this.client.on('ready', () => {
      this.ready = true;
      this.logger.log(`Discord bot logged in as ${this.client!.user?.tag}`);
    });

    this.client.on('interactionCreate', (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === '상영중') {
        void this.handleScreeningsCommand(interaction);
      }
    });

    await this.client.login(this.botToken);
  }

  private async handleScreeningsCommand(
    interaction: ChatInputCommandInteraction,
  ) {
    try {
      const screenings = this.stateService.load();

      if (screenings.length === 0) {
        await interaction.reply({
          content: '현재 추적 중인 특별관 상영 정보가 없습니다.',
        });
        return;
      }

      // 같은 영화+관+영화관 조합을 그룹핑
      const grouped = new Map<
        string,
        { screening: ScreeningInfo; dates: { date: string; times: string[] }[] }
      >();
      for (const s of screenings) {
        const key = `${s.cinemaName}|${s.movieTitle}|${s.hallName}`;
        if (!grouped.has(key)) {
          grouped.set(key, { screening: s, dates: [] });
        }
        grouped.get(key)!.dates.push({ date: s.date, times: s.times });
      }

      const embeds = [...grouped.values()].map(({ screening, dates }) => {
        dates.sort((a, b) => a.date.localeCompare(b.date));
        const scheduleLines = dates.map(
          (d) => `**${formatDate(d.date)}**  ${d.times.join(' | ')}`,
        );
        return new EmbedBuilder()
          .setTitle(`🎬 ${screening.cinemaName}`)
          .setDescription(`**${screening.movieTitle}**`)
          .setColor(getColorForHallType(screening.hallType))
          .addFields(
            { name: '🏛️ 상영관', value: screening.hallName, inline: true },
            { name: '🎞️ 타입', value: screening.hallType, inline: true },
            { name: '📅 상영 일정', value: scheduleLines.join('\n') },
          )
          .setURL('https://cgv.co.kr/cnm/movieBook/movie');
      });

      const firstBatch = embeds.slice(0, 10);
      await interaction.reply({
        content: `📋 **${screenings.length}개** 특별관 상영 정보`,
        embeds: firstBatch,
      });

      for (let i = 10; i < embeds.length; i += 10) {
        const batch = embeds.slice(i, i + 10);
        await interaction.followUp({ embeds: batch });
      }
    } catch (error) {
      this.logger.error(`Failed to handle /상영중 command: ${error}`);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '상영 정보를 불러오는 중 오류가 발생했습니다.',
            ephemeral: true,
          });
        }
      } catch {
        // interaction already expired
      }
    }
  }
}
