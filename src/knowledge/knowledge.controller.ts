import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { KnowledgeService } from './knowledge.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Knowledge Base')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('knowledge-bases')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  @ApiOperation({ summary: '创建知识库' })
  async create(@Body() dto: CreateKnowledgeBaseDto, @Request() req) {
    return this.knowledgeService.create(dto, req.user.userId);
  }

  @Get()
  @ApiOperation({ summary: '获取知识库列表' })
  async findAll(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('search') search?: string,
    @Request() req?,
  ) {
    return this.knowledgeService.findAll(
      {
        page: parseInt(page),
        limit: parseInt(limit),
        search,
      },
      req.user.userId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '获取知识库详情' })
  async findOne(@Param('id') id: string, @Request() req) {
    return this.knowledgeService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新知识库' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeBaseDto,
    @Request() req,
  ) {
    return this.knowledgeService.update(id, dto, req.user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除知识库' })
  async remove(@Param('id') id: string, @Request() req) {
    return this.knowledgeService.remove(id, req.user.userId);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: '获取知识库统计信息' })
  async getStats(@Param('id') id: string, @Request() req) {
    return this.knowledgeService.getStats(id, req.user.userId);
  }
}
