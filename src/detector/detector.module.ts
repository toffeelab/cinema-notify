import { Module } from '@nestjs/common';
import { DetectorService } from './detector.service';
import { StateService } from './state.service';

@Module({
  providers: [DetectorService, StateService],
  exports: [DetectorService, StateService],
})
export class DetectorModule {}
