import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DualRouteService } from '../rag/dual-route.service';
import {
  LlmHealthSnapshot,
  LlmMessage,
  LlmResponse,
  LlmService,
} from '../rag/llm.service';
import { ListAiWriteDto } from './dto/list-ai-write.dto';

type OutlineSection = {
  title: string;
  description: string;
  minWords: number;
};

type TemplateConfig = {
  sections: OutlineSection[];
  fewShot: string;
};

type AiWriteProfile = Record<string, unknown>;

type AiWriteGenerationMode = 'llm' | 'mixed' | 'fallback';

type AiWriteDependencyState =
  | 'ready'
  | 'not_requested'
  | 'missing_config'
  | 'unauthorized'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable'
  | 'empty';

type AiWriteDependencySnapshot = {
  state: AiWriteDependencyState;
  message: string;
  checkedAt: string;
  provider?: string;
  model?: string;
  kbId?: string | null;
};

type AiWriteExecutionEntry = {
  stage: string;
  mode: AiWriteGenerationMode;
  warnings: string[];
  at: string;
  llm: AiWriteDependencySnapshot;
  knowledge: AiWriteDependencySnapshot;
};

type AiWriteExecutionMeta = {
  lastStage: string;
  generationMode: AiWriteGenerationMode;
  warnings: string[];
  updatedAt: string;
  llm: AiWriteDependencySnapshot;
  knowledge: AiWriteDependencySnapshot;
  history: AiWriteExecutionEntry[];
};

type AiWriteKnowledgeContext = {
  text: string;
  snapshot: AiWriteDependencySnapshot;
  warning?: string;
};

type AiWriteGenerationAttempt = {
  response: LlmResponse | null;
  snapshot: AiWriteDependencySnapshot;
  warning?: string;
};

@Injectable()
export class AiWriteService {
  private readonly logger = new Logger(AiWriteService.name);

  private readonly templates: Record<string, TemplateConfig> = {
    project_proposal: {
      sections: [
        {
          title: '项目摘要',
          description: '概括研究背景、核心问题、拟采用的方法与预期成果。',
          minWords: 450,
        },
        {
          title: '研究背景与问题界定',
          description: '说明目标问题的现实背景、研究意义与本项目覆盖的范围。',
          minWords: 800,
        },
        {
          title: '研究目标与技术路线',
          description: '描述研究目标、核心方法、关键工作包与整体执行路径。',
          minWords: 1000,
        },
        {
          title: '创新点与可行性分析',
          description: '阐明项目创新、已有基础、团队能力、数据与资源保障。',
          minWords: 650,
        },
        {
          title: '预期成果与实施计划',
          description: '列出阶段目标、时间安排、交付成果与可衡量指标。',
          minWords: 420,
        },
      ],
      fewShot:
        '请按照中文科研项目申请书的表达习惯输出，结构清晰、逻辑闭环、问题具体、路径可执行，避免空泛套话。',
    },
    journal_paper: {
      sections: [
        {
          title: '摘要',
          description: '概括研究问题、方法、结果和主要结论。',
          minWords: 260,
        },
        {
          title: '引言',
          description: '说明研究背景、动机、现有不足与本文贡献。',
          minWords: 800,
        },
        {
          title: '相关工作',
          description: '比较代表性工作并明确尚未被解决的关键缺口。',
          minWords: 700,
        },
        {
          title: '方法',
          description: '解释提出的方法、设计选择、系统流程与关键机制。',
          minWords: 1100,
        },
        {
          title: '实验与分析',
          description: '描述实验设置、评价指标、主要结果、分析与局限。',
          minWords: 950,
        },
        {
          title: '结论',
          description: '总结主要发现，并提出后续工作方向。',
          minWords: 320,
        },
      ],
      fewShot:
        '请按照中文学术论文写作方式输出，论点要可追溯、表达专业克制、优先使用具体证据与明确贡献，避免夸张表述。',
    },
  };

  constructor(
    private prisma: PrismaService,
    private dualRouteService: DualRouteService,
    private llmService: LlmService,
  ) {}

  async create(userId: string, dto: {
    type: string;
    title: string;
    researchField?: string;
    keywords?: string[];
    kbId?: string;
    context?: Record<string, unknown>;
  }) {
    const normalizedType = this.normalizeTaskType(dto.type);
    const profile = this.normalizeProfile(dto.context);

    return this.prisma.aIWriteTask.create({
      data: {
        userId,
        type: normalizedType,
        title: dto.title,
        researchField: dto.researchField,
        keywords: dto.keywords || [],
        kbId: dto.kbId,
        content: this.buildStoredContent({}, profile, null),
        status: 'created',
      },
    });
  }

  async updateProfile(
    userId: string,
    id: string,
    dto: {
      title?: string;
      researchField?: string;
      keywords?: string[];
      kbId?: string;
      context?: Record<string, unknown>;
    },
  ) {
    const task = await this.getOwnedTask(userId, id);
    const stored = this.readStoredContent(task.content);
    const currentSections = stored.sections;
    const currentProfile = stored.profile || {};
    const nextProfile = this.normalizeProfile(dto.context);
    const mergedProfile = nextProfile ? { ...currentProfile, ...nextProfile } : currentProfile;

    return this.prisma.aIWriteTask.update({
      where: { id },
      data: {
        title: typeof dto.title === 'string' && dto.title.trim() ? dto.title.trim() : task.title,
        researchField:
          typeof dto.researchField === 'string'
            ? dto.researchField.trim() || null
            : task.researchField,
        keywords: Array.isArray(dto.keywords) ? dto.keywords.filter(Boolean) : task.keywords,
        kbId: typeof dto.kbId === 'string' ? dto.kbId.trim() || null : task.kbId,
        content: this.buildStoredContent(currentSections, mergedProfile, stored.executionMeta),
      },
    });
  }

  async generateOutline(userId: string, taskId: string) {
    const task = await this.getOwnedTask(userId, taskId);
    const template = this.getTemplate(task.type);
    const stored = this.readStoredContent(task.content);
    const profile = stored.profile;
    const profileContext = this.buildProfileContextLines(profile);
    const knowledge = await this.safeDomainKnowledge(
      `${task.title} ${task.researchField || ''} 研究背景与相关工作`,
      task.kbId,
      task.userId,
    );

    const llmAttempt = await this.tryGenerate(
      [
        {
          role: 'system',
          content: [
            '你是中文科研写作助理。',
            template.fewShot,
            knowledge.text
              ? `可用领域知识：\n${knowledge.text.slice(0, 2500)}`
              : '当前没有可用的外部领域知识。',
            profileContext.length > 0
              ? `结构化写作简报：\n${profileContext.join('\n')}`
              : '当前没有结构化写作简报。',
            `默认章节建议：\n${JSON.stringify(template.sections)}`,
            '只返回 JSON 数组，不要附加解释。每个对象格式为 {"title":"...","description":"...","minWords":500}。',
          ].join('\n\n'),
        },
        {
          role: 'user',
          content: [
            `标题：${task.title}`,
            `研究方向：${task.researchField || '未填写'}`,
            `关键词：${task.keywords.join('、') || '未填写'}`,
            profileContext.length > 0 ? `表单上下文：\n${profileContext.join('\n')}` : '',
            '请生成一个适合中文科研项目或期刊论文写作的提纲，章节命名应专业直接、便于后续逐节展开。',
          ].join('\n'),
        },
      ],
      0.45,
      'generateOutline',
    );

    const outline =
      this.parseOutlineResponse(llmAttempt.response?.answer) ||
      this.buildFallbackOutline(task, template, knowledge.text, profile);
    const executionMeta = this.buildExecutionMeta(stored.executionMeta, {
      stage: 'generate-outline',
      llm: llmAttempt.snapshot,
      knowledge: knowledge.snapshot,
      warnings: [knowledge.warning, llmAttempt.warning].filter(
        (item): item is string => Boolean(item),
      ),
      mode: this.resolveGenerationMode(Boolean(llmAttempt.response), knowledge.snapshot),
    });

    await this.prisma.aIWriteTask.update({
      where: { id: taskId },
      data: {
        outline,
        content: this.buildStoredContent(stored.sections, profile, executionMeta),
        status: 'outline_ready',
        errorMessage: null,
      },
    });

    return outline;
  }

