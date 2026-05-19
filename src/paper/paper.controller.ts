import { Controller, Post, Get, Put, Delete, Body, Param, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { PaperService } from './paper.service';
import { IndexPaperToKbDto } from './dto/index-paper-to-kb.dto';

@Controller('papers')
export class PaperController {
  constructor(private readonly paperService: PaperService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads/papers',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + extname(file.originalname));
      },
    }),
    fileFilter: (req, file, cb) => {
      if (file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new Error('只支持 PDF 文件'), false);
      }
    },
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  }))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: { discipline?: string; kbId?: string },
  ) {
    return this.paperService.uploadPaper(file, dto);
  }

  @Get('list')
  list(
    @Query('discipline') discipline?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.paperService.list({
      discipline,
      status,
      keyword,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('disciplines')
  getDisciplineStats() {
    return this.paperService.getDisciplineStats();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.paperService.getById(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() data: { title?: string; discipline?: string; subField?: string; keywords?: string[] }) {
    return this.paperService.update(id, data);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.paperService.delete(id);
  }

  @Post(':id/reprocess')
  reprocess(@Param('id') id: string, @Body() dto: { kbId?: string }) {
    return this.paperService.reprocess(id, dto.kbId);
  }

  @Post(':id/index-to-kb')
  indexToKnowledgeBase(@Param('id') id: string, @Body() dto: IndexPaperToKbDto) {
    return this.paperService.indexToKnowledgeBase(id, dto);
  }
}
