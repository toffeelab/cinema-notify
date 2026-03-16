# Cinema Notify

CGV 특별관(IMAX, 4DX, ScreenX, Dolby) 예매 오픈을 감지하여 Discord로 알림을 보내는 봇.

## Tech Stack
- NestJS (standalone app, no HTTP server)
- Playwright (Chromium) for web scraping
- @nestjs/schedule for cron-based polling
- @nestjs/config for env management

## Architecture
- `config/` - config.json + .env loading
- `cinema/` - Provider pattern (CgvProvider implements CinemaProvider interface)
- `detector/` - State comparison and change detection (JSON file-based)
- `notification/` - Discord webhook

## Commands
- `pnpm start:dev` - Development with watch mode
- `pnpm build` - Build
- `pnpm start:prod` - Production
- `docker compose up` - Run in Docker

## Configuration
- `.env` - DISCORD_WEBHOOK_URL (secrets only)
- `config.json` - Monitor targets (cinemas, hall types, movie filters)

## Extending
To add a new cinema chain (e.g., Lotte Cinema):
1. Create `src/cinema/providers/lotte.provider.ts` implementing `CinemaProvider`
2. Register in `cinema.module.ts` CINEMA_PROVIDERS factory
3. Add target with `"provider": "lotte"` in config.json
