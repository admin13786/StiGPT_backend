import { Module, forwardRef } from '@nestjs/common';
import { SatisfactionService } from './satisfaction.service';
import { SatisfactionController } from './satisfaction.controller';
import { TicketModule } from '../ticket/ticket.module';

@Module({
  imports: [forwardRef(() => TicketModule)],
  controllers: [SatisfactionController],
  providers: [SatisfactionService],
  exports: [SatisfactionService],
})
export class SatisfactionModule {}
