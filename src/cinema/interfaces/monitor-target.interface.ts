import { SpecialHallType } from './cinema-provider.interface';

export interface MonitorTarget {
  provider: string;
  cinemaCode: string;
  cinemaName: string;
  hallTypes: SpecialHallType[];
  movieFilter: string[];
}

export interface MonitorConfig {
  checkIntervalMin: number;
  checkDaysAhead: number;
  targets: MonitorTarget[];
}
