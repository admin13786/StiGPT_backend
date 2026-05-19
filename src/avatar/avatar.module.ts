import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AvatarService } from './avatar.service';
import { AvatarController } from './avatar.controller';

@Module({
  imports: [HttpModule],
  controllers: [AvatarController],
  providers: [AvatarService],
  exports: [AvatarService],
})
export class AvatarModule {}
