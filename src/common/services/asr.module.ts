import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AliyunAsrService } from './aliyun-asr.service';
import { AsrController } from './asr.controller';

@Module({
  imports: [ConfigModule],
  controllers: [AsrController],
  providers: [AliyunAsrService],
  exports: [AliyunAsrService],
})
export class AsrModule {}
