# 512MB 서버에서 Playwright 살려내기 — Render 배포 메모리 최적화 삽질기

## 들어가며

[이전 글](./playwright-crawling-lessons.md)에서 CGV 특별관 알림봇을 Playwright로 만든 과정을 다뤘다. 로컬에서는 잘 돌아가던 봇이, Render에 배포하자 **OOM(Out of Memory) crash**로 반복적으로 죽기 시작했다. Render 스타터 플랜의 메모리는 512MB. Chromium 브라우저 하나가 얼마나 먹는지 체감하게 된 경험을 기록한다.

---

## 1. 문제 진단: 메모리를 누가 먹고 있나?

Render 대시보드에서 메모리 사용량을 확인해보면, 앱이 시작되자마자 300MB 이상을 차지하고 있었다. 3분마다 크롤링 체크가 돌 때마다 메모리가 조금씩 올라가다가, 결국 512MB를 넘기고 OOM으로 프로세스가 kill된다.

| 구성 요소 | 예상 메모리 사용량 |
|-----------|-------------------|
| Chromium 브라우저 (상시 실행) | 200–300MB |
| Node.js + NestJS 런타임 | 50–80MB |
| discord.js WebSocket | 20–30MB |
| 나머지 (DB pool, 캐시 등) | ~10MB |
| **합계** | **~350–420MB** |

얼핏 보면 512MB 안에 들어가는 것 같지만, Chromium은 페이지를 조작할 때마다 추가 메모리를 사용한다. 날짜 버튼을 클릭하고, API 응답을 파싱하고, DOM을 렌더링하는 과정에서 피크 메모리가 512MB를 쉽게 넘긴다.

**핵심 문제: Chromium 브라우저가 3분 간격 체크 사이에도 계속 떠 있다.**

---

## 2. 핵심 결정: 브라우저를 켜둘 것인가, 끌 것인가?

기존 코드는 브라우저를 싱글턴으로 유지하고 있었다.

```typescript
// ❌ 기존: 싱글턴 브라우저 — 한 번 띄우면 앱 종료까지 유지
private browser: Browser | null = null;

private async ensureBrowser(): Promise<Browser> {
  if (!this.browser) {
    this.browser = await chromium.launch({ headless: true });
  }
  return this.browser;
}
```

이 방식의 장점은 매 체크마다 브라우저를 새로 띄우는 오버헤드가 없다는 것이다. 하지만 512MB 환경에서는 치명적이다.

### 싱글턴 vs 매번 생성/종료 비교

| | 싱글턴 (기존) | 매번 생성/종료 |
|---|---|---|
| 유휴 시 메모리 | 200–300MB **상시 점유** | 0MB (완전 해제) |
| 체크 시 오버헤드 | 없음 | launch 2–5초 |
| 장시간 안정성 | Chromium 내부 메모리 누적 | 매번 깨끗한 상태 |
| 512MB 적합도 | ❌ 남은 200MB로 운영 | ✅ 유휴 시 여유 확보 |

3분 간격으로 체크한다면, 실제 브라우저가 필요한 시간은 10–20초 정도다. **나머지 160초 동안 200–300MB를 공짜로 먹고 있는 셈이다.**

launch 오버헤드 2–5초는 3분 간격에서 무시할 수 있는 수준이고, 오히려 매번 깨끗한 브라우저 인스턴스로 시작하므로 Chromium 내부의 메모리 누적 문제도 해결된다.

```typescript
// ✅ 개선: 매 체크마다 브라우저 생성 → 종료
async fetchScreeningsForDates(
  _cinemaCode: string,
  cinemaName: string,
  dates: string[],
): Promise<ScreeningInfo[]> {
  const browser = await chromium.launch({
    headless: true,
    args: BROWSER_ARGS,
  });

  try {
    const context = await browser.newContext({
      userAgent: randomUserAgent(),
    });
    const page = await context.newPage();
    return await this.fetchAllDates(page, cinemaName, dates);
  } finally {
    await browser.close(); // 체크 끝나면 브라우저 완전 종료
  }
}
```

