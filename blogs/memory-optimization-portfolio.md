# Challenges & Troubleshooting: 512MB 환경 메모리 최적화

> **프로젝트:** CGV 특별관 예매 알림봇
> **환경:** Render (512MB RAM) · Docker · Node.js 22
> **기간:** 2026.03
> **키워드:** `Playwright` `Chromium` `Memory Optimization` `Docker Multi-stage` `NestJS`

---

## 📌 Summary

| 항목 | 내용 |
|------|------|
| **문제** | Render 512MB 환경에서 OOM crash 반복 발생 |
| **원인** | Chromium 브라우저 상시 상주 (200–300MB) + 리소스 과다 로딩 |
| **해결** | per-check 브라우저 생명주기 전환 외 5가지 최적화 적용 |
| **결과** | 유휴 메모리 350–420MB → 80–120MB (약 70% 절감), OOM crash 해소 |

---

## 🔴 Problem

Render 스타터 플랜(512MB)에 배포한 크롤링 봇이 수 시간 운영 후 **OOM(Out of Memory)으로 반복 crash**.

```
Error: JavaScript heap out of memory
FATAL ERROR: Reached heap limit Allocation failed
```

### 메모리 측정 방법

NestJS 서비스 내에서 `process.memoryUsage()`를 활용하여 크롤링 전후 메모리를 측정했다.

