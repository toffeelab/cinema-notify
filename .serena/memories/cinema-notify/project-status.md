# Cinema Notify - 프로젝트 현황

## 개요

CGV 특별관(IMAX, 4DX, ScreenX, Dolby) 예매 오픈을 감지하여 Discord로 알림을 보내는 봇.

## 기술 스택

- **프레임워크**: NestJS (standalone, no HTTP server) + 최소 health check HTTP 서버 (cloud 배포용)
- **크롤링**: Playwright + playwright-extra + puppeteer-extra-plugin-stealth
- **알림**: Discord Webhook + Discord.js Bot (슬래시 커맨드 `/상영중`)
- **스케줄링**: 재귀적 setTimeout + ±20% 랜덤 지터 (봇 감지 회피)
- **상태 관리**: JSON 파일 기반 (`data/state.json`)
- **배포**: Docker + Render (Web Service, Free tier)

## 핵심 아키텍처

- `src/config/` - config.json + .env 로딩 (MonitorConfigService)
- `src/cinema/` - Provider 패턴 (CgvProvider implements CinemaProvider)
- `src/cinema/providers/cgv.provider.ts` - Playwright로 CGV SPA 크롤링, API 응답 가로채기
- `src/detector/` - 상태 비교 및 변경 감지 (StateService + DetectorService)
- `src/notification/` - Discord webhook + Discord.js bot + embed 유틸
- `src/main.ts` - standalone app + health check 서버 (PORT env 또는 3333)

## 구현된 기능

1. **CGV 크롤링**: Playwright로 예매 페이지 조작, `searchMovScnInfo` API 응답 가로채기
2. **봇 감지 회피**: stealth 플러그인, UA 로테이션(5개), 요청 간격 ±20% 지터
3. **새 상영 알림**: 상태 비교 후 새로운 상영만 Discord webhook으로 알림
4. **서버 재기동 알림**: startup 시 skipNotify로 데이터 갱신 → 요약 알림만 발송
5. **슬래시 커맨드**: `/상영중` - 현재 추적 중인 상영 정보 조회 (Discord.js Bot)
6. **날짜+요일 표시**: `2026.03.09(월)` 형식
7. **영화/상영관 필터링**: config.json의 movieFilter, hallTypes로 필터링

## 현재 설정 (config.json)

- checkIntervalMin: 2 (2분 간격)
- checkDaysAhead: 7
- target: CGV 용산아이파크몰, 4DX만, F1 영화만 필터

## 배포 관련

- **Dockerfile**: `node:22-slim` 베이스 + `npx playwright install --with-deps chromium`
- **pnpm 버전**: 8.15.9 (Docker에서 `npm install -g pnpm@9.15.0`)
- **render.yaml**: web service, docker runtime, free plan
- **환경변수**: DISCORD_WEBHOOK_URL (필수), DISCORD_BOT_TOKEN/APPLICATION_ID/GUILD_ID (선택)
- **Health check**: main.ts에서 `createServer`로 최소 HTTP 서버 (EADDRINUSE 에러 핸들링 포함)

## 주의사항 / 고려사항

1. **메모리 제한**: Render Free tier 512MB RAM, Playwright+Chromium이 200-400MB 사용 → OOM 위험
2. **Render spin-down**: Free Web Service는 15분 무활동 시 sleep, 하지만 2분마다 크롤링하므로 내부적으로 활성 유지
3. **CGV API 403**: 직접 fetch 불가, 반드시 Playwright로 브라우저 세션 통해 접근
4. **날짜 버튼 DOM**: CSS 모듈 동적 클래스명 → `class*=` 부분 매칭 필수
5. **날짜 텍스트 형식**: "09" (패딩), "4.1" (월 넘어갈 때) 두 가지 형식 대응
6. **SchedulerRegistry 충돌**: 재귀 setTimeout에서 같은 이름 등록 시 deleteInterval 먼저 호출
7. **IP 기반 차단**: 아직 미대응, 실제 차단 발생 시 프록시 로테이션 고려
8. **config.json**: .gitignore에서 제거됨 (배포용), 비밀 정보 없음

## 테스트

- `pnpm test` - 단위 테스트 (Jest)
- cinema.service.spec.ts, discord.service.spec.ts, embed.util.spec.ts, discord-bot.service.spec.ts, detector 테스트 등
- skipNotify, movieFilter, hallType 필터, 날짜 요일 포맷 등 테스트 커버

## 파일 구조 요약

```
src/
├── main.ts                          # 엔트리 + health check
├── app.module.ts
├── cinema/
│   ├── cinema.module.ts
│   ├── cinema.service.ts            # 스케줄링 + checkAll
│   ├── cinema.service.spec.ts
│   ├── interfaces/
│   │   ├── cinema-provider.interface.ts
│   │   └── monitor-target.interface.ts
│   └── providers/
│       └── cgv.provider.ts          # Playwright 크롤링
├── config/
│   └── monitor-config.service.ts
├── detector/
│   ├── detector.module.ts
│   ├── detector.service.ts
│   └── state.service.ts
└── notification/
    ├── notification.module.ts
    ├── discord.service.ts           # Webhook 알림
    ├── discord.service.spec.ts
    ├── discord-bot.service.ts       # 슬래시 커맨드
    ├── discord-bot.service.spec.ts
    ├── embed.util.ts                # 공유 embed 빌더
    └── embed.util.spec.ts
```