`finally` 블록에서 `browser.close()`를 호출하므로, 에러가 발생하더라도 브라우저는 반드시 종료된다. 이전에는 `context.close()`만 했는데, 이제 브라우저 프로세스 자체를 종료하므로 OS에 메모리가 완전히 반환된다.

---

## 3. Chromium 다이어트: launch args 최적화

브라우저를 띄우더라도, 불필요한 기능을 끄면 메모리 사용량을 줄일 수 있다.

```typescript
const BROWSER_ARGS = [
  '--disable-gpu',                    // GPU 렌더링 비활성화 (headless에서 불필요)
  '--disable-dev-shm-usage',          // /dev/shm 대신 /tmp 사용 (Docker 환경 필수)
  '--disable-extensions',             // 확장 프로그램 비활성화
  '--no-sandbox',                     // 샌드박스 비활성화 (Docker 환경)
  '--disable-background-networking',  // 백그라운드 네트워크 요청 차단
  '--disable-default-apps',           // 기본 앱 비활성화
  '--disable-sync',                   // 동기화 비활성화
  '--metrics-recording-only',         // 텔레메트리 최소화
  '--no-first-run',                   // 첫 실행 마법사 건너뛰기
];
```

특히 `--disable-dev-shm-usage`는 Docker 환경에서 중요하다. 기본적으로 Chromium은 `/dev/shm`(공유 메모리)을 사용하는데, Docker 컨테이너에서는 이 영역이 작아서 크래시의 원인이 된다.

### 불필요한 리소스 차단

API 응답 데이터만 필요하고 화면을 렌더링할 필요가 없으므로, 이미지·폰트·CSS 같은 리소스 다운로드를 차단한다.

```typescript
const context = await browser.newContext({ userAgent: randomUserAgent() });

// 이미지, 폰트, CSS 등 불필요한 리소스 차단
await context.route(
  '**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf}',
  (route) => route.abort(),
);
```

이렇게 하면 네트워크 트래픽과 메모리 사용량이 동시에 줄어든다. CGV 페이지에는 영화 포스터, 광고 배너 등 이미지가 많은데, 이걸 전부 받지 않으면 체감 효과가 상당하다.

---

## 4. 네트워크 전략 변경: networkidle의 함정

기존 코드에서는 페이지 로딩 시 `waitUntil: 'networkidle'`을 사용하고 있었다.

```typescript
// ❌ 기존: 모든 네트워크 요청이 끝날 때까지 대기
await page.goto(CGV_CINEMA_URL, {
  waitUntil: 'networkidle',
  timeout: 20000,
});
```

`networkidle`은 500ms 동안 2개 이하의 네트워크 연결만 있을 때 완료로 판정한다. 즉, **광고 트래커, 분석 스크립트, 이미지 로딩까지 전부 끝나야** 다음 단계로 넘어간다.

하지만 우리는 이미 `page.on('response')`로 API 응답을 직접 캡처하고 있다. 페이지의 모든 리소스가 로드될 필요가 없다.

```typescript
// ✅ 개선: DOM만 파싱되면 충분
await page.goto(CGV_CINEMA_URL, {
  waitUntil: 'domcontentloaded',
  timeout: 20000,
});
```

`domcontentloaded`는 HTML이 파싱되고 DOM 트리가 만들어지면 즉시 완료된다. 이미지나 스타일시트 로딩을 기다리지 않으므로:
- **더 빠르게** 다음 단계로 넘어갈 수 있고
- **불필요한 리소스 로딩으로 인한 메모리 사용을 피할 수 있다**

앞서 3번에서 리소스 차단과 함께 사용하면 시너지가 극대화된다.

---

## 5. Node.js V8 메모리 제한의 효과

Node.js의 V8 엔진은 기본적으로 시스템 메모리에 따라 힙 크기를 자동으로 조절한다. 512MB 환경에서 이걸 명시적으로 제한하지 않으면, V8이 메모리를 넉넉하게 잡으려다가 OS의 OOM killer에 의해 프로세스가 죽을 수 있다.

```bash
# Dockerfile CMD
node --max-old-space-size=400 dist/main.js
```

`--max-old-space-size=400`으로 V8 힙을 400MB로 제한하면:
- GC(Garbage Collection)가 더 자주, 더 적극적으로 실행된다
- 메모리 사용량이 400MB에 가까워지면 V8이 알아서 정리한다
- OS의 OOM killer가 작동하기 전에 V8 레벨에서 메모리를 관리할 수 있다