```typescript
// 크롤링 체크 전후로 메모리 로깅
private logMemory(label: string) {
  const mem = process.memoryUsage();
  this.logger.log(
    `[Memory:${label}] RSS=${(mem.rss / 1024 / 1024).toFixed(1)}MB ` +
    `Heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB/${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB ` +
    `External=${(mem.external / 1024 / 1024).toFixed(1)}MB`,
  );
}

async checkAll() {
  this.logMemory('before-check');
  // ... 크롤링 로직
  this.logMemory('after-check');
}
```

| 지표 | 의미 |
|------|------|
| `rss` | OS가 프로세스에 할당한 전체 메모리 (Chromium 자식 프로세스 제외) |
| `heapUsed` | V8 힙에서 실제 사용 중인 메모리 |
| `heapTotal` | V8이 할당받은 힙 크기 |
| `external` | V8 외부 C++ 객체가 사용하는 메모리 (Buffer 등) |

> **주의:** `process.memoryUsage()`의 `rss`는 Node.js 프로세스만 측정한다. Chromium은 별도 프로세스로 실행되므로, 전체 메모리는 Render 대시보드 또는 `docker stats`로 확인해야 한다.

### 측정 결과 (최적화 전)

```
[Memory:before-check] RSS=92.3MB Heap=41.2MB/65.8MB External=3.1MB
[Memory:after-check]  RSS=148.7MB Heap=58.4MB/82.1MB External=5.2MB
```

- Node.js 자체는 ~150MB이지만, **Chromium 자식 프로세스가 추가로 200–300MB** 사용
- `docker stats` 기준 컨테이너 전체: **350–480MB** (체크 중 피크)
- Render 대시보드에서 512MB 한도에 근접 → OOM kill 발생

### 메모리 구성 분석

| 구성 요소 | 사용량 | 측정 방법 |
|-----------|--------|-----------|
| Chromium (상시 실행) | 200–300MB | `docker stats` - Node.js RSS 차이 |
| Node.js + NestJS | 50–80MB | `process.memoryUsage().rss` (유휴 시) |
| discord.js WebSocket | 20–30MB | 봇 활성화 전후 RSS 차이 |
| DB pool, 캐시 등 | ~10MB | `heapUsed` 변화량 |
| **합계** | **~350–420MB** | `docker stats` 기준 |

---

## 🔍 Root Cause

### 핵심: 브라우저 생명주기 미스매치

- 3분 간격 체크에서 실제 브라우저 필요 시간은 **10–20초**
- 나머지 **160초 동안 200–300MB를 유휴 점유**
- 싱글턴 브라우저 패턴이 메모리 제한 환경에 부적합

```typescript
// 기존: 한 번 띄우면 앱 종료까지 유지
private browser: Browser | null = null;

private async ensureBrowser(): Promise<Browser> {
  if (!this.browser) {
    this.browser = await chromium.launch({ headless: true });
  }
  return this.browser;
}
```

### 부가 원인
- Chromium launch args 미설정 → 불필요한 GPU/확장/동기화 기능 활성화
- `waitUntil: 'networkidle'` → 광고·이미지까지 모든 리소스 로딩 대기
- `--max-old-space-size` 미설정 → V8 GC가 소극적으로 동작
- Docker 단일 스테이지 빌드 → devDependencies 런타임 포함

---

## ✅ Solution

### 1. Per-check 브라우저 생명주기

> 싱글턴 상주 → 매 체크마다 launch/close 전환

| | Before (싱글턴) | After (per-check) |
|---|---|---|
| 유휴 시 메모리 | 200–300MB 상시 | **0MB** |
| launch 오버헤드 | 없음 | 2–5초 |
| 장시간 안정성 | 메모리 누적 위험 | 매번 클린 상태 |

```typescript
// 개선: 체크 시에만 브라우저 사용
async fetchScreeningsForDates(...): Promise<ScreeningInfo[]> {
  const browser = await chromium.launch({
    headless: true,
    args: BROWSER_ARGS,
  });
  try {
    // ... scraping logic
  } finally {
    await browser.close(); // 반드시 종료
  }
}
```

### 2. Chromium launch args 최적화

```typescript
const BROWSER_ARGS = [
  '--disable-gpu',
  '--disable-dev-shm-usage',   // Docker 환경 필수
  '--disable-extensions',
  '--no-sandbox',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-first-run',
];
```

### 3. 불필요한 리소스 차단

```typescript
await context.route(
  '**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf}',
  (route) => route.abort(),
);
```
- API 응답 데이터만 필요, 영화 포스터·광고·폰트 로딩 불필요
- 네트워크 트래픽 + 메모리 동시 절감

### 4. 네트워크 전략 변경

```
networkidle (모든 리소스 로딩 완료 대기)
  ↓
domcontentloaded (DOM 파싱만 완료되면 진행)
```
- `page.on('response')`로 API 응답을 직접 캡처하므로 전체 로딩 불필요
- 리소스 차단과 시너지 효과

### 5. V8 메모리 제한 + Docker 멀티스테이지

```dockerfile
# 멀티스테이지: devDependencies 런타임 제거
FROM node:22-slim AS builder
# ... build

FROM node:22-slim
RUN pnpm install --frozen-lockfile --prod  # prod만
CMD ["node", "--max-old-space-size=400", "dist/main.js"]
```

---

## 📊 Impact

### 정량적 성과

| 지표 | Before | After | 개선 |
|------|--------|-------|------|
| 유휴 시 메모리 | ~350–420MB | ~80–120MB | **▼ 70%** |
| 체크 중 피크 메모리 | ~450–500MB | ~300–400MB | **▼ 20–30%** |
| OOM crash 빈도 | 수 시간마다 | **0건** | **해소** |
| 브라우저 점유 시간 | 100% (상시) | ~6% (10초/180초) | **▼ 94%** |

### 정성적 성과
- 512MB 무료 플랜에서 **안정적 24/7 운영** 가능
- 브라우저 매번 클린 시작으로 **Chromium 내부 메모리 누적 문제 원천 차단**
- 리소스 차단으로 **크롤링 속도 향상** (부수 효과)

---

## 💡 Lessons Learned

1. **리소스 생명주기는 사용 패턴에 맞춰야 한다**
   싱글턴은 고빈도 접근에 적합. 3분 간격 + 10초 사용이면 on-demand가 맞다.

2. **서버 환경은 기본값을 믿으면 안 된다**
   Chromium의 `--disable-dev-shm-usage`, Node.js의 `--max-old-space-size`는 Docker/제한 환경에서 필수.

3. **필요한 것만 로딩하라**
   `networkidle`은 개발 편의성이지, 프로덕션 최적값이 아니다.

---

## 🛠 Tech Stack

`NestJS` `Playwright` `playwright-extra` `Stealth Plugin` `Discord.js` `PostgreSQL` `Docker` `Render`
