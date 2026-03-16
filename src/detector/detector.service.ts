import { Injectable, Logger } from '@nestjs/common';
import { ScreeningInfo } from '../cinema/interfaces/cinema-provider.interface';
import { StateService } from './state.service';

@Injectable()
export class DetectorService {
  private readonly logger = new Logger(DetectorService.name);

  constructor(private readonly stateService: StateService) {}

  async detectNewScreenings(
    current: ScreeningInfo[],
  ): Promise<ScreeningInfo[]> {
    const previous = this.stateService.load();
    const isColdStart = this.stateService.isColdStart;

    // 현재 스크래핑에 포함된 날짜 목록
    const currentDates = new Set(current.map((s) => s.date));

    // 누락된 날짜의 이전 상영 정보를 보존하여 병합 저장
    // (특정 날짜 API timeout 시 해당 날짜 상영이 state에서 사라지는 것을 방지)
    const preserved = previous.filter((s) => !currentDates.has(s.date));
    await this.stateService.save([...current, ...preserved]);

    // Cold start (DB 비어있음): 모든 데이터를 기존으로 취급하여 거짓 알림 방지
    if (isColdStart) {
      this.logger.log(
        `Cold start detected — treating all ${current.length} screening(s) as existing`,
      );
      this.stateService.clearColdStart();
      return [];
    }

    // DB에 저장된 이전 상태와 비교하여 새 상영을 감지
    const previousKeys = new Set(
      previous.map((s) => this.screeningKey(s)),
    );

    const newScreenings = current.filter(
      (s) => !previousKeys.has(this.screeningKey(s)),
    );

    if (newScreenings.length > 0) {
      const newKeys = newScreenings.map((s) => this.screeningKey(s));
      this.logger.log(
        `Detected ${newScreenings.length} new screening(s): [${newKeys.join(', ')}]`,
      );
    }

    return newScreenings;
  }

  private screeningKey(s: ScreeningInfo): string {
    return `${s.movieTitle}|${s.hallName}|${s.date}`;
  }
}
