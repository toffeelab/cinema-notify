/**
 * CgvProvider E2E test — 실제 Chromium 브라우저로 CGV 사이트를 크롤링.
 * 네트워크 상태와 CGV 사이트 가용성에 의존하므로 CI에서는 건너뛸 수 있다.
 *
 *   pnpm test:e2e -- --testPathPattern=cgv-provider
 */
import { CgvProvider } from '../src/cinema/providers/cgv.provider';

// 실제 브라우저 + 네트워크 사용으로 타임아웃 여유 확보
jest.setTimeout(120_000);

describe('CgvProvider E2E (real browser)', () => {
  let provider: CgvProvider;

  beforeAll(() => {
    provider = new CgvProvider();
  });

  afterAll(async () => {
    await provider.dispose();
  });

  /** KST 기준 오늘 날짜를 YYYYMMDD 형식으로 반환 */
  function todayKST(): string {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kst.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  it('should fetch screenings from CGV 용산아이파크몰 for today', async () => {
    const today = todayKST();
    const screenings = await provider.fetchScreeningsForDates(
      '0013',
      '용산아이파크몰',
      [today],
    );

    // 결과는 빈 배열일 수 있지만 (특별관 상영이 없는 날) 에러 없이 반환되어야 함
    expect(Array.isArray(screenings)).toBe(true);

    // 상영 정보가 있으면 구조 검증
    for (const s of screenings) {
      expect(s).toHaveProperty('movieTitle');
      expect(s).toHaveProperty('hallName');
      expect(s).toHaveProperty('hallType');
      expect(s).toHaveProperty('date', today);
      expect(s).toHaveProperty('times');
      expect(s).toHaveProperty('cinemaName');
      expect(Array.isArray(s.times)).toBe(true);
      expect(s.times.length).toBeGreaterThan(0);
      expect(['IMAX', '4DX', 'SCREENX', 'DOLBY']).toContain(s.hallType);
      // 시간 형식: HH:MM
      for (const t of s.times) {
        expect(t).toMatch(/^\d{2}:\d{2}$/);
      }
    }

    console.log(
      `[E2E] 용산아이파크몰 ${today}: ${screenings.length} special screening(s)`,
    );
    if (screenings.length > 0) {
      console.table(
        screenings.map((s) => ({
          movie: s.movieTitle,
          hall: s.hallName,
          type: s.hallType,
          times: s.times.join(', '),
        })),
      );
    }
  });

  it('should fetch screenings for multiple dates', async () => {
    const today = todayKST();
    // 오늘 + 내일
    const todayDate = new Date();
    todayDate.setTime(todayDate.getTime() + 9 * 60 * 60 * 1000);
    const tomorrow = new Date(todayDate);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = `${tomorrow.getUTCFullYear()}${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}${String(tomorrow.getUTCDate()).padStart(2, '0')}`;

    const screenings = await provider.fetchScreeningsForDates(
      '0013',
      '용산아이파크몰',
      [today, tomorrowStr],
    );

    expect(Array.isArray(screenings)).toBe(true);

    // 날짜가 요청한 범위 내인지 확인
    for (const s of screenings) {
      expect([today, tomorrowStr]).toContain(s.date);
    }

    console.log(
      `[E2E] 용산아이파크몰 ${today}~${tomorrowStr}: ${screenings.length} special screening(s)`,
    );
  });

  it('should return empty array for non-existent cinema', async () => {
    const today = todayKST();
    const screenings = await provider.fetchScreeningsForDates(
      '9999',
      '존재하지않는극장',
      [today],
    );

    expect(screenings).toEqual([]);
  });

  it('should properly close browser after each call (memory check)', async () => {
    const memBefore = process.memoryUsage();

    const today = todayKST();
    await provider.fetchScreeningsForDates('0013', '용산아이파크몰', [today]);

    // 브라우저 종료 후 잠시 대기하여 GC 유도
    if (global.gc) global.gc();
    await new Promise((r) => setTimeout(r, 1000));

    const memAfter = process.memoryUsage();
    const rssDiffMB = (memAfter.rss - memBefore.rss) / 1024 / 1024;

    console.log(
      `[E2E Memory] RSS before=${(memBefore.rss / 1024 / 1024).toFixed(1)}MB ` +
        `after=${(memAfter.rss / 1024 / 1024).toFixed(1)}MB ` +
        `diff=${rssDiffMB.toFixed(1)}MB`,
    );

    // 브라우저가 제대로 종료되었다면 RSS 증가가 100MB 미만이어야 함
    // (브라우저 상주 시 200-300MB 증가)
    expect(rssDiffMB).toBeLessThan(100);
  });
});
