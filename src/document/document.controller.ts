import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { DocumentService } from './document.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('knowledge-bases/:kbId/documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  @ApiOperation({ summary: '上传文档' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadDir = './uploads/documents';
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      limits: {
        fileSize: parseInt(process.env.MAX_DOCUMENT_SIZE || '52428800'), // 50MB
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = (process.env.SUPPORTED_DOCUMENT_TYPES || 'pdf,md').split(',');
        const ext = extname(file.originalname).substring(1).toLowerCase();
        if (allowedTypes.includes(ext)) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`不支持的文件类型: ${ext}。支持的类型: ${allowedTypes.join(', ')}`), false);
        }
      },
    }),
  )
  async upload(
    @Param('kbId') kbId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (!file) {
      throw new BadRequestException('请上传文件');
    }
    return this.documentService.upload(kbId, file, req.user.userId);
  }

  @Get()
  @ApiOperation({ summary: '获取文档列表' })
  async findAll(
    @Param('kbId') kbId: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('status') status?: string,
    @Request() req?,
  ) {
    return this.documentService.findAll(
      kbId,
      {
        page: parseInt(page),
        limit: parseInt(limit),
        status,
      },
      req.user.userId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '获取文档详情' })
  async findOne(
    @Param('kbId') kbId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    return this.documentService.findOne(id, req.user.userId);
  }

  @Get(':id/status')
  @ApiOperation({ summary: '获取文档处理状态' })
  async getStatus(
    @Param('kbId') kbId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    return this.documentService.getStatus(id, req.user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除文档' })
  async remove(
    @Param('kbId') kbId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    return this.documentService.remove(id, req.user.userId);
  }

  @Post(':id/reprocess')
  @ApiOperation({ summary: '重新处理文档' })
  async reprocess(
    @Param('kbId') kbId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    return this.documentService.reprocess(id, req.user.userId);
  }
}
