# CGV 특별관 크롤링 삽질기 — Playwright로 SPA를 뚫으며 배운 것들

## 들어가며

CGV IMAX, 4DX, SCREENX, DOLBY 같은 특별관 예매가 오픈되면 Discord로 알려주는 봇을 만들었다. 단순해 보이지만, 실제로 CGV 웹사이트를 크롤링하는 과정에서 예상치 못한 문제들을 꽤 많이 만났다. 이 글은 그 시행착오의 기록이다.

---

## 1. 왜 Playwright인가?

처음에는 단순히 CGV API를 `fetch`로 직접 호출하려 했다.

```bash
curl "https://cgv.co.kr/cnm/api/v2/searchMovScnInfo?siteNo=0013&scnYmd=20260309"
# → 403 Forbidden
```

헤더를 아무리 맞춰도 403이었다. CGV는 서버 사이드에서 세션 쿠키나 토큰 기반 검증을 하고 있었고, 단순 HTTP 요청으로는 뚫을 수 없었다. 결국 **실제 브라우저를 띄워서 페이지를 조작하는 수밖에 없었다.**

Playwright를 선택한 이유:
- Chromium, Firefox, WebKit 모두 지원
- `page.on('response')` 로 네트워크 응답을 가로챌 수 있음
- TypeScript 타입 지원이 좋음
- NestJS와의 생명주기 통합이 자연스러움

---

## 2. "API를 직접 호출하지 말고, 브라우저가 호출하게 하라"

핵심 아이디어는 이거였다. **Playwright로 페이지를 조작하되, 데이터는 DOM이 아니라 API 응답에서 가져온다.**

CGV 예매 페이지는 React 기반 SPA로, 날짜나 극장을 선택하면 내부적으로 `searchMovScnInfo` API를 호출한다. 이 응답을 가로채면 DOM 파싱 없이 깔끔한 JSON을 얻을 수 있다.

```typescript
const responses = new Map<string, CgvApiResponse>();

page.on('response', async (response) => {
  if (response.url().includes('searchMovScnInfo')) {
    const json = await response.json();
    const dateMatch = response.url().match(/scnYmd=(\d{8})/);
    if (dateMatch) {
      responses.set(dateMatch[1], json);
    }
  }
});
```

이 패턴의 장점:
- DOM 구조가 바뀌어도 API 스키마만 유지되면 동작
- HTML 파싱의 불안정함을 피할 수 있음
- 정확히 서버가 내려주는 데이터를 그대로 사용

---

## 3. 날짜 버튼 클릭 — 가장 큰 삽질

### 문제: 오늘 날짜만 수집됨

`checkDaysAhead: 7`로 설정했는데, `state.json`에는 오늘 데이터만 저장되고 있었다. 7일치를 조회해야 하는데 1일치만 가져오는 치명적인 버그였다.

### 원인 1: 정규식 매칭 실패

처음 구현에서는 날짜 버튼의 `textContent`를 정규식으로 매칭했다.

```typescript
// ❌ 첫 번째 시도 — 실패
const regex = new RegExp(`^[월화수목금토일오늘]+\\s*${dayNum}$`);
```

`dayNum`이 `"9"`인데, CGV 버튼의 실제 텍스트는 `"오늘09"`(패딩된 숫자, 공백 없음)였다. 정규식이 매칭되지 않아 클릭 자체가 안 되고 있었다.

### 원인 2: 버튼 DOM 구조를 잘못 파악함

CGV 날짜 버튼의 실제 HTML 구조:

```html
<button class="dayScroll_scrollItem__abc123">
  <span class="dayScroll_txt__def456">화</span>
  <span class="dayScroll_number__ghi789">10</span>
</button>
```

요일 텍스트와 숫자가 **별도의 `<span>`** 에 들어있었다. `textContent`로 전체를 가져오면 `"화10"`이 되어 파싱이 꼬인다.

### 해결: 숫자 span을 직접 타겟팅

