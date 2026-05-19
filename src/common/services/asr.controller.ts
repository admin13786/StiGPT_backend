import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AliyunAsrService } from './aliyun-asr.service';
import { Public } from '../../auth/decorators/public.decorator';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { ConfigService } from '@nestjs/config';

@Controller('asr')
export class AsrController {
  constructor(
    private readonly asrService: AliyunAsrService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('transcribe')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: diskStorage({
        destination: './uploads/audio',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async transcribe(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('未上传音频文件');
    }

    try {
      console.log('音频文件已保存:', file.path);
      
      // 直接使用文件路径进行识别
      const text = await this.asrService.transcribeFromFile(file.path);
      
      return {
        success: true,
        text,
      };
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }
}
