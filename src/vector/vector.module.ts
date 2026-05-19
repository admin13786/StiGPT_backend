import { Module } from '@nestjs/common';
import { VectorService } from './vector.service';
import { MilvusService } from './milvus.service';
import { EmbeddingService } from './embedding.service';

@Module({
  providers: [VectorService, MilvusService, EmbeddingService],
  exports: [VectorService, EmbeddingService],
})
export class VectorModule {}
