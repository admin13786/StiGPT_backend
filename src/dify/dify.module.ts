import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DifyService } from './dify.service';
import { DifyController } from './dify.controller';
import { GameModule } from '../game/game.module';

@Module({
  imports: [
    GameModule,
    HttpModule.register({
      timeout: 8000,
    }),
  ],
  controllers: [DifyController],
  providers: [DifyService],
  exports: [DifyService],
})
export class DifyModule {}
