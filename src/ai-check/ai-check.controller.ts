import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { extname } from 'path';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ListAiCheckDto } from './dto/list-ai-check.dto';
import { AiCheckService } from './ai-check.service';

const AI_CHECK_UPLOAD_DIR = './uploads/ai-check';

@Controller('ai-check')
@UseGuards(JwtAuthGuard)
export class AiCheckController {
  constructor(private readonly aiCheckService: AiCheckService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(AI_CHECK_UPLOAD_DIR, { recursive: true });
          cb(null, AI_CHECK_UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async upload(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: { type?: string; kbId?: string },
  ) {
    if (!file) {
      throw new BadRequestException('Please upload a file to check.');
    }

    const task = await this.aiCheckService.createTask(
      {
        type: dto.type || 'paper',
        fileName: file.originalname,
        filePath: file.path,
        kbId: dto.kbId?.trim(),
      },
      user.id,
    );

    this.aiCheckService.runCheck(task.id).catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'unknown error';
      console.error('AI check task execution failed:', errorMessage);
    });

    return task;
  }

  @Get('status/:id')
  getStatus(@CurrentUser() user: any, @Param('id') id: string) {
    return this.aiCheckService.getStatus(id, user.id);
  }

  @Get('report/:id')
  getReport(@CurrentUser() user: any, @Param('id') id: string) {
    return this.aiCheckService.getReport(id, user.id);
  }

  @Get('list')
  list(@CurrentUser() user: any, @Query() query: ListAiCheckDto) {
    return this.aiCheckService.list(user.id, query);
  }

  @Post('list')
  listPost(@CurrentUser() user: any, @Body() dto: ListAiCheckDto) {
    return this.aiCheckService.list(user.id, dto);
  }

  @Delete(':id')
  delete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.aiCheckService.delete(id, user.id);
  }
}
