import { Module } from '@nestjs/common';
import { CinemaService } from './cinema.service';
import { CgvProvider } from './providers/cgv.provider';
import { CINEMA_PROVIDERS } from './interfaces/cinema-provider.interface';
import { DetectorModule } from '../detector/detector.module';
import { NotificationModule } from '../notification/notification.module';
import { HealthWatchdogService } from '../common/health-watchdog.service';

@Module({
  imports: [DetectorModule, NotificationModule],
  providers: [
    CgvProvider,
    {
      provide: CINEMA_PROVIDERS,
      useFactory: (cgv: CgvProvider) => [cgv],
      inject: [CgvProvider],
    },
    HealthWatchdogService,
    CinemaService,
  ],
  exports: [CinemaService],
})
export class CinemaModule {}
