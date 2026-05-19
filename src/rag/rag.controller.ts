import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Sse,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RagService } from './rag.service';
import { QueryDto } from './dto/query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Observable } from 'rxjs';

@ApiTags('RAG')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post('query')
  @ApiOperation({ summary: 'RAG 查询' })
  async query(@Body() dto: QueryDto, @Request() req) {
    return this.ragService.query(dto, req.user.userId);
  }

  @Sse('query/stream')
  @ApiOperation({ summary: 'RAG 流式查询' })
  async queryStream(@Body() dto: QueryDto, @Request() req): Promise<Observable<MessageEvent>> {
    return new Observable((observer) => {
      (async () => {
        try {
          for await (const chunk of this.ragService.queryStream(dto, req.user.userId)) {
            observer.next({ data: chunk } as MessageEvent);
          }
          observer.complete();
        } catch (error) {
          observer.error(error);
        }
      })();
    });
  }

  @Get('knowledge-bases/:kbId/popular-citations')
  @ApiOperation({ summary: '获取热门引用' })
  async getPopularCitations(
    @Param('kbId') kbId: string,
    @Query('limit') limit: string = '10',
  ) {
    return this.ragService.getPopularCitations(kbId, parseInt(limit));
  }

  @Get('knowledge-bases/:kbId/citation-stats')
  @ApiOperation({ summary: '获取引用统计' })
  async getCitationStats(@Param('kbId') kbId: string) {
    return this.ragService.getCitationStats(kbId);
  }
}
