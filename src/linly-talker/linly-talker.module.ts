/**
 * Linly-Talker 数字人模块
 * 封装 Linly-Talker 的 TTS、LLM、Talker 三个 FastAPI 服务
 */
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LinlyTalkerService } from './linly-talker.service';
import { LinlyTalkerController } from './linly-talker.controller';

@Module({
  imports: [HttpModule],
  providers: [LinlyTalkerService],
  controllers: [LinlyTalkerController],
  exports: [LinlyTalkerService],
})
export class LinlyTalkerModule {}
