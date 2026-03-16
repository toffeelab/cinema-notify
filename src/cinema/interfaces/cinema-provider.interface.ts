export type SpecialHallType = 'IMAX' | '4DX' | 'SCREENX' | 'DOLBY' | 'STANDARD';

export interface ScreeningInfo {
  movieTitle: string;
  hallName: string;
  hallType: SpecialHallType;
  date: string;
  times: string[];
  cinemaName: string;
}

export interface CinemaProvider {
  readonly name: string;
  fetchScreeningsForDates(
    cinemaCode: string,
    cinemaName: string,
    dates: string[],
  ): Promise<ScreeningInfo[]>;
  dispose(): Promise<void>;
}

export const CINEMA_PROVIDERS = 'CINEMA_PROVIDERS';
