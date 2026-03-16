import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScreeningInfo } from '../cinema/interfaces/cinema-provider.interface';
import { DiscordEmbed, buildScreeningEmbed, formatDate } from './embed.util';
import { DiscordBotService } from './discord-bot.service';

@Injectable()
export class DiscordService {
  private readonly logger = new Logger(DiscordService.name);
  private readonly webhookUrl: string | undefined;

  constructor(
    configService: ConfigService,
    @Inject(forwardRef(() => DiscordBotService))
    private readonly botService: DiscordBotService,
  ) {
    this.webhookUrl = configService.get<string>('DISCORD_WEBHOOK_URL');
  }

  async notifyNewScreenings(screenings: ScreeningInfo[]) {
    if (screenings.length === 0) return;

    const embeds = screenings.map((s) => buildScreeningEmbed(s));
    await this.send(embeds);
  }

  async notifyStartup(screenings: ScreeningInfo[]) {
    const count = screenings.length;
    const summaryEmbed: DiscordEmbed = {
      title: '🔄 서버 재기동 완료',
      description:
        count > 0
          ? `**${count}개** 특별관 상영 정보가 감지되었습니다.`
          : '현재 감지된 특별관 상영 정보가 없습니다.',
      color: 0x00d26a,
      fields: [],
    };

    if (count > 0) {
      const byDate = new Map<string, ScreeningInfo[]>();
      for (const s of screenings) {
        const existing = byDate.get(s.date) ?? [];
        existing.push(s);
        byDate.set(s.date, existing);
      }

      const dateEntries = [...byDate.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      for (const [date, items] of dateEntries) {
        const lines = items.map((s) => {
          const times = s.times.length > 0 ? s.times.join(' | ') : '시간 미정';
          return `• **${s.movieTitle}** [${s.hallType}] ${times}`;
        });
        summaryEmbed.fields.push({
          name: `📅 ${formatDate(date)} (${items.length}개)`,
          value: lines.join('\n'),
          inline: false,
        });
      }
    }

    await this.send([summaryEmbed]);
  }

  async notifyError(message: string): Promise<void> {
    const embed: DiscordEmbed = {
      title: '🚨 Cinema Notify 장애 감지',
      description: message,
      color: 0xff0000,
      fields: [
        {
          name: '조치',
          value: '서버를 종료합니다. 수동 확인이 필요합니다.',
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    await this.send([embed]);
  }

  /**
   * Bot API를 우선 시도하고, 불가능하면 webhook으로 fallback.
   * Bot API는 토큰 기반 rate limit이라 Render 공유 IP 문제를 피할 수 있다.
   */
  private async send(embeds: DiscordEmbed[]) {
    // 1) Bot API 시도
    if (this.botService.isAvailable()) {
      const sent = await this.botService.sendEmbeds(embeds);
      if (sent) return;
      this.logger.warn('Bot API failed, falling back to webhook');
    }

    // 2) Webhook fallback
    if (!this.webhookUrl) {
      this.logger.error(
        'No webhook URL configured and Bot API unavailable — notification dropped',
      );
      return;
    }

    for (let i = 0; i < embeds.length; i += 10) {
      const batch = embeds.slice(i, i + 10);
      await this.sendWebhook({ embeds: batch });
    }
  }

  private async sendWebhook(body: Record<string, unknown>, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(this.webhookUrl!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (response.status === 429) {
          const { waitMs, global, scope } =
            await this.parseRateLimitResponse(response);
          const MAX_WAIT = 60_000;
          const actualWait = Math.min(waitMs, MAX_WAIT);

          this.logger.warn(
            `Discord webhook 429 rate limited: ${(waitMs / 1000).toFixed(1)}s` +
              `${global ? ' [GLOBAL]' : ''}` +
              `${scope ? ` scope=${scope}` : ''}` +
              ` — waiting ${(actualWait / 1000).toFixed(1)}s` +
              ` (attempt ${attempt}/${retries})`,
          );
          await new Promise((r) => setTimeout(r, actualWait));
          continue;
        }

        if (!response.ok) {
          this.logger.error(
            `Discord webhook failed: ${response.status} ${response.statusText}`,
          );
        } else {
          this.logger.log('Discord notification sent via webhook');
        }
        return;
      } catch (error) {
        this.logger.error(`Discord webhook error: ${error}`);
        return;
      }
    }
    this.logger.error('Discord webhook failed after all retries');
  }

  private async parseRateLimitResponse(
    response: globalThis.Response,
  ): Promise<{ waitMs: number; global: boolean; scope: string }> {
    const scope = response.headers.get('X-RateLimit-Scope') ?? '';

    try {
      const json = (await response.json()) as {
        retry_after?: number;
        global?: boolean;
      };
      return {
        waitMs:
          typeof json.retry_after === 'number'
            ? json.retry_after * 1000
            : this.parseHeaderRetryAfter(response),
        global: json.global ?? false,
        scope,
      };
    } catch {
      return {
        waitMs: this.parseHeaderRetryAfter(response),
        global: false,
        scope,
      };
    }
  }

  private parseHeaderRetryAfter(response: globalThis.Response): number {
    const header = response.headers.get('Retry-After');
    if (header) {
      return parseFloat(header) * 1000;
    }
    return 5000;
  }
}
