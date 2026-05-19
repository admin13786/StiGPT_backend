import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from './llm.service';

export interface SqlAgentResult {
  data: any[];
  sql: string;
  summary: string;
}

@Injectable()
export class SqlAgentService {
  private readonly logger = new Logger(SqlAgentService.name);

  // 可查询的表结构描述（供 LLM 生成 SQL）
  private readonly schemaDescription = `
可查询的 PostgreSQL 表：
1. "Paper" - 论文元数据
   字段: id, title, abstract, keywords(数组), year, venue, doi, "citationCount", "createdAt"
2. "Author" - 作者
   字段: id, name, affiliation, email, "hIndex"
3. "PaperAuthor" - 论文-作者关联
   字段: id, "paperId", "authorId", "order"
4. "PaperCitation" - 论文引用关系
   字段: id, "citingPaperId", "citedPaperId"

注意：
- 表名和字段名用双引号包裹（PostgreSQL 大小写敏感）
- keywords 是 TEXT[] 数组类型，用 @> ARRAY['关键词'] 查询
- 只允许 SELECT 查询，禁止 INSERT/UPDATE/DELETE
`;

  constructor(
    private prisma: PrismaService,
    private llmService: LlmService,
  ) {}

  /**
   * 路线1：Agent 生成 SQL 查询知识图谱
   */
  async queryBySQL(question: string): Promise<SqlAgentResult> {
    try {
      // 1. LLM 生成 SQL
      const sqlResponse = await this.llmService.generate([
        {
          role: 'system',
          content: `你是一个 SQL 专家。根据用户问题生成 PostgreSQL 查询语句。
${this.schemaDescription}
只返回一条 SQL 语句，不要解释。如果问题与论文/作者/引用无关，返回 "SKIP"。`,
        },
        { role: 'user', content: question },
      ], 0.1);

      const sql = sqlResponse.answer.trim().replace(/```sql\n?/g, '').replace(/```/g, '').trim();

      // 安全检查
      if (sql === 'SKIP' || !sql.toUpperCase().startsWith('SELECT')) {
        return { data: [], sql: '', summary: '' };
      }

      // 2. 执行 SQL
      const data = await this.prisma.$queryRawUnsafe(sql);
      const rows = Array.isArray(data) ? data : [];

      // 3. LLM 总结结果
      let summary = '';
      if (rows.length > 0) {
        const summaryResponse = await this.llmService.generate([
          {
            role: 'system',
            content: '用简洁的中文总结以下数据库查询结果，突出关键信息。',
          },
          {
            role: 'user',
            content: `问题：${question}\nSQL：${sql}\n结果（前10条）：${JSON.stringify(rows.slice(0, 10))}`,
          },
        ], 0.3);
        summary = summaryResponse.answer;
      }

      this.logger.log(`SQL Agent 查询成功，返回 ${rows.length} 条结果`);
      return { data: rows.slice(0, 20), sql, summary };
    } catch (error) {
      this.logger.warn('SQL Agent 查询失败', error.message);
      return { data: [], sql: '', summary: '' };
    }
  }
}