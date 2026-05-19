import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ListAiWriteDto } from './dto/list-ai-write.dto';
import { AiWriteService } from './ai-write.service';

@Controller('ai-write')
@UseGuards(JwtAuthGuard)
export class AiWriteController {
  constructor(private readonly aiWriteService: AiWriteService) {}

  @Post('create')
  create(
    @CurrentUser() user: any,
    @Body()
    dto: {
      type: string;
      title: string;
      researchField?: string;
      keywords?: string[];
      kbId?: string;
      context?: Record<string, unknown>;
    },
  ) {
    return this.aiWriteService.create(user.id, dto);
  }

  @Post('generate-outline')
  generateOutline(@CurrentUser() user: any, @Body() dto: { taskId: string }) {
    return this.aiWriteService.generateOutline(user.id, dto.taskId);
  }

  @Post('generate-section')
  generateSection(
    @CurrentUser() user: any,
    @Body() dto: { taskId: string; sectionIndex: number },
  ) {
    return this.aiWriteService.generateSection(user.id, dto.taskId, dto.sectionIndex);
  }

  @Post('polish')
  polish(@CurrentUser() user: any, @Body() dto: { taskId: string }) {
    return this.aiWriteService.polish(user.id, dto.taskId);
  }

  @Get('list')
  list(@CurrentUser() user: any, @Query() query: ListAiWriteDto) {
    return this.aiWriteService.list(user.id, query);
  }

  @Post('list')
  listPost(@CurrentUser() user: any, @Body() dto: ListAiWriteDto) {
    return this.aiWriteService.list(user.id, dto);
  }

  @Get(':id')
  getById(@CurrentUser() user: any, @Param('id') id: string) {
    return this.aiWriteService.getById(user.id, id);
  }

  @Put(':id/profile')
  updateProfile(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body()
    dto: {
      title?: string;
      researchField?: string;
      keywords?: string[];
      kbId?: string;
      context?: Record<string, unknown>;
    },
  ) {
    return this.aiWriteService.updateProfile(user.id, id, dto);
  }

  @Put(':id')
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body()
    data: {
      title?: string;
      researchField?: string | null;
      keywords?: string[];
      kbId?: string | null;
      context?: Record<string, unknown> | null;
      sections?: Record<string, unknown> | null;
      content?: Record<string, unknown> | null;
    },
  ) {
    return this.aiWriteService.update(user.id, id, data);
  }

  @Delete(':id')
  delete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.aiWriteService.delete(user.id, id);
  }
}
