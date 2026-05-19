/**
 * Linly-Talker 数字人 Controller
 * 提供数字人对话、TTS、视频生成等接口
 */
import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { LinlyTalkerService } from './linly-talker.service';
import { IsString, IsOptional } from 'class-validator';

class ChatDto {
  @IsString()
  question: string;

  @IsOptional()
  @IsString()
  avatarImage?: string;
}

class ChangeModelDto {
  @IsString()
  modelName: string;
}

class TtsDto {
  @IsString()
  text: string;
}

@Controller('linly-talker')
export class LinlyTalkerController {
  constructor(private readonly linlyTalkerService: LinlyTalkerService) {}

  /**
   * 健康检查 - 检测三个服务是否在线
   */
  @Get('health')
  async checkHealth() {
    const health = await this.linlyTalkerService.checkHealth();
    return { success: true, data: health };
  }

  /**
   * 提交数字人对话任务（问题 → LLM → TTS → 视频）
   */
  @Post('chat')
  async createChat(@Body() dto: ChatDto) {
    const taskId = await this.linlyTalkerService.createChatTask(
      dto.question,
      dto.avatarImage,
    );
    return {
      success: true,
      data: { taskId },
      message: '数字人对话任务已提交',
    };
  }

  /**
   * 仅调用 LLM 获取文字回复（不生成视频）
   */
  @Post('chat/text')
  async chatText(@Body() dto: ChatDto) {
    const answer = await this.linlyTalkerService.chat(dto.question);
    return { success: true, data: { answer } };
  }

  /**
   * 仅调用 TTS 生成音频
   */
  @Post('tts')
  async tts(@Body() body: TtsDto) {
    const audioFile = await this.linlyTalkerService.tts(body.text);
    return {
      success: true,
      data: { audioUrl: `/uploads/linly-talker/${audioFile}` },
    };
  }

  /**
   * 查询任务状态
   */
  @Get('task/:taskId')
  async getTask(@Param('taskId') taskId: string) {
    const task = this.linlyTalkerService.getTask(taskId);
    if (!task) {
      return { success: false, message: '任务不存在' };
    }
    return { success: true, data: task };
  }

  /**
   * 获取所有任务列表
   */
  @Get('tasks')
  async listTasks() {
    const tasks = this.linlyTalkerService.getAllTasks();
    return { success: true, data: tasks };
  }

  /**
   * 切换 TTS 模型
   */
  @Post('model/tts')
  async changeTtsModel(@Body() dto: ChangeModelDto) {
    const result = await this.linlyTalkerService.changeTtsModel(dto.modelName);
    return { success: true, data: result };
  }

  /**
   * 切换 LLM 模型
   */
  @Post('model/llm')
  async changeLlmModel(@Body() dto: ChangeModelDto) {
    const result = await this.linlyTalkerService.changeLlmModel(dto.modelName);
    return { success: true, data: result };
  }

  /**
   * 切换 Talker 模型
   */
  @Post('model/talker')
  async changeTalkerModel(@Body() dto: ChangeModelDto) {
    const result = await this.linlyTalkerService.changeTalkerModel(dto.modelName);
    return { success: true, data: result };
  }
}
