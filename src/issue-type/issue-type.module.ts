import { Module } from '@nestjs/common';
import { IssueTypeController } from './issue-type.controller';
import { IssueTypeService } from './issue-type.service';

@Module({
  controllers: [IssueTypeController],
  providers: [IssueTypeService],
  exports: [IssueTypeService],
})
export class IssueTypeModule {}
