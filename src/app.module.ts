import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from './config/config.module';
import { CinemaModule } from './cinema/cinema.module';

@Module({
  imports: [ScheduleModule.forRoot(), ConfigModule, CinemaModule],
})
export class AppModule {}
