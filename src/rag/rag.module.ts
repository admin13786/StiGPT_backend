import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { RetrievalService } from './retrieval.service';
import { LlmService } from './llm.service';
import { RerankService } from './rerank.service';
import { LightragService } from './lightrag.service';
import { SqlAgentService } from './sql-agent.service';
import { DualRouteService } from './dual-route.service';
import { SelfRagService } from './self-rag.service';
import { PrismaModule } from '../prisma/prisma.module';
import { VectorModule } from '../vector/vector.module';

@Module({
  imports: [PrismaModule, VectorModule],
  controllers: [RagController],
  providers: [
    RagService,
    RetrievalService,
    LlmService,
    RerankService,
    LightragService,
    SqlAgentService,
    DualRouteService,
    SelfRagService,
  ],
  exports: [
    RagService,
    LlmService,
    RerankService,
    LightragService,
    SqlAgentService,
    DualRouteService,
    SelfRagService,
    RetrievalService,
  ],
})
export class RagModule {}