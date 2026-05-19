/**
 * AI视频生成 Controller
 * 基于 Duix-Avatar 本地服务
 */
import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { AvatarService } from './avatar.service';

class CreateVideoDto {
  text: string;
  modelVideoPath?: string;
  referenceAudio?: string;
  referenceText?: string;
}

@Controller('avatar')
export class AvatarController {
  constructor(private readonly avatarService: AvatarService) {}

  /**
   * 提交视频生成任务
   */
  @Post('video')
  async createVideo(@Body() dto: CreateVideoDto) {
    const taskId = await this.avatarService.createVideoFromText(
      dto.text,
      dto.modelVideoPath || 'default.mp4',
      dto.referenceAudio || '',
      dto.referenceText || '',
    );

    return {
      success: true,
      data: { taskId },
      message: '视频生成任务已提交',
    };
  }

  /**
   * 查询任务状态
   */
  @Get('video/:taskId')
  async getVideoStatus(@Param('taskId') taskId: string) {
    const task = this.avatarService.getTask(taskId);
    if (!task) {
      return { success: false, message: '任务不存在' };
    }
    return { success: true, data: task };
  }

  /**
   * 获取所有任务列表
   */
  @Get('videos')
  async listVideos() {
    const tasks = this.avatarService.getAllTasks();
    return { success: true, data: tasks };
  }

  /**
   * 检查 Duix-Avatar 服务健康状态
   */
  @Get('health')
  async checkHealth() {
    const health = await this.avatarService.checkHealth();
    return { success: true, data: health };
  }
}
