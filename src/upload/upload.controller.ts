import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadService } from './upload.service';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('upload')
@Controller('upload')
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private prisma: PrismaService,
  ) {}

  @Public()
  @Post('ticket-attachment')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB，与 upload.service.ts 中的验证一致
      },
    }),
  )
  @ApiOperation({ summary: '上传工单附件（玩家端）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        ticketId: { type: 'string' },
        ticketToken: { type: 'string' },
        sortOrder: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 201, description: '上传成功' })
  @ApiResponse({ status: 400, description: '上传失败' })
  async uploadTicketAttachment(
    @UploadedFile() file: Express.Multer.File,
    @Body('ticketId') ticketId?: string,
    @Body('ticketToken') ticketToken?: string,
    @Body('sortOrder') sortOrder?: string,
  ) {
    if (!file) {
      throw new BadRequestException('请选择要上传的文件');
    }

    if (!ticketId && !ticketToken) {
      throw new BadRequestException('缺少工单信息');
    }

    type TicketLite = { id: string };
    let ticket: TicketLite | null = null;

    if (ticketId) {
      ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true },
      });
    }

    if (!ticket && ticketToken) {
      ticket = await this.prisma.ticket.findUnique({
        where: { token: ticketToken },
        select: { id: true },
      });
    }

    if (!ticket) {
      throw new BadRequestException('工单不存在');
    }

    const resolvedTicketId = ticket.id;

    const fileInfo = await this.uploadService.saveFile(file, resolvedTicketId);

    const attachment = await this.prisma.ticketAttachment.create({
      data: {
        ticketId: resolvedTicketId,
        fileUrl: fileInfo.fileUrl,
        fileName: fileInfo.fileName,
        fileType: fileInfo.fileType,
        fileSize: fileInfo.fileSize,
        sortOrder: sortOrder ? parseInt(sortOrder, 10) : 0,
      },
    });

    return attachment;
  }

  // 上传用户头像
  @Post('avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
    }),
  )
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '上传用户头像' })
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
  @ApiResponse({ status: 201, description: '上传成功' })
  @ApiResponse({ status: 400, description: '上传失败' })
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    if (!file) {
      throw new BadRequestException('请选择要上传的头像文件');
    }

    const fileInfo = await this.uploadService.saveAvatar(file, user.id);

    // 更新用户头像
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { avatar: fileInfo.fileUrl },
      select: {
        id: true,
        username: true,
        role: true,
        realName: true,
        email: true,
        phone: true,
        avatar: true,
        isOnline: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      ...fileInfo,
      user: updatedUser,
    };
  }
}