왜 400MB인가? 512MB 중 Chromium 프로세스(별도 프로세스)와 OS 오버헤드를 고려하면, Node.js 자체에 할당할 수 있는 메모리는 400MB 정도가 적절하다. 브라우저를 매번 종료하는 방식이므로, Node.js와 Chromium이 동시에 최대 메모리를 사용하는 구간은 체크 중 10–20초뿐이다.

---

## 6. Docker 최적화: 멀티스테이지 빌드

기존 Dockerfile은 단일 스테이지로, devDependencies(TypeScript, ESLint, Jest 등)가 런타임 이미지에 그대로 포함되어 있었다.

```dockerfile
# ❌ 기존: 단일 스테이지 — devDependencies 포함
FROM node:22-slim
WORKDIR /app
RUN npm install -g pnpm@9.15.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false
RUN npx playwright install --with-deps chromium
COPY . .
RUN pnpm build
CMD ["node", "dist/main.js"]
```

멀티스테이지 빌드로 분리하면, 런타임에는 production dependencies만 포함된다.

```dockerfile
# ✅ 개선: 멀티스테이지 빌드
# Build stage
FROM node:22-slim AS builder
WORKDIR /app
RUN npm install -g pnpm@9.15.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Runtime stage
FROM node:22-slim
WORKDIR /app
RUN npm install -g pnpm@9.15.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
RUN npx playwright install --with-deps chromium
COPY --from=builder /app/dist ./dist
COPY config.json ./
CMD ["node", "--max-old-space-size=400", "dist/main.js"]
```

이 변경은 **디스크 크기**에 주로 영향을 미치지만, node_modules가 작아지면 `require` 시 메모리에 로딩되는 모듈의 양도 줄어든다. TypeScript 컴파일러, Jest, ESLint 같은 무거운 devDependencies가 런타임에 존재하지 않는다.

---

## 마무리

### 최적화 전후 비교

| 항목 | Before | After |
|------|--------|-------|
| 유휴 시 메모리 | ~350–420MB | ~80–120MB |
| 체크 중 피크 메모리 | ~450–500MB | ~300–400MB |
| 브라우저 생명주기 | 앱 시작~종료 | 체크 시작~종료 (10–20초) |
| 페이지 로딩 전략 | networkidle (모든 리소스) | domcontentloaded (DOM만) |
| 리소스 다운로드 | 전체 (이미지/폰트 포함) | API 응답만 |
| V8 메모리 제한 | 미설정 (자동) | 400MB |
| Docker devDependencies | 포함 | 제거 |

### 교훈

1. **512MB에서 Chromium 상주는 자살행위다.** 브라우저가 필요한 시간이 전체 사이클의 10% 미만이라면, 매번 띄우고 끄는 게 맞다.

2. **launch args를 반드시 설정하라.** 특히 `--disable-dev-shm-usage`는 Docker 환경에서 필수다. 기본값이 서버 환경에 적합하지 않다.

3. **필요한 것만 로딩하라.** `networkidle`은 편하지만 비용이 크다. 데이터만 필요하면 `domcontentloaded`로 충분하고, 이미지/폰트 차단은 거의 공짜로 메모리를 아끼는 방법이다.

4. **Node.js 메모리 제한을 명시하라.** V8의 자동 메모리 관리를 믿지 말고, 환경에 맞게 `--max-old-space-size`를 설정하라. GC가 더 적극적으로 작동한다.

5. **멀티스테이지 빌드는 기본이다.** devDependencies를 런타임에 끌고 다닐 이유가 없다.

### 기술 스택 요약

| 역할 | 기술 |
|------|------|
| 프레임워크 | NestJS (standalone, no HTTP server) |
| 크롤링 | Playwright + playwright-extra + stealth |
| 알림 | Discord Webhook + Discord.js Bot |
| 상태 관리 | PostgreSQL + 메모리 캐시 |
| 배포 | Docker (멀티스테이지) + Render |
| 메모리 최적화 | per-check browser lifecycle, launch args, resource blocking |
