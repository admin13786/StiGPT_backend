import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class LightragService {
  private readonly logger = new Logger(LightragService.name);
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('LIGHTRAG_URL', 'http://localhost:8020');
  }

  /**
   * 插入文档到 LightRAG（构建知识图谱）
   */
  async insertDocument(text: string): Promise<boolean> {
    try {
      await axios.post(`${this.baseUrl}/insert`, { text }, { timeout: 60000 });
      this.logger.log('文档已插入 LightRAG');
      return true;
    } catch (error) {
      this.logger.warn('LightRAG 插入失败（服务可能未启动）', error.message);
      return false;
    }
  }

  /**
   * GraphRAG 查询（local/global/hybrid 三模式）
   */
  async query(
    question: string,
    mode: 'local' | 'global' | 'hybrid' = 'hybrid',
  ): Promise<string> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/query`,
        { query: question, mode },
        { timeout: 30000 },
      );
      return response.data?.answer || response.data?.response || '';
    } catch (error) {
      this.logger.warn(`LightRAG 查询失败（mode=${mode}）`, error.message);
      return '';
    }
  }

  /**
   * 健康检查
   */
  async isAvailable(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/health`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}