  async generateSection(userId: string, taskId: string, sectionIndex: number) {
    const task = await this.getOwnedTask(userId, taskId);
    const outline = this.normalizeOutline(task.outline);
    const stored = this.readStoredContent(task.content);
    const profile = stored.profile;
    if (outline.length === 0) {
      throw new Error('请先生成提纲。');
    }

    const section = outline[sectionIndex];
    if (!section) {
      throw new Error(`章节序号 ${sectionIndex} 不存在。`);
    }

    const contentMap = stored.sections;
    const profileContext = this.buildProfileContextLines(profile);
    const previousSections = Object.entries(contentMap)
      .filter(([key]) => Number.parseInt(key, 10) < sectionIndex)
      .sort((left, right) => Number.parseInt(left[0], 10) - Number.parseInt(right[0], 10))
      .map(([, value]) => value)
      .join('\n\n')
      .slice(-2200);
    const knowledge = await this.safeDomainKnowledge(
      `${task.title} ${section.title} 研究证据、方法与实现路径`,
      task.kbId,
      task.userId,
    );

    const draftAttempt = await this.tryGenerate(
      [
        {
          role: 'system',
          content: [
            '你是中文科研写作助理。',
            `请撰写“${section.title}”章节，风格严谨、可读、适合科研文本。`,
            `目标最少字数：${section.minWords} 字。`,
            previousSections
              ? `前文上下文：\n${previousSections.slice(-1200)}`
              : '当前没有前文章节上下文。',
            knowledge.text
              ? `可用领域知识：\n${knowledge.text.slice(0, 1800)}`
              : '当前没有可用的外部领域知识。',
            profileContext.length > 0
              ? `结构化写作简报：\n${profileContext.join('\n')}`
              : '当前没有结构化写作简报。',
            '输出请直接给章节正文，不要再解释你是如何生成的。',
          ].join('\n\n'),
        },
        {
          role: 'user',
          content: [
            `文稿标题：${task.title}`,
            `研究方向：${task.researchField || '未填写'}`,
            `章节目标：${section.description}`,
            `关键词：${task.keywords.join('、') || '未填写'}`,
            profileContext.length > 0 ? `表单上下文：\n${profileContext.join('\n')}` : '',
          ].join('\n'),
        },
      ],
      0.6,
      'generateSection:draft',
    );

    const revisedAttempt = draftAttempt.response
      ? await this.tryGenerate(
          [
            {
              role: 'system',
              content:
                '你正在润色一段中文科研草稿。请优化结构、压缩重复、补强逻辑衔接，并只返回润色后的章节正文。',
            },
            {
              role: 'user',
              content: draftAttempt.response.answer,
            },
          ],
          0.35,
          'generateSection:revise',
        )
      : {
          response: null,
          snapshot: this.convertLlmSnapshot(this.llmService.getConfigurationSnapshot()),
        };

    const finalContent =
      this.normalizeGeneratedText(revisedAttempt.response?.answer) ||
      this.normalizeGeneratedText(draftAttempt.response?.answer) ||
      this.buildFallbackSection(
        task,
        section,
        sectionIndex,
        previousSections,
        knowledge.text,
        profile,
      );

    const updatedContent = {
      ...contentMap,
      [sectionIndex]: finalContent,
    };
    const sectionWarnings = [
      knowledge.warning,
      draftAttempt.warning,
      revisedAttempt.warning,
    ].filter((item): item is string => Boolean(item));
    const sectionMode = this.resolveGenerationMode(
      Boolean(draftAttempt.response || revisedAttempt.response),
      knowledge.snapshot,
    );
    const executionMeta = this.buildExecutionMeta(stored.executionMeta, {
      stage: `generate-section-${sectionIndex + 1}`,
      llm: revisedAttempt.response ? revisedAttempt.snapshot : draftAttempt.snapshot,
      knowledge: knowledge.snapshot,
      warnings: sectionWarnings,
      mode: sectionMode,
    });

    await this.prisma.aIWriteTask.update({
      where: { id: taskId },
      data: {
        content: this.buildStoredContent(updatedContent, profile, executionMeta),
        status: 'outline_ready',
        errorMessage: null,
      },
    });

    return finalContent;
  }

