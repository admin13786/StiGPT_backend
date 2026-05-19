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
import { ListAiReviewDto } from './dto/list-ai-review.dto';
import { AiReviewService } from './ai-review.service';

const AI_REVIEW_UPLOAD_DIR = './uploads/ai-review';

@Controller('ai-review')
@UseGuards(JwtAuthGuard)
export class AiReviewController {
  constructor(private readonly aiReviewService: AiReviewService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(AI_REVIEW_UPLOAD_DIR, { recursive: true });
          cb(null, AI_REVIEW_UPLOAD_DIR);
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
    @Body() dto: { type: string; kbId?: string },
  ) {
    if (!file) {
      throw new BadRequestException('Please upload a file to review.');
    }

    const task = await this.aiReviewService.createTask(
      {
        type: dto.type || 'paper',
        fileName: file.originalname,
        filePath: file.path,
        kbId: dto.kbId?.trim(),
      },
      user.id,
    );

    this.aiReviewService.runReview(task.id).catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'unknown error';
      console.error('AI review task execution failed:', errorMessage);
    });

    return task;
  }

  @Get('status/:id')
  getStatus(@CurrentUser() user: any, @Param('id') id: string) {
    return this.aiReviewService.getStatus(id, user.id);
  }

  @Get('report/:id')
  getReport(@CurrentUser() user: any, @Param('id') id: string) {
    return this.aiReviewService.getReport(id, user.id);
  }

  @Get('list')
  list(@CurrentUser() user: any, @Query() query: ListAiReviewDto) {
    return this.aiReviewService.list(user.id, query);
  }

  @Post('list')
  listPost(@CurrentUser() user: any, @Body() dto: ListAiReviewDto) {
    return this.aiReviewService.list(user.id, dto);
  }

  @Delete(':id')
  delete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.aiReviewService.delete(id, user.id);
  }
}
