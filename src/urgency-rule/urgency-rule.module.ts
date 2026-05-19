import { Module } from '@nestjs/common';
import { UrgencyRuleService } from './urgency-rule.service';
import { UrgencyRuleController } from './urgency-rule.controller';

@Module({
  controllers: [UrgencyRuleController],
  providers: [UrgencyRuleService],
  exports: [UrgencyRuleService],
})
export class UrgencyRuleModule {}
