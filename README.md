# Cinema Notify

CGV 특별관(IMAX, 4DX, ScreenX, Dolby) 예매 오픈을 감지하여 Discord로 알림을 보내는 봇.

## Tech Stack

- **NestJS** - Standalone app (no HTTP server)
- **Playwright** (Chromium) - CGV 웹 스크래핑
- **Discord.js** - Discord 봇 알림
- **@nestjs/schedule** - Cron 기반 폴링
- **@nestjs/config** - 환경 변수 관리

## Architecture

```
src/
├── config/         # config.json + .env 로딩
├── cinema/         # Provider 패턴 (CgvProvider → CinemaProvider 인터페이스)
├── detector/       # 상태 비교 및 변경 감지 (JSON 파일 기반)
└── notification/   # Discord webhook 알림
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm

### Installation

```bash
pnpm install
```

### Configuration

1. `.env` 파일 생성:
```env
DISCORD_WEBHOOK_URL=your_webhook_url
```

2. `config.json`에서 모니터링 대상 설정:
```json
{
  "checkIntervalMin": 3,
  "checkDaysAhead": 7,
  "targets": [
    {
      "provider": "cgv",
      "cinemaCode": "0013",
      "cinemaName": "용산아이파크몰",
      "hallTypes": ["4DX"],
      "movieFilter": ["진격"]
    }
  ]
}
```

### Run

```bash
# development (watch mode)
pnpm start:dev

# production
pnpm build
pnpm start:prod

# docker
docker compose up
```

## Extending

새로운 영화관 체인 추가 (예: 롯데시네마):

1. `src/cinema/providers/lotte.provider.ts` 생성 (`CinemaProvider` 구현)
2. `cinema.module.ts`의 `CINEMA_PROVIDERS` factory에 등록
3. `config.json`에 `"provider": "lotte"` 타겟 추가
