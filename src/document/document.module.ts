import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocumentProcessorService } from './document-processor.service';
import { PrismaModule } from '../prisma/prisma.module';
import { VectorModule } from '../vector/vector.module';

@Module({
  imports: [PrismaModule, VectorModule],
  controllers: [DocumentController],
  providers: [DocumentService, DocumentProcessorService],
  exports: [DocumentService, DocumentProcessorService],
})
export class DocumentModule {}
