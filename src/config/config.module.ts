import { Module, Global } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { MonitorConfigService } from './monitor-config.service';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  providers: [MonitorConfigService],
  exports: [MonitorConfigService],
})
export class ConfigModule {}
