import { ScreeningInfo } from '../cinema/interfaces/cinema-provider.interface';

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  url?: string;
  timestamp?: string;
  footer?: { text: string };
}

const ENV_LABEL = process.env.RENDER ? 'production' : 'local';

const HALL_TYPE_COLORS: Record<string, number> = {
  IMAX: 0x1e90ff,
  '4DX': 0xff4500,
  SCREENX: 0x32cd32,
  DOLBY: 0x9b59b6,
};

export function getColorForHallType(type: string): number {
  return HALL_TYPE_COLORS[type] ?? 0x808080;
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export function formatDate(date: string): string {
  const y = parseInt(date.slice(0, 4), 10);
  const m = parseInt(date.slice(4, 6), 10) - 1;
  const d = parseInt(date.slice(6, 8), 10);
  const dayOfWeek = DAY_NAMES[new Date(y, m, d).getDay()];
  return `${date.slice(0, 4)}.${date.slice(4, 6)}.${date.slice(6, 8)}(${dayOfWeek})`;
}

export function buildScreeningEmbed(screening: ScreeningInfo): DiscordEmbed {
  const color = getColorForHallType(screening.hallType);
  const times = screening.times.join(' | ');

  return {
    title: `🎬 ${screening.cinemaName} - 새 특별관 상영 오픈!`,
    description: `**${screening.movieTitle}**`,
    color,
    fields: [
      { name: '🏛️ 상영관', value: screening.hallName, inline: true },
      { name: '🎞️ 타입', value: screening.hallType, inline: true },
      {
        name: '📅 날짜',
        value: formatDate(screening.date),
        inline: true,
      },
      { name: '⏰ 시간', value: times || '시간 미정' },
    ],
    url: 'https://cgv.co.kr/cnm/movieBook/movie',
    footer: { text: ENV_LABEL },
  };
}
