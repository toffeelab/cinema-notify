import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { DiscordBotService } from './discord-bot.service';
import { DetectorModule } from '../detector/detector.module';

@Module({
  imports: [DetectorModule],
  providers: [DiscordService, DiscordBotService],
  exports: [DiscordService],
})
export class NotificationModule {}
