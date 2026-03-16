import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Page, Response } from 'playwright';
import {
  CinemaProvider,
  ScreeningInfo,
  SpecialHallType,
} from '../interfaces/cinema-provider.interface';

chromium.use(StealthPlugin());

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

interface CgvScnItem {
  scnsNm: string;
  movkndDsplNm: string;
  prodNm: string;
  scnsrtTm: string;
  scnendTm: string;
  stcnt: string;
  frSeatCnt: string;
  scnYmd: string;
  siteNm: string;
}

interface CgvApiResponse {
  statusCode: number;
  data: CgvScnItem[];
}

const CGV_CINEMA_URL = 'https://cgv.co.kr/cnm/movieBook/cinema';
const CGV_API_PATTERN = 'searchMovScnInfo';

const HALL_TYPE_PATTERNS: [RegExp, SpecialHallType][] = [
  [/imax/i, 'IMAX'],
  [/4dx/i, '4DX'],
  [/screen\s?x/i, 'SCREENX'],
  [/dolby/i, 'DOLBY'],
];

const BROWSER_ARGS = [
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-extensions',
  '--no-sandbox',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-first-run',
];

@Injectable()
export class CgvProvider implements CinemaProvider {
  readonly name = 'cgv';
  private readonly logger = new Logger(CgvProvider.name);

  async dispose() {
    // Browser is now created and closed per-check, nothing to dispose
  }

  private classifyHall(scnsNm: string, movkndDsplNm: string): SpecialHallType {
    const combined = `${scnsNm} ${movkndDsplNm}`;
    for (const [pattern, type] of HALL_TYPE_PATTERNS) {
      if (pattern.test(combined)) {
        return type;
      }
    }
    return 'STANDARD';
  }

  private formatTime(tm: string): string {
    return `${tm.slice(0, 2)}:${tm.slice(2, 4)}`;
  }

