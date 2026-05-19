import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return '科研之友 AI 后端 API - 运行正常';
  }
}