  async polish(userId: string, taskId: string) {
    const task = await this.getOwnedTask(userId, taskId);
    const outline = this.normalizeOutline(task.outline);
    const stored = this.readStoredContent(task.content);
    const contentMap = stored.sections;
    const profile = stored.profile;
    const fullText = this.composeFullText(outline, contentMap, task, profile);
    const profileContext = this.buildProfileContextLines(profile);

    const polishedAttempt = await this.tryGenerate(
      [
        {
          role: 'system',
          content:
            [
              '你正在润色一份中文科研文稿。',
              '请改善全文流畅度，消除重复表述，保持论证前后一致，并只返回润色后的完整正文。',
              profileContext.length > 0
                ? `结构化写作简报：\n${profileContext.join('\n')}`
                : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
        },
        {
          role: 'user',
          content: fullText.slice(0, 7000),
        },
      ],
      0.35,
      'polish',
    );

    const finalText =
      this.normalizeGeneratedText(polishedAttempt.response?.answer) ||
      this.buildFallbackFullText(task, outline, contentMap, profile);
    const executionMeta = this.buildExecutionMeta(stored.executionMeta, {
      stage: 'polish',
      llm: polishedAttempt.snapshot,
      knowledge: this.buildKnowledgeSnapshot('not_requested', '全文润色阶段未额外查询知识库。'),
      warnings: [polishedAttempt.warning].filter((item): item is string => Boolean(item)),
      mode: polishedAttempt.response ? 'llm' : 'fallback',
    });

    await this.prisma.aIWriteTask.update({
      where: { id: taskId },
      data: {
        fullText: finalText,
        content: this.buildStoredContent(contentMap, profile, executionMeta),
        status: 'completed',
        errorMessage: null,
      },
    });

    return finalText;
  }

  async list(userId: string, query: ListAiWriteDto = {}) {
    const pageNo = query.pageNo || 1;
    const pageSize = query.pageSize || 10;
    const where: Prisma.AIWriteTaskWhereInput = {
      userId,
    };
    const trimmedSearchKey = query.searchKey?.trim();

    if (trimmedSearchKey) {
      where.OR = [
        { title: { contains: trimmedSearchKey, mode: 'insensitive' } },
        { researchField: { contains: trimmedSearchKey, mode: 'insensitive' } },
      ];
    }

    const taskType = this.mapFilterTypeToTaskType(query.type);
    if (taskType) {
      where.type = taskType;
    }

    const timeRange = this.resolveTimeRange(query.writingTime);
    if (timeRange) {
      where.updatedAt = timeRange;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.aIWriteTask.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.aIWriteTask.count({ where }),
    ]);

    return {
      items: items.map((item) => {
        const stored = this.readStoredContent(item.content);
        return {
          id: item.id,
          title: item.title,
          type: this.mapTaskTypeToViewType(item.type),
          taskType: item.type,
          researchField: item.researchField,
          keywords: item.keywords,
          status: item.status,
          hasOutline: Boolean(item.outline),
          hasFullText: Boolean(item.fullText),
          updatedAt: item.updatedAt,
          createdAt: item.createdAt,
          executionMeta: stored.executionMeta,
          context: stored.profile,
          errorMessage: item.errorMessage,
        };
      }),
      total,
      pageNo,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getById(userId: string, id: string) {
    const task = await this.getOwnedTask(userId, id);
    return this.serializeTask(task);
  }

  async update(userId: string, id: string, data: Record<string, unknown>) {
    const task = await this.getOwnedTask(userId, id);
    const stored = this.readStoredContent(task.content);
    const nextData: Prisma.AIWriteTaskUpdateInput = {};
    let nextProfile = stored.profile;
    let nextSections = { ...stored.sections };
    let shouldUpdateContent = false;

    if (typeof data.title === 'string' && data.title.trim()) {
      nextData.title = data.title.trim();
    }

    if (Object.prototype.hasOwnProperty.call(data, 'researchField')) {
      if (typeof data.researchField === 'string') {
        nextData.researchField = data.researchField.trim() || null;
      } else if (data.researchField === null) {
        nextData.researchField = null;
      }
    }

    if (Array.isArray(data.keywords)) {
      nextData.keywords = data.keywords
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'kbId')) {
      if (typeof data.kbId === 'string') {
        nextData.kbId = data.kbId.trim() || null;
      } else if (data.kbId === null) {
        nextData.kbId = null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'context')) {
      if (data.context === null) {
        nextProfile = null;
        shouldUpdateContent = true;
      } else {
        const normalizedProfile = this.normalizeProfile(
          data.context as Record<string, unknown> | undefined,
        );
        if (normalizedProfile) {
          nextProfile = { ...(nextProfile || {}), ...normalizedProfile };
          shouldUpdateContent = true;
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'sections')) {
      if (data.sections === null) {
        nextSections = {};
        shouldUpdateContent = true;
      } else {
        const normalizedSections = this.normalizeSectionMap(data.sections);
        if (Object.keys(normalizedSections).length > 0) {
          nextSections = { ...nextSections, ...normalizedSections };
          shouldUpdateContent = true;
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'content')) {
      if (data.content === null) {
        nextProfile = null;
        nextSections = {};
        shouldUpdateContent = true;
      } else {
        const incoming = this.readStoredContent(data.content as Prisma.JsonValue);
        if (incoming.profile) {
          nextProfile = { ...(nextProfile || {}), ...incoming.profile };
          shouldUpdateContent = true;
        }
        if (Object.keys(incoming.sections).length > 0) {
          nextSections = { ...nextSections, ...incoming.sections };
          shouldUpdateContent = true;
        }
      }
    }

    if (shouldUpdateContent) {
      nextData.content = this.buildStoredContent(nextSections, nextProfile, stored.executionMeta);
    }

    if (Object.keys(nextData).length === 0) {
      throw new BadRequestException('未提供可更新的 AI 写作字段。');
    }

    const updated = await this.prisma.aIWriteTask.update({ where: { id }, data: nextData });
    return this.serializeTask(updated);
  }

  async delete(userId: string, id: string) {
    await this.getOwnedTask(userId, id);
    return this.prisma.aIWriteTask.delete({ where: { id } });
  }

  private async getOwnedTask(userId: string, id: string) {
    const task = await this.prisma.aIWriteTask.findFirst({ where: { id, userId } });
    if (!task) {
      throw new NotFoundException('AI write task not found.');
    }
    return task;
  }

  private getTemplate(type?: string): TemplateConfig {
    return this.templates[this.normalizeTaskType(type)] || this.templates.project_proposal;
  }

  private normalizeTaskType(type?: string) {
    if (type === 'project' || type === 'project_proposal') {
      return 'project_proposal';
    }

    if (type === 'paper' || type === 'journal_paper') {
      return 'journal_paper';
    }

    return type || 'project_proposal';
  }

  private mapFilterTypeToTaskType(type?: string) {
    if (type === 'project') return 'project_proposal';
    if (type === 'paper') return 'journal_paper';
    return undefined;
  }

  private mapTaskTypeToViewType(type: string) {
    if (type === 'project_proposal') return 'project';
    if (type === 'journal_paper') return 'paper';
    return type;
  }

  private async safeDomainKnowledge(
    question: string,
    kbId?: string | null,
    userId?: string | null,
  ): Promise<AiWriteKnowledgeContext> {
    if (!kbId?.trim()) {
      return {
        text: '',
        snapshot: this.buildKnowledgeSnapshot('not_requested', '当前未绑定知识库，按表单资料直接生成。'),
      } satisfies AiWriteKnowledgeContext;
    }

    try {
      const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
        where: {
          id: kbId,
          deletedAt: null,
        },
        select: {
          id: true,
          userId: true,
          aclScope: true,
          aclUsers: true,
        },
      });

      if (!knowledgeBase) {
        const message = '未找到绑定知识库，已回退到仅基于表单资料生成。';
        return {
          text: '',
          snapshot: this.buildKnowledgeSnapshot('unavailable', message, kbId),
          warning: message,
        } satisfies AiWriteKnowledgeContext;
      }

      if (userId) {
        const aclUsers = Array.isArray(knowledgeBase.aclUsers)
          ? knowledgeBase.aclUsers.filter((item): item is string => typeof item === 'string')
          : [];
        const hasAccess =
          knowledgeBase.aclScope === 'public' ||
          knowledgeBase.userId === userId ||
          (knowledgeBase.aclScope === 'shared' && aclUsers.includes(userId));

        if (!hasAccess) {
          const message = '当前账号无权访问该知识库，已回退到仅基于表单资料生成。';
          return {
            text: '',
            snapshot: this.buildKnowledgeSnapshot('unauthorized', message, kbId),
            warning: message,
          } satisfies AiWriteKnowledgeContext;
        }
      }

      const result = await this.dualRouteService.query(question, kbId);
      const normalized = this.normalizeGeneratedText(result.answer);
      if (!normalized) {
        return {
          text: '',
          snapshot: this.buildKnowledgeSnapshot('empty', '知识库未返回可用内容，已跳过知识增强。', kbId),
        } satisfies AiWriteKnowledgeContext;
      }

      return {
        text: normalized,
        snapshot: this.buildKnowledgeSnapshot('ready', '知识库增强可用。', kbId),
      } satisfies AiWriteKnowledgeContext;
    } catch (error) {
      const message = `知识库增强失败，已回退到仅基于表单资料生成：${this.getErrorMessage(error)}`;
      this.logger.warn(`Domain knowledge fallback activated for kbId=${kbId}: ${this.getErrorMessage(error)}`);
      return {
        text: '',
        snapshot: this.buildKnowledgeSnapshot('unavailable', message, kbId),
        warning: message,
      } satisfies AiWriteKnowledgeContext;
    }
  }

  private async tryGenerate(
    messages: LlmMessage[],
    temperature: number,
    stage: string,
  ): Promise<AiWriteGenerationAttempt> {
    try {
      const response = await this.llmService.generate(messages, temperature);
      return {
        response,
        snapshot: this.convertLlmSnapshot(this.llmService.getReadySnapshot()),
      };
    } catch (error) {
      const snapshot = this.convertLlmSnapshot(this.llmService.describeError(error));
      const warning = `大模型在 ${stage} 阶段不可用，已降级为模板草稿：${snapshot.message}`;
      this.logger.warn(`LLM fallback activated at ${stage}: ${this.getErrorMessage(error)}`);
      return {
        response: null,
        snapshot,
        warning,
      };
    }
  }

  private parseOutlineResponse(answer?: string | null): OutlineSection[] | null {
    const parsed = this.parseJsonValue(answer);
    if (!Array.isArray(parsed)) {
      return null;
    }

    const normalized = parsed
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }

        const record = item as Record<string, unknown>;
        const title = this.toNonEmptyString(record.title);
        if (!title) {
          return null;
        }

        return {
          title,
          description:
            this.toNonEmptyString(record.description) ||
            `请围绕“${title}”这一节补足清晰的结构、论证与证据支撑。`,
          minWords: this.toPositiveNumber(record.minWords) ?? 400,
        };
      })
      .filter((item): item is OutlineSection => Boolean(item));

    return normalized.length > 0 ? normalized : null;
  }

  private normalizeOutline(value: Prisma.JsonValue | null): OutlineSection[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }

        const record = item as Record<string, unknown>;
        const title = this.toNonEmptyString(record.title);
        if (!title) {
          return null;
        }

        return {
          title,
          description:
            this.toNonEmptyString(record.description) ||
            `请围绕“${title}”这一节补足清晰的结构、论证与证据支撑。`,
          minWords: this.toPositiveNumber(record.minWords) ?? 400,
        };
      })
      .filter((item): item is OutlineSection => Boolean(item));
  }

  private normalizeProfile(value?: Record<string, unknown>): AiWriteProfile | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    try {
      const normalized = JSON.parse(JSON.stringify(value)) as AiWriteProfile;
      return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
        ? normalized
        : null;
    } catch {
      return null;
    }
  }

  private normalizeSectionMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
      (accumulator, [key, item]) => {
        const normalized = this.normalizeGeneratedText(
          typeof item === 'string' ? item : undefined,
        );
        if (normalized) {
          accumulator[key] = normalized;
        }
        return accumulator;
      },
      {},
    );
  }

  private readStoredContent(value: Prisma.JsonValue | null): {
    profile: AiWriteProfile | null;
    sections: Record<string, string>;
    executionMeta: AiWriteExecutionMeta | null;
  } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        profile: null,
        sections: {},
        executionMeta: null,
      };
    }

    const record = value as Record<string, unknown>;
    const profile =
      record.__profile && typeof record.__profile === 'object' && !Array.isArray(record.__profile)
        ? this.normalizeProfile(record.__profile as Record<string, unknown>)
        : null;
    const executionMeta =
      record.__execution && typeof record.__execution === 'object' && !Array.isArray(record.__execution)
        ? this.normalizeExecutionMeta(record.__execution)
        : null;
    const sectionContainer =
      record.__sections &&
      typeof record.__sections === 'object' &&
      !Array.isArray(record.__sections)
        ? (record.__sections as Record<string, unknown>)
        : record;
    const sections = this.normalizeSectionMap(sectionContainer);

    return { profile, sections, executionMeta };
  }

  private readContentMap(value: Prisma.JsonValue | null): Record<string, string> {
    return this.readStoredContent(value).sections;
  }

  private readProfile(value: Prisma.JsonValue | null): AiWriteProfile | null {
    return this.readStoredContent(value).profile;
  }

  private buildStoredContent(
    sections: Record<string, string>,
    profile?: AiWriteProfile | null,
    executionMeta?: AiWriteExecutionMeta | null,
  ): Prisma.InputJsonValue | undefined {
    const normalizedProfile = this.normalizeProfile(profile || undefined);
    const normalizedExecutionMeta = this.normalizeExecutionMeta(executionMeta || undefined);
    const hasSections = Object.keys(sections).length > 0;

    if (!normalizedProfile && !normalizedExecutionMeta) {
      return hasSections ? (sections as Prisma.InputJsonValue) : undefined;
    }

    return {
      __profile: normalizedProfile,
      __sections: sections,
      __execution: normalizedExecutionMeta,
    } as Prisma.InputJsonValue;
  }

  private normalizeExecutionMeta(value?: unknown): AiWriteExecutionMeta | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const history = Array.isArray(record.history)
      ? record.history
          .map((item) => this.normalizeExecutionEntry(item))
          .filter((item): item is AiWriteExecutionEntry => Boolean(item))
          .slice(-8)
      : [];

    return {
      lastStage: this.toNonEmptyString(record.lastStage) || 'idle',
      generationMode: this.normalizeGenerationMode(record.generationMode),
      warnings: this.normalizeStringList(record.warnings, 6),
      updatedAt: this.toNonEmptyString(record.updatedAt) || new Date().toISOString(),
      llm: this.normalizeDependencySnapshot(record.llm, this.llmService.getConfigurationSnapshot()),
      knowledge: this.normalizeDependencySnapshot(
        record.knowledge,
        this.buildKnowledgeSnapshot('not_requested', '当前未查询知识库。'),
      ),
      history,
    };
  }

  private normalizeExecutionEntry(value: unknown): AiWriteExecutionEntry | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    return {
      stage: this.toNonEmptyString(record.stage) || 'unknown',
      mode: this.normalizeGenerationMode(record.mode),
      warnings: this.normalizeStringList(record.warnings, 6),
      at: this.toNonEmptyString(record.at) || new Date().toISOString(),
      llm: this.normalizeDependencySnapshot(record.llm, this.llmService.getConfigurationSnapshot()),
      knowledge: this.normalizeDependencySnapshot(
        record.knowledge,
        this.buildKnowledgeSnapshot('not_requested', '当前未查询知识库。'),
      ),
    };
  }

  private normalizeDependencySnapshot(
    value: unknown,
    fallback: LlmHealthSnapshot | AiWriteDependencySnapshot,
  ): AiWriteDependencySnapshot {
    const fallbackSnapshot = this.isLlmHealthSnapshot(fallback)
      ? this.convertLlmSnapshot(fallback)
      : fallback;

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return fallbackSnapshot;
    }

    const record = value as Record<string, unknown>;
    return {
      state: this.normalizeDependencyState(record.state),
      message: this.toNonEmptyString(record.message) || fallbackSnapshot.message,
      checkedAt: this.toNonEmptyString(record.checkedAt) || fallbackSnapshot.checkedAt,
      provider: this.toNonEmptyString(record.provider) || fallbackSnapshot.provider,
      model: this.toNonEmptyString(record.model) || fallbackSnapshot.model,
      kbId:
        typeof record.kbId === 'string'
          ? record.kbId.trim() || null
          : fallbackSnapshot.kbId || null,
    };
  }

  private buildExecutionMeta(
    existing: AiWriteExecutionMeta | null,
    input: {
      stage: string;
      mode: AiWriteGenerationMode;
      warnings: string[];
      llm: AiWriteDependencySnapshot;
      knowledge: AiWriteDependencySnapshot;
    },
  ): AiWriteExecutionMeta {
    const entry: AiWriteExecutionEntry = {
      stage: input.stage,
      mode: input.mode,
      warnings: input.warnings,
      at: new Date().toISOString(),
      llm: input.llm,
      knowledge: input.knowledge,
    };

    const history = [...(existing?.history || []), entry].slice(-8);
    const warnings = Array.from(
      new Set(
        history
          .flatMap((item) => item.warnings)
          .filter((item) => Boolean(item.trim())),
      ),
    ).slice(-8);

    return {
      lastStage: input.stage,
      generationMode: this.resolveOverallGenerationMode(history),
      warnings,
      updatedAt: entry.at,
      llm: input.llm,
      knowledge: input.knowledge,
      history,
    };
  }

  private resolveGenerationMode(
    usedLlm: boolean,
    knowledge: AiWriteDependencySnapshot,
  ): AiWriteGenerationMode {
    if (!usedLlm) {
      return 'fallback';
    }

    if (knowledge.state === 'not_requested') {
      return 'llm';
    }

    return 'mixed';
  }

  private resolveOverallGenerationMode(
    history: AiWriteExecutionEntry[],
  ): AiWriteGenerationMode {
    if (history.some((item) => item.mode === 'fallback')) {
      return 'fallback';
    }

    if (history.some((item) => item.mode === 'mixed')) {
      return 'mixed';
    }

    return 'llm';
  }

  private convertLlmSnapshot(snapshot: LlmHealthSnapshot): AiWriteDependencySnapshot {
    return {
      state: this.normalizeDependencyState(snapshot.state),
      message: snapshot.message,
      checkedAt: snapshot.checkedAt,
      provider: snapshot.provider,
      model: snapshot.model,
    };
  }

  private buildKnowledgeSnapshot(
    state: AiWriteDependencyState,
    message: string,
    kbId?: string | null,
  ): AiWriteDependencySnapshot {
    return {
      state,
      message,
      checkedAt: new Date().toISOString(),
      kbId: kbId?.trim() || null,
    };
  }

  private normalizeGenerationMode(value: unknown): AiWriteGenerationMode {
    return value === 'fallback' || value === 'mixed' ? value : 'llm';
  }

  private normalizeDependencyState(value: unknown): AiWriteDependencyState {
    switch (value) {
      case 'ready':
      case 'not_requested':
      case 'missing_config':
      case 'unauthorized':
      case 'rate_limited':
      case 'timeout':
      case 'unavailable':
      case 'empty':
        return value;
      default:
        return 'unavailable';
    }
  }

  private normalizeStringList(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, limit);
  }

  private isLlmHealthSnapshot(
    value: LlmHealthSnapshot | AiWriteDependencySnapshot,
  ): value is LlmHealthSnapshot {
    return 'provider' in value && 'model' in value;
  }

  private serializeTask(task: {
    content: Prisma.JsonValue | null;
  } & Record<string, unknown>) {
    const stored = this.readStoredContent(task.content);
    return {
      ...task,
      context: stored.profile,
      executionMeta: stored.executionMeta,
    };
  }

  private buildProfileContextLines(profile: AiWriteProfile | null): string[] {
    if (!profile) {
      return [];
    }

    const labels: Record<string, string> = {
      fundingAgency: '资助机构',
      projectCategory: '项目类型',
      journalTarget: '目标期刊',
      journalRequirements: '期刊要求',
      researchField: '学科分类',
      title: '题目',
      summary: '摘要',
      backgroundKeywords: '问题背景关键词',
      backgroundDescription: '问题背景说明',
      methodKeywords: '方法理论关键词',
      methodDescription: '方法理论说明',
      backgroundInnovation: '问题创新',
      methodInnovation: '方法创新',
      collaboratorSuggestions: '推荐合作者',
      coreKeywords: '核心关键词',
      references: '参考文献',
      kbId: '知识库编号',
    };

    const lines: string[] = [];
    for (const [key, rawValue] of Object.entries(profile)) {
      if (rawValue === null || typeof rawValue === 'undefined') {
        continue;
      }

      const label = labels[key] || key;
      if (typeof rawValue === 'boolean') {
        if (rawValue) {
          lines.push(`${label}: 是`);
        }
        continue;
      }

      if (Array.isArray(rawValue)) {
        const normalized = rawValue
          .filter(
            (item): item is string | number =>
              typeof item === 'string' || typeof item === 'number',
          )
          .map((item) => String(item).trim())
          .filter(Boolean);
        if (normalized.length > 0) {
          lines.push(`${label}: ${normalized.join('；')}`);
        }
        continue;
      }

      if (typeof rawValue === 'string' && rawValue.trim()) {
        lines.push(`${label}: ${rawValue.trim()}`);
      }
    }

    return lines.slice(0, 18);
  }

  private buildFallbackOutline(
    task: {
      title: string;
      researchField: string | null;
      keywords: string[];
      type: string;
    },
    template: TemplateConfig,
    domainKnowledge: string,
    profile?: AiWriteProfile | null,
  ): OutlineSection[] {
    const focus = this.buildFocusLine(task, domainKnowledge, profile);

    return template.sections.map((section, index) => ({
      title: section.title,
      description:
        index === 0
          ? `${section.description} 请始终围绕“${focus}”展开。`
          : `${section.description} 内容需要持续扣住“${focus}”这一主线。`,
      minWords: section.minWords,
    }));
  }

  private buildFallbackSection(
    task: {
      title: string;
      researchField: string | null;
      keywords: string[];
      type: string;
    },
    section: OutlineSection,
    sectionIndex: number,
    previousSections: string,
    domainKnowledge: string,
    profile?: AiWriteProfile | null,
  ) {
    const title = this.getProfileString(profile, 'title') || task.title;
    const researchField =
      this.getProfileString(profile, 'researchField') || task.researchField || '相关研究方向';
    const fundingAgency = this.getProfileString(profile, 'fundingAgency');
    const projectCategory = this.getProfileString(profile, 'projectCategory');
    const journalTarget = this.getProfileString(profile, 'journalTarget');
    const summary = this.getProfileString(profile, 'summary');
    const backgroundDescription = this.getProfileString(profile, 'backgroundDescription');
    const methodDescription = this.getProfileString(profile, 'methodDescription');
    const collaboratorSuggestions = this.getProfileString(profile, 'collaboratorSuggestions');
    const references = this.getProfileString(profile, 'references');
    const coreKeywords = this.getProfileList(profile, 'coreKeywords', 6);
    const backgroundKeywords = this.getProfileList(profile, 'backgroundKeywords', 5);
    const methodKeywords = this.getProfileList(profile, 'methodKeywords', 5);
    const backgroundInnovation = this.getProfileList(profile, 'backgroundInnovation', 4);
    const methodInnovation = this.getProfileList(profile, 'methodInnovation', 4);
    const keywords = Array.from(
      new Set([...task.keywords, ...coreKeywords, ...backgroundKeywords, ...methodKeywords]),
    ).slice(0, 8);
    const keywordLine = keywords.length > 0 ? keywords.join('、') : '知识组织、证据检索、科研写作';
    const defaultMethodLabel =
      methodKeywords.join('、') || '知识图谱、检索增强与多阶段写作流程';
    const methodLabel = this.buildMethodLabel(methodDescription, defaultMethodLabel);
    const methodNarrative = this.buildMethodNarrative(methodDescription, methodLabel);
    const knowledgeHint = domainKnowledge
      ? this.extractFirstSentence(domainKnowledge)
      : '当前以项目已有资料和表单内容为主进行论证展开';
    const continuityHint = previousSections
      ? `前文已经指出：${this.extractFirstSentence(previousSections)}`
      : '';
    const sceneLabel =
      task.type === 'journal_paper'
        ? `${journalTarget ? `面向 ${journalTarget} 投稿的` : ''}论文写作场景`
        : `${fundingAgency || '科研项目'}${projectCategory ? `-${projectCategory}` : ''}申请场景`;

    if (task.type === 'journal_paper') {
      if (section.title.includes('摘要')) {
        return [
          `${title}聚焦于${researchField}方向，针对${backgroundDescription || '现有学术研究在知识组织、证据衔接与文本生成环节中存在的信息割裂和写作效率问题'}展开研究。本文围绕${keywordLine}等关键要素，${methodNarrative}，建立一条面向${sceneLabel}的学术智能写作链路。`,
          `${summary || '研究通过引入结构化上下文、章节级生成与全流程润色机制，提升科研写作中的表达稳定性、内容一致性与可审阅性'}。预期结果表明，该方法能够在${sceneLabel}中为题目构思、提纲规划、章节撰写和结果整合提供更具可操作性的支持，并为后续学术写作工具的产品化落地提供参考。`,
        ].join('\n\n');
      }

      if (section.title.includes('引言')) {
        return [
          `随着${researchField}相关研究不断推进，科研工作者在资料组织、问题凝练、章节衔接与反复修改方面面临越来越高的时间成本。尤其在${sceneLabel}中，写作者不仅需要准确表达研究问题，还需要将研究背景、方法创新与证据链条在有限篇幅内组织成具有说服力的学术文本。`,
          continuityHint ||
            `当前大量写作辅助工具仍停留在通用续写或段落改写层面，缺少围绕研究任务、知识结构和学术规范的协同设计。它们往往难以同时处理研究语境、方法逻辑与章节一致性，导致生成文本容易出现主题漂移、论证空洞或上下文断裂等问题。`,
          `针对上述不足，本文围绕${keywordLine}提出一套面向中文科研写作的协同生成框架。该框架强调在写作前注入结构化研究简报，在写作中保持章节目标与核心贡献的一致性，并在写作后通过整体润色提升全文可读性。本文的主要价值在于：一是构建与研究问题紧耦合的写作链路，二是将${methodInnovation.join('、') || '结构化上下文建模与多阶段生成'}引入学术文本生成过程，三是为后续系统化评估与产品实现提供方法基础。`,
        ].join('\n\n');
      }

      if (section.title.includes('相关工作')) {
        return [
          `现有相关工作主要集中在三个方向。第一类是通用大模型写作辅助方法，强调语言流畅性和内容扩写能力，但对研究主题约束和学术逻辑维护相对不足。第二类是面向文献问答或检索增强的系统，能够补充外部知识，却往往缺少对完整论文结构的支撑。第三类是面向特定任务的科研写作工具，更关注模板和流程，但在研究问题与方法创新的协同表达方面仍有提升空间。`,
          `${knowledgeHint}。从这些研究可以看出，围绕${researchField}和${keywordLine}的已有工作已经为学术文本生成提供了基础能力，但在章节间信息传递、结构化资料注入以及全文一致性控制方面，仍然存在明显缺口。`,
          `与上述工作相比，本文更关注“研究资料建模 + 提纲规划 + 章节生成 + 全文润色”的一体化写作机制。也就是说，我们并不把写作看作单一的文本续写任务，而是将其视为围绕研究问题、证据组织和贡献表达展开的连续协同过程。这也是本文方法区别于已有工作的核心切入点。`,
        ].join('\n\n');
      }

      if (section.title.includes('方法')) {
        return [
          `本文方法面向${sceneLabel}构建，整体思路是将写作任务拆解为结构化资料准备、提纲生成、章节生成与全文润色四个阶段。首先，系统从题目、研究方向、背景说明、方法说明、关键词与参考依据中提取稳定写作锚点，形成面向整篇论文的研究简报；随后根据章节目标生成可展开的写作提纲，并在每个章节内维护局部目标与全局主线的一致性。`,
          `在核心机制上，方法重点围绕${methodLabel}展开，以提升文本质量。其一，通过结构化上下文约束章节目标，减少生成内容偏离研究主线的风险；其二，通过逐节生成与前文继承机制，增强章节间的语义连续性；其三，通过全文级润色统一术语、贡献表述和叙述节奏，提升论文整体完成度。`,
          `进一步地，本文特别强调${methodInnovation.join('、') || '章节级控制、全局一致性维护与可回写的写作资料管理'}。这种设计使系统不仅能够输出单段文本，还能够持续支持论文从草稿到可审阅版本的演进。若后续接入更丰富的知识库或真实实验数据，该方法还可以在保持结构稳定的前提下，进一步增强内容的真实性与学术说服力。`,
        ].join('\n\n');
      }

      if (section.title.includes('实验')) {
        return [
          `实验部分建议围绕写作链路的有效性与可用性展开。首先，需要验证系统在提纲完整性、章节一致性、术语稳定性以及全文可读性方面的表现；其次，需要对比仅使用通用生成模型、仅使用检索增强、以及引入结构化写作资料后的差异，以说明各模块的独立贡献。`,
          `${knowledgeHint}。因此在评价时，除了关注自动化指标外，还应结合人工评阅，从问题聚焦程度、逻辑连贯性、创新表述清晰度和投稿/申报适配度等维度进行综合分析。对于${researchField}场景而言，这类多维评价比单一语言质量指标更能反映系统的真实价值。`,
          `在分析结果时，应重点讨论两类现象：一类是结构化资料和章节级控制是否能够显著降低文本漂移；另一类是全文润色模块是否真正改善了前后术语一致与论证衔接。如果实验结果能够证明系统在${keywordLine}相关场景中带来稳定收益，那么本文方法将具备进一步扩展到更多学术写作任务的潜力。`,
        ].join('\n\n');
      }

      if (section.title.includes('结论')) {
        return [
          `本文围绕${researchField}中的科研写作支持问题，提出了一种结合结构化研究资料、章节级生成和全文润色机制的学术智能写作框架。该方法试图在写作链路中同时解决研究问题表达、章节逻辑衔接与全文一致性控制等关键挑战，从而提升论文草稿的可用性与可审阅性。`,
          `后续工作可以从三个方向继续推进：一是引入更真实的知识库和文献证据，增强生成内容的学术支撑；二是针对${journalTarget || '目标期刊'}等不同投稿场景学习更细粒度的风格约束；三是结合人工反馈与评审结果闭环优化写作策略，使系统逐步从草稿助手升级为更完整的学术写作协同平台。`,
        ].join('\n\n');
      }
    }

    if (section.title.includes('项目摘要')) {
      return [
        `${title}面向${sceneLabel}展开，聚焦${researchField}方向中${backgroundDescription || '科研知识组织、证据整合和申请文本表达之间衔接不足'}的问题。项目拟围绕${keywordLine}等关键主题，${methodNarrative}，建立从问题凝练、方案设计到文本生成的协同写作链路。`,
        `${summary || '项目将通过结构化研究资料建模、章节级写作控制与全文一致性维护，提高中文科研写作在逻辑完整性、表达稳定性和申报适配度方面的质量'}。预期形成可支撑项目申请、科研问答与知识组织协同工作的基础系统，并在实际申报场景中验证其可行性与应用价值。`,
      ].join('\n\n');
    }

    if (section.title.includes('研究背景') || section.title.includes('问题界定')) {
      return [
        `当前${researchField}相关工作正在快速发展，但在科研人员真实使用场景中，资料分散、知识关系隐含、论证链条不连续等问题仍然普遍存在。特别是在${sceneLabel}下，写作者需要在有限时间内完成问题背景梳理、研究价值说明和技术路径组织，这对知识整合能力和文本表达能力提出了更高要求。`,
        `${knowledgeHint}。这说明已有研究虽然在局部能力上取得了进展，但在面向项目申请的整体写作链路中，仍缺少一套能够把研究问题、方法路线、创新点和实施计划稳定串联起来的支撑机制。`,
        `${continuityHint ? `${continuityHint}。` : ''}因此，本项目将研究范围明确聚焦于${keywordLine}相关问题，重点解决“研究资料如何结构化”“章节逻辑如何稳定生成”“项目价值如何准确表达”三个层面的核心挑战，为后续目标设计与技术实现奠定基础。`,
      ].join('\n\n');
    }

    if (section.title.includes('研究目标') || section.title.includes('技术路线')) {
      return [
        `本项目的总体目标是面向${sceneLabel}构建一套可落地的学术智能写作框架，围绕${keywordLine}建立从资料准备、提纲规划、章节生成到全文整合的完整链路。具体而言，项目希望在保证学术严谨性的前提下，提高项目申请文本的结构稳定性、创新表达清晰度以及撰写效率。`,
        `在技术路线方面，项目将按照“结构化建模 - 写作规划 - 章节生成 - 结果评估”的路径推进。第一阶段，对题目、研究方向、背景问题、方法思路和参考依据进行统一建模；第二阶段，基于研究目标生成可执行的大纲结构；第三阶段，围绕章节目标逐步展开正文生成与上下文衔接；第四阶段，通过整体润色与质量评估机制提升最终文稿的完整性和申报适配度。`,
        `为了确保路线可执行，项目还将同步设计验证机制，包括章节质量评估、创新点映射检查和全文一致性分析等模块。这样不仅能支撑单次写作任务，也能为后续产品化演进提供持续优化的技术基础。`,
      ].join('\n\n');
    }

    if (section.title.includes('创新点') || section.title.includes('可行性')) {
      const innovationText =
        backgroundInnovation.length > 0 || methodInnovation.length > 0
          ? `项目预期创新主要体现在${[...backgroundInnovation, ...methodInnovation].join('、')}等方面。`
          : '项目预期创新主要体现在将结构化研究资料、章节级生成控制与全文一致性维护机制有机结合。';

      return [
        `${innovationText}与传统写作辅助方式相比，本项目不再仅关注局部文本生成，而是强调研究问题、技术方案与申报表达之间的系统协同，从而提升项目申请书的整体逻辑与可审阅性。`,
        `从可行性看，项目已有较明确的研究对象、技术路径和应用场景。围绕${methodLabel}的技术路线已经具备较好的工程可实现性，能够为系统原型构建和功能迭代提供支撑。`,
        collaboratorSuggestions
          ? `在团队与合作条件方面，可优先围绕${collaboratorSuggestions}组织协作，以增强跨学科知识、应用验证和成果推广能力。`
          : '在团队与合作条件方面，可通过跨学科协作方式引入领域知识、工程实现和场景验证资源，进一步降低项目执行风险。',
      ].join('\n\n');
    }

    if (section.title.includes('预期成果') || section.title.includes('实施计划')) {
      return [
        `项目实施计划建议按照“需求梳理与资料建模、核心方法研发、系统集成与场景验证、成果凝练与总结推广”四个阶段展开。前期重点完成研究问题细化与写作知识结构设计，中期推进方法实现和系统联调，后期围绕真实申报场景开展试用验证与结果总结。`,
        `预期成果包括但不限于：形成一套面向${sceneLabel}的学术智能写作原型系统；沉淀围绕${keywordLine}的结构化研究资料与写作模板；输出与项目相关的方法文档、阶段报告、论文或软件著作等成果载体。`,
        references
          ? `同时，项目还可结合现有参考依据继续完善申报文本和阶段成果说明，当前已记录的参考材料包括：${this.truncateText(references, 120)}。`
          : '同时，项目还将围绕应用示范、成果复用和推广落地设计后续计划，确保研究输出不仅停留在原型层面，而是能够服务真实科研写作场景。',
      ].join('\n\n');
    }

    return [
      `本节围绕“${section.title}”展开，服务于${title}在${sceneLabel}中的整体写作目标。`,
      `从内容组织上，应紧扣${researchField}、${keywordLine}以及${section.description}等核心信息，确保章节既能独立成段，又能与全文主线保持一致。`,
      `后续可继续结合真实文献、政策依据、实验数据和团队条件，对本节草稿进行细化与增强，以提升其正式提交时的说服力。`,
    ].join('\n\n');
  }

  private buildFallbackFullText(
    task: {
      title: string;
      researchField: string | null;
      keywords: string[];
      type: string;
    },
    outline: OutlineSection[],
    contentMap: Record<string, string>,
    profile?: AiWriteProfile | null,
  ) {
    const assembled =
      outline.length > 0
        ? this.composeFullText(outline, contentMap, task, profile)
        : this.composeFullText(this.getTemplate(task.type).sections, contentMap, task, profile);

    const lead = [
      `# ${task.title}`,
      '',
      `本文为 ${task.type === 'journal_paper' ? '期刊论文' : '项目申请书'} 写作流程生成的工作草稿。`,
      `研究方向：${task.researchField || '暂未填写'}。`,
      `关键词：${task.keywords.join('、') || '暂未填写'}。`,
      ...(profile ? this.buildProfileContextLines(profile).slice(0, 6) : []),
      '',
    ].join('\n');

    return `${lead}${assembled}`.trim();
  }

  private composeFullText(
    outline: OutlineSection[],
    contentMap: Record<string, string>,
    task?: {
      title: string;
      researchField: string | null;
      keywords: string[];
      type: string;
    },
    profile?: AiWriteProfile | null,
  ) {
    if (outline.length === 0) {
      return Object.entries(contentMap)
        .sort((left, right) => Number.parseInt(left[0], 10) - Number.parseInt(right[0], 10))
        .map(([key, value]) => `## 第 ${Number.parseInt(key, 10) + 1} 节\n\n${value}`)
        .join('\n\n---\n\n');
    }

    return outline
      .map(
        (section, index) =>
          `## ${section.title}\n\n${
            contentMap[String(index)] ||
            this.buildFallbackSection(
              task || {
                title: '未命名草稿',
                researchField: null,
                keywords: [],
                type: 'project_proposal',
              },
              section,
              index,
              '',
              '',
              profile,
            )
          }`,
      )
      .join('\n\n---\n\n');
  }

  private buildFocusLine(
    task: {
      title: string;
      researchField: string | null;
      keywords: string[];
    },
    domainKnowledge: string,
    profile?: AiWriteProfile | null,
  ) {
    const profileRecord = profile || {};
    const profileParts = [
      this.toNonEmptyString(profileRecord.title),
      this.toNonEmptyString(profileRecord.researchField),
      this.toNonEmptyString(profileRecord.fundingAgency),
      this.toNonEmptyString(profileRecord.projectCategory),
      this.toNonEmptyString(profileRecord.journalTarget),
      Array.isArray(profileRecord.coreKeywords)
        ? profileRecord.coreKeywords
            .filter((item): item is string => typeof item === 'string')
            .slice(0, 4)
            .join('、')
        : null,
      Array.isArray(profileRecord.backgroundKeywords)
        ? profileRecord.backgroundKeywords
            .filter((item): item is string => typeof item === 'string')
            .slice(0, 3)
            .join('、')
        : null,
      Array.isArray(profileRecord.methodKeywords)
        ? profileRecord.methodKeywords
            .filter((item): item is string => typeof item === 'string')
            .slice(0, 3)
            .join('、')
        : null,
    ];

    const parts = [
      task.title,
      task.researchField || null,
      task.keywords.length > 0 ? task.keywords.slice(0, 4).join('、') : null,
      ...profileParts,
    ]
      .filter((item): item is string => Boolean(item && item.trim()))
      .map((item) => this.truncateText(item, 42));

    if (domainKnowledge) {
      const snippet = this.extractFirstSentence(domainKnowledge);
      if (snippet) {
        parts.push(this.truncateText(snippet, 60));
      }
    }

    return Array.from(new Set(parts)).join(' | ');
  }

  private buildKeywordLine(keywords: string[]) {
    if (keywords.length === 0) {
      return '当前没有显式关键词，请在章节中主动定义核心概念和论证锚点。';
    }

    return `本节应持续显化以下核心概念：${keywords
      .slice(0, 6)
      .join('、')}。`;
  }

  private getProfileString(profile: AiWriteProfile | null | undefined, key: string) {
    if (!profile) {
      return '';
    }

    const value = profile[key];
    return typeof value === 'string' ? value.trim() : '';
  }

  private getProfileList(profile: AiWriteProfile | null | undefined, key: string, limit = 5) {
    if (!profile) {
      return [];
    }

    const value = profile[key];
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, limit);
  }

  private buildMethodLabel(methodDescription: string, fallback: string) {
    const normalized = this.normalizeGeneratedText(methodDescription).replace(/[。；;]+$/u, '');
    if (!normalized) {
      return fallback;
    }

    if (/^(通过|采用|基于|围绕|借助|利用|依托|结合|构建|设计|提出)/u.test(normalized)) {
      return fallback;
    }

    return normalized.length > 40 ? this.truncateText(normalized, 40) : normalized;
  }

  private buildMethodNarrative(methodDescription: string, fallback: string) {
    const normalized = this.normalizeGeneratedText(methodDescription).replace(/[。；;]+$/u, '');
    if (!normalized) {
      return `通过${fallback}`;
    }

    if (/^(通过|采用|基于|围绕|借助|利用|依托|结合|构建|设计|提出)/u.test(normalized)) {
      return normalized;
    }

    if (/[，,]/u.test(normalized)) {
      return `围绕${normalized}`;
    }

    return `通过${normalized}`;
  }

  private extractFirstSentence(value: string) {
    const normalized = this.normalizeGeneratedText(value);
    if (!normalized) {
      return '';
    }

    const firstSentence = normalized.split(/(?<=[。！？.!?])\s*/u)[0] || normalized;
    return firstSentence.length > 220 ? `${firstSentence.slice(0, 217)}...` : firstSentence;
  }

  private truncateText(value: string, maxLength: number) {
    const normalized = this.normalizeGeneratedText(value);
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, Math.max(maxLength - 1, 1))}…`;
  }

  private normalizeGeneratedText(value?: string | null) {
    if (typeof value !== 'string') {
      return '';
    }

    return value.trim();
  }

  private parseJsonValue(value?: string | null): unknown {
    const normalized = this.normalizeGeneratedText(value);
    if (!normalized) {
      return null;
    }

    const candidates = [
      normalized,
      normalized
        .replace(/^```json\s*/iu, '')
        .replace(/^```\s*/u, '')
        .replace(/\s*```$/u, ''),
    ];

    const firstBracket = normalized.indexOf('[');
    const lastBracket = normalized.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      candidates.push(normalized.slice(firstBracket, lastBracket + 1));
    }

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        continue;
      }
    }

    return null;
  }

  private toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private toPositiveNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }

    return Math.round(value);
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return 'unknown error';
  }

  private resolveTimeRange(
    writingTime?: 'all' | '7d' | '30d' | '180d' | '365d' | 'older',
  ) {
    const now = new Date();

    if (!writingTime || writingTime === 'all') {
      return undefined;
    }

    const date = new Date(now);

    switch (writingTime) {
      case '7d':
        date.setDate(now.getDate() - 7);
        return { gte: date };
      case '30d':
        date.setDate(now.getDate() - 30);
        return { gte: date };
      case '180d':
        date.setDate(now.getDate() - 180);
        return { gte: date };
      case '365d':
        date.setDate(now.getDate() - 365);
        return { gte: date };
      case 'older':
        date.setDate(now.getDate() - 365);
        return { lt: date };
      default:
        return undefined;
    }
  }
}