  /** "호퍼스(자막, 4DX 2D)" -> "호퍼스" */
  private cleanMovieTitle(raw: string): string {
    return raw.replace(/\([^)]*\)\s*$/, '').trim();
  }

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
      await context.route(
        '**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf}',
        (route) => route.abort(),
      );
      const page = await context.newPage();

      try {
        return await this.fetchAllDates(page, cinemaName, dates);
      } catch (error) {
        this.logger.error(
          `Failed to fetch screenings for ${cinemaName}: ${error}`,
        );
        return [];
      }
    } finally {
      await browser.close();
    }
  }

  private async findTheaterButton(page: Page, cinemaName: string) {
    // 페이지 로드 시 극장 선택 모달 다이얼로그가 자동으로 열림
    // role="dialog"가 여러 개 존재하므로 visible(active) 상태인 것을 선택
    const dialog = page.locator('[role="dialog"].active');
    try {
      await dialog.waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      this.logger.debug('Theater selection dialog not found');
      return null;
    }

    // 다이얼로그가 열려도 내부 극장 목록 렌더링이 지연될 수 있으므로
    // 극장 버튼이 나타날 때까지 대기
    const theaterBtn = dialog.getByRole('button', {
      name: cinemaName,
      exact: true,
    });
    try {
      await theaterBtn.first().waitFor({ state: 'visible', timeout: 10000 });
      return theaterBtn.first();
    } catch {
      this.logger.debug(`Theater "${cinemaName}" not found in dialog`);
      return null;
    }
  }

  private async fetchAllDates(
    page: Page,
    cinemaName: string,
    dates: string[],
  ): Promise<ScreeningInfo[]> {
    // 1. Navigate and select theater (once)
    this.logger.debug(`Navigating to ${CGV_CINEMA_URL}`);
    await page.goto(CGV_CINEMA_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // 2. Select theater
    this.logger.debug(`Selecting theater: ${cinemaName}`);
    const theaterBtn = await this.findTheaterButton(page, cinemaName);
    if (!theaterBtn) {
      this.logger.warn(`Theater "${cinemaName}" not found`);
      return [];
    }

    // Set up a collector for all API responses
    const responses = new Map<string, CgvApiResponse>();

    page.on('response', async (response: Response) => {
      const url = response.url();
      if (url.includes(CGV_API_PATTERN)) {
        try {
          const json = (await response.json()) as CgvApiResponse;
          // Extract date from URL
          const dateMatch = url.match(/scnYmd=(\d{8})/);
          if (dateMatch) {
            responses.set(dateMatch[1], json);
          }
        } catch {
          // ignore parse errors
        }
      }
    });

    await theaterBtn.click();
    // Wait for initial API response after theater selection
    try {
      await page.waitForResponse((r) => r.url().includes(CGV_API_PATTERN), {
        timeout: 15000,
      });
      // Small extra wait for UI to settle
      await page.waitForTimeout(1000);
    } catch {
      this.logger.debug('Timeout waiting for initial API response');
      await page.waitForTimeout(3000);
    }

    // 3. For each additional date, click the date button
    // Date buttons are structured as:
    //   <button class="dayScroll_scrollItem__...">
    //     <span class="dayScroll_txt__...">화</span>
    //     <span class="dayScroll_number__...">10</span>
    //   </button>
    // The number span contains padded day ("09") or "M.D" for month crossover ("4.1")
    const dateButtons = page.locator('button[class*="dayScroll_scrollItem"]');

    for (const date of dates) {
      if (responses.has(date)) continue; // Already captured from initial load

      const month = parseInt(date.slice(4, 6), 10);
      const day = parseInt(date.slice(6, 8), 10);
      const dayPadded = date.slice(6, 8);

      const count = await dateButtons.count();
      let clicked = false;

      for (let i = 0; i < count; i++) {
        const btn = dateButtons.nth(i);
        const numberSpan = btn.locator('span[class*="dayScroll_number"]');
        const numberText = (await numberSpan.textContent())?.trim() ?? '';

        // Match padded day ("09", "10") or month.day format ("4.1")
        const isMatch =
          numberText === dayPadded || numberText === `${month}.${day}`;

        if (isMatch) {
          const btnClass = (await btn.getAttribute('class')) ?? '';
          const isDisabled = btnClass.includes('disabled');
          if (!isDisabled) {
            this.logger.debug(`Clicking date: ${numberText} for ${date}`);
            await btn.click();
            // Wait for API response for this date
            try {
              await page.waitForResponse(
                (r) =>
                  r.url().includes(CGV_API_PATTERN) &&
                  r.url().includes(`scnYmd=${date}`),
                { timeout: 20000 },
              );
            } catch {
              // Timeout waiting for response - may already have it
              this.logger.debug(`Timeout waiting for API response for ${date}`);
            }
            clicked = true;
          }
          break;
        }
      }

      if (!clicked) {
        this.logger.debug(`Date button for ${date} not found or disabled`);
      }
    }

    // 4. Parse all collected responses
    const allScreenings: ScreeningInfo[] = [];
    for (const [date, response] of responses) {
      if (dates.includes(date) && response.statusCode === 0) {
        const screenings = this.parseApiResponse(response, date);
        allScreenings.push(...screenings);
      }
    }

    this.logger.log(
      `${cinemaName}: fetched ${allScreenings.length} special screening(s) across ${responses.size} date(s)`,
    );
    return allScreenings;
  }

  private parseApiResponse(
    response: CgvApiResponse,
    date: string,
  ): ScreeningInfo[] {
    const items = response.data;
    if (!items || items.length === 0) return [];

    const groups = new Map<string, ScreeningInfo>();

    for (const item of items) {
      const hallType = this.classifyHall(item.scnsNm, item.movkndDsplNm);
      if (hallType === 'STANDARD') continue;

      const movieTitle = this.cleanMovieTitle(item.prodNm);
      const key = `${movieTitle}||${item.scnsNm}||${date}`;
      const existing = groups.get(key);

      if (existing) {
        existing.times.push(this.formatTime(item.scnsrtTm));
      } else {
        groups.set(key, {
          movieTitle,
          hallName: item.scnsNm,
          hallType,
          date,
          times: [this.formatTime(item.scnsrtTm)],
          cinemaName: item.siteNm || 'CGV',
        });
      }
    }

    return Array.from(groups.values());
  }
}