```typescript
// ✅ 최종 구현
const dateButtons = page.locator('button[class*="dayScroll_scrollItem"]');

for (let i = 0; i < await dateButtons.count(); i++) {
  const btn = dateButtons.nth(i);
  const numberSpan = btn.locator('span[class*="dayScroll_number"]');
  const numberText = (await numberSpan.textContent())?.trim() ?? '';

  // "09" 또는 월 넘어갈 때 "4.1" 형식
  const isMatch = numberText === dayPadded || numberText === `${month}.${day}`;

  if (isMatch) {
    const btnClass = (await btn.getAttribute('class')) ?? '';
    if (!btnClass.includes('disabled')) {
      await btn.click();
    }
  }
}
```

**교훈: SPA에서 DOM 구조를 추측하지 말 것.** DevTools로 실제 구조를 반드시 확인해야 한다. 특히 React/Next.js 앱은 CSS 모듈이나 동적 클래스명을 사용하므로, `class*=` 부분 매칭이 필수다.

### 원인 3: 비동기 응답 대기

```typescript
// ❌ 안 좋은 패턴 — 고정 대기
await page.waitForTimeout(3000);

// ✅ 좋은 패턴 — 실제 응답 대기
await page.waitForResponse(
  (r) => r.url().includes('searchMovScnInfo') && r.url().includes(`scnYmd=${date}`),
  { timeout: 10000 },
);
```

`waitForTimeout`은 네트워크가 느리면 부족하고, 빠르면 낭비다. `waitForResponse`로 **정확히 원하는 API 응답이 올 때까지** 기다리는 것이 안정적이다.

---

## 4. 로딩 오버레이와의 전쟁

CGV 페이지에는 극장 선택 시 전체 화면을 덮는 로딩 오버레이(`loading_pageContainer`)가 있다. 이게 Playwright의 클릭을 가로막았다.

```typescript
// ❌ 로딩 오버레이가 덮고 있어서 클릭 실패
await theaterBtn.click();

// ✅ force 옵션으로 오버레이 무시
await theaterBtn.click({ force: true });
```

`force: true`는 가시성 체크를 건너뛰고 강제 클릭한다. 남용하면 안 되지만, 로딩 오버레이처럼 일시적인 차단 요소에는 유용하다.

---

## 5. Headless 브라우저 감지 회피

Playwright의 headless 모드는 여러 방법으로 감지될 수 있다:

| 감지 포인트 | 설명 |
|------------|------|
| `navigator.webdriver` | Playwright는 `true`로 설정 |
| `navigator.plugins` | headless에서는 비어있음 |
| WebGL renderer | 일반 브라우저와 다른 문자열 |
| `window.chrome` 객체 | headless에서 부재 |
| 요청 패턴 | 주기적 접속은 봇 행위 |

### 대응: playwright-extra + stealth 플러그인

```typescript
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());
```

`puppeteer-extra-plugin-stealth`는 원래 Puppeteer용이지만, `playwright-extra`를 통해 Playwright에서도 사용 가능하다. `navigator.webdriver` 은닉, WebGL 위장, 플러그인 목록 주입 등을 자동으로 처리한다.

### User-Agent 로테이션

```typescript
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/145.0.0.0 ...',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/145.0.0.0 ...',
  'Mozilla/5.0 (X11; Linux x86_64) ... Chrome/144.0.0.0 ...',
  // ...
];

const context = await browser.newContext({
  userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
});
```

매 요청마다 OS와 Chrome 버전이 다른 UA를 랜덤으로 사용한다.

### 요청 간격 랜덤화

```typescript
// ❌ 정확히 2분마다 — 봇 패턴
setInterval(() => checkAll(), 2 * 60 * 1000);

// ✅ 2분 ±20% 랜덤 — 사람처럼
const jitter = intervalMs * (0.8 + Math.random() * 0.4);
setTimeout(() => { checkAll().then(scheduleNext); }, jitter);
```

고정 간격은 자동화의 가장 명백한 지문이다. ±20% 랜덤 지터만 추가해도 패턴 감지를 상당히 어렵게 만든다.

---

## 6. 아키텍처: Provider 패턴

크롤링 로직을 `CinemaProvider` 인터페이스로 추상화했다.

```typescript
interface CinemaProvider {
  name: string;
  fetchScreeningsForDates(
    cinemaCode: string,
    cinemaName: string,
    dates: string[],
  ): Promise<ScreeningInfo[]>;
  dispose(): Promise<void>;
}
```

CGV, 롯데시네마, 메가박스 등 어떤 체인이든 이 인터페이스만 구현하면 된다. `CinemaService`는 프로바이더가 어떻게 데이터를 가져오는지 알 필요 없이, config에 명시된 `provider` 이름으로 매칭해서 사용한다.

```json
{
  "targets": [
    {
      "provider": "cgv",
      "cinemaCode": "0013",
      "cinemaName": "용산아이파크몰",
      "hallTypes": ["IMAX", "4DX", "SCREENX", "DOLBY"]
    }
  ]
}
```

---

## 7. 리소스 관리

Playwright 브라우저는 메모리를 많이 먹는다. NestJS 생명주기와 통합하여 안전하게 관리했다.

```typescript
@Injectable()
export class CgvProvider implements CinemaProvider, OnModuleDestroy {
  private browser: Browser | null = null;

  // 브라우저를 재사용 (lazy init)
  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  // 매 요청마다 새로운 context (쿠키/세션 격리)
  async fetchScreeningsForDates(...) {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({ userAgent: randomUserAgent() });
    try {
      return await this.fetchAllDates(page, cinemaName, dates);
    } finally {
      await context.close(); // context는 반드시 정리
    }
  }

  // 앱 종료 시 브라우저도 종료
  async onModuleDestroy() {
    await this.browser?.close();
  }
}
```

핵심은 **브라우저는 재사용하되, context는 매번 새로 만드는 것**이다. 이렇게 하면 브라우저 프로세스 오버헤드는 줄이면서, 쿠키나 캐시가 요청 간에 공유되는 것을 방지할 수 있다.

---

## 8. 데이터 파싱 전략

CGV API 응답에서 특별관 상영 정보를 추출하는 과정도 간단하지 않았다.

```typescript
// API 응답 한 건
{
  scnsNm: "SCREENX관 (리클라이너) with PRIVATE BOX",
  movkndDsplNm: "2D(자막)",
  prodNm: "28년 후- 빼의 사원(자막, SCREENX 2D)",
  scnsrtTm: "1305",
  scnYmd: "20260310",
  siteNm: "CGV 용산아이파크몰"
}
```

### 상영관 타입 분류

상영관 이름(`scnsNm`)과 영화 종류(`movkndDsplNm`)를 합쳐서 정규식으로 분류한다.

```typescript
const HALL_TYPE_PATTERNS: [RegExp, SpecialHallType][] = [
  [/imax/i, 'IMAX'],
  [/4dx/i, '4DX'],
  [/screen\s?x/i, 'SCREENX'],
  [/dolby/i, 'DOLBY'],
];
```

### 영화 제목 정리

```typescript
"28년 후- 빼의 사원(자막, SCREENX 2D)" → "28년 후- 빼의 사원"
```

괄호 안의 부가 정보를 제거해서 깔끔한 제목만 남긴다.

### 같은 영화 + 같은 관 + 같은 날짜 → 시간만 합침

```typescript
const key = `${movieTitle}||${hallName}||${date}`;
// 같은 키면 times 배열에 추가
existing.times.push(formatTime(item.scnsrtTm));
```

이렇게 하면 알림 한 건에 해당 상영의 모든 시간이 포함된다.

---

## 마무리

이 프로젝트에서 가장 크게 느낀 점은, **크롤링은 코드보다 대상 사이트를 이해하는 시간이 더 오래 걸린다**는 것이다.

- API가 403을 반환하는지, 어떤 인증을 요구하는지
- DOM 구조가 실제로 어떻게 생겼는지 (추측 금지)
- 로딩 상태, 오버레이, 비동기 렌더링이 언제 완료되는지
- 날짜 버튼의 텍스트 형식이 "9"인지 "09"인지 "3.9"인지

이런 디테일 하나하나가 버그의 원인이 된다. DevTools를 열고, 실제 DOM을 확인하고, 네트워크 탭에서 API 요청을 분석하는 과정이 결국 가장 중요한 작업이었다.

### 기술 스택 요약

| 역할 | 기술 |
|------|------|
| 프레임워크 | NestJS (standalone, no HTTP server) |
| 크롤링 | Playwright + playwright-extra + stealth |
| 알림 | Discord Webhook + Discord.js Bot |
| 스케줄링 | @nestjs/schedule + 랜덤 지터 |
| 상태 관리 | JSON 파일 기반 (data/state.json) |
| 배포 | Docker + docker-compose |
