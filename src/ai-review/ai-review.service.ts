import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { DualRouteService } from '../rag/dual-route.service';
import { LlmMessage, LlmResponse, LlmService } from '../rag/llm.service';
import { ListAiReviewDto } from './dto/list-ai-review.dto';

const pdfParse = require('pdf-parse');

export interface DimensionScore {
  dimension: string;
  weight: number;
  score: number;
  evidence: string[];
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

export interface ReviewIngestedSnapshot {
  title?: string;
  abstract?: string;
}

export interface ReviewReport {
  overallScore: number;
  recommendation: string;
  summary: string;
  dimensions: DimensionScore[];
  conclusion: string;
  keyStrengths: string[];
  keyRisks: string[];
  nextActions: string[];
  radarChartData: {
    labels: string[];
    scores: number[];
  };
  ingested: ReviewIngestedSnapshot;
}

interface DerivedReviewNarrative {
  conclusion: string;
  keyStrengths: string[];
  keyRisks: string[];
  nextActions: string[];
}

interface IngestedDocument {
  title?: string;
  abstract?: string;
  methodology?: string;
  experimentDesign?: string;
  results?: string;
  conclusion?: string;
  referenceCount?: number;
  figureCount?: number;
  claimedContributions?: string[];
  wordCount: number;
  paragraphCount: number;
  rawText: string;
}

@Injectable()
export class AiReviewService {
  private readonly logger = new Logger(AiReviewService.name);

  private readonly dimensionConfigs: Record<string, Array<{ name: string; weight: number }>> = {
    project: [
      { name: '创新性', weight: 0.25 },
      { name: '科学性', weight: 0.25 },
      { name: '可行性', weight: 0.2 },
      { name: '应用价值', weight: 0.15 },
      { name: '规范性', weight: 0.15 },
    ],
    paper: [
      { name: '创新性', weight: 0.3 },
      { name: '技术质量', weight: 0.25 },
      { name: '写作质量', weight: 0.2 },
      { name: '相关性', weight: 0.15 },
      { name: '完整性', weight: 0.1 },
    ],
  };

  constructor(
    private prisma: PrismaService,
    private dualRouteService: DualRouteService,
    private llmService: LlmService,
  ) {}

  async createTask(
    dto: { type: string; fileName: string; filePath: string; kbId?: string },
    userId: string,
  ) {
    return this.prisma.aIReviewTask.create({
      data: {
        userId,
        type: dto.type,
        fileName: dto.fileName,
        filePath: dto.filePath,
        kbId: dto.kbId,
        status: 'pending',
      },
    });
  }

  async runReview(taskId: string) {
    const task = await this.getTaskById(taskId);

    await this.prisma.aIReviewTask.update({
      where: { id: taskId },
      data: { status: 'processing' },
    });

    try {
      const text = await this.parseFile(task.filePath);
      const ingested = await this.ingestDocument(text);
      const dimensions = this.dimensionConfigs[task.type] || this.dimensionConfigs.paper;
      const scores: DimensionScore[] = [];

      for (const dim of dimensions) {
        const score = await this.evaluateDimension(
          task.type,
          dim.name,
          dim.weight,
          ingested,
          task.kbId || undefined,
        );
        scores.push(score);
      }

      const overallScore = Number(
        scores.reduce((sum, score) => sum + score.score * score.weight, 0).toFixed(1),
      );
      const recommendation = this.resolveRecommendation(overallScore);
      const summary =
        (await this.generateSummary(ingested, overallScore, recommendation, scores)) ||
        this.buildFallbackSummary(overallScore, recommendation, scores);

      const report = this.buildReviewReport({
        overallScore,
        recommendation,
        summary,
        dimensions: scores,
        ingested: {
          title: ingested.title,
          abstract: ingested.abstract,
        },
      });

      await this.prisma.aIReviewTask.update({
        where: { id: taskId },
        data: {
          report: JSON.parse(JSON.stringify(report)),
          overallScore,
          recommendation,
          status: 'completed',
          errorMessage: null,
        },
      });

      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI review failed';

      this.logger.error(`AI review failed for task ${taskId}: ${message}`);
      await this.prisma.aIReviewTask.update({
        where: { id: taskId },
        data: { status: 'failed', errorMessage: message },
      });
      throw error;
    }
  }

  private async ingestDocument(text: string): Promise<IngestedDocument> {
    const llmResult = await this.safeGenerate(
      [
        {
          role: 'system',
          content:
            '提取论文或项目书的结构化信息，返回 JSON：{"title":"","abstract":"","methodology":"","experimentDesign":"","results":"","conclusion":"","referenceCount":0,"figureCount":0,"claimedContributions":[]}',
        },
        { role: 'user', content: text.slice(0, 7000) },
      ],
      0.2,
      'ingestDocument',
    );

    const parsed = this.parseJsonResponse(llmResult?.answer || '');
    if (parsed) {
      return {
        title: this.toNonEmptyString(parsed.title) || this.extractTitle(text),
        abstract: this.toNonEmptyString(parsed.abstract) || this.extractSection(text, ['abstract', '摘要']),
        methodology:
          this.toNonEmptyString(parsed.methodology) ||
          this.extractSection(text, ['methodology', 'method', 'approach', '方法', '研究方法', '技术路线']),
        experimentDesign:
          this.toNonEmptyString(parsed.experimentDesign) ||
          this.extractSection(text, ['experiment', 'evaluation', '实验', '评估', '实验设计']),
        results:
          this.toNonEmptyString(parsed.results) ||
          this.extractSection(text, ['results', 'discussion', '实验结果', '结果分析']),
        conclusion:
          this.toNonEmptyString(parsed.conclusion) ||
          this.extractSection(text, ['conclusion', '结论', '总结']),
        referenceCount: this.toNumber(parsed.referenceCount) ?? this.countReferences(text),
        figureCount: this.toNumber(parsed.figureCount) ?? this.countFigures(text),
        claimedContributions:
          this.toStringArray(parsed.claimedContributions).length > 0
            ? this.toStringArray(parsed.claimedContributions)
            : this.extractClaimedContributions(text),
        wordCount: this.countWords(text),
        paragraphCount: this.countParagraphs(text),
        rawText: text,
      };
    }

    return this.buildHeuristicIngestedDocument(text);
  }

  private buildHeuristicIngestedDocument(text: string): IngestedDocument {
    return {
      title: this.extractTitle(text),
      abstract: this.extractSection(text, ['abstract', '摘要']) || text.slice(0, 500).trim(),
      methodology: this.extractSection(text, [
        'methodology',
        'method',
        'approach',
        '方法',
        '研究方法',
        '技术路线',
      ]),
      experimentDesign: this.extractSection(text, [
        'experiment',
        'evaluation',
        '实验',
        '评估',
        '实验设计',
      ]),
      results: this.extractSection(text, ['results', 'discussion', '实验结果', '结果分析']),
      conclusion: this.extractSection(text, ['conclusion', '结论', '总结']),
      referenceCount: this.countReferences(text),
      figureCount: this.countFigures(text),
      claimedContributions: this.extractClaimedContributions(text),
      wordCount: this.countWords(text),
      paragraphCount: this.countParagraphs(text),
      rawText: text,
    };
  }

  private async evaluateDimension(
    taskType: string,
    dimension: string,
    weight: number,
    document: IngestedDocument,
    kbId?: string,
  ): Promise<DimensionScore> {
    const reference = await this.safeReferenceQuery(
      `${document.title || '文档'} ${dimension} 评审标准`,
      kbId,
    );
    const llmResult = await this.safeGenerate(
      [
        {
          role: 'system',
          content: `你是“${dimension}”维度的评审专家。请基于文档内容${
            reference ? '及补充参考' : ''
          }给出 0-100 分，并返回 JSON：{"score":80,"evidence":["..."],"strengths":["..."],"weaknesses":["..."],"suggestions":["..."]}`,
        },
        {
          role: 'user',
          content: [
            `标题：${document.title || '未命名文档'}`,
            `摘要：${document.abstract || ''}`,
            `方法：${document.methodology || ''}`,
            `实验：${document.experimentDesign || ''}`,
            `结果：${document.results || ''}`,
            reference ? `补充参考：${reference.slice(0, 1600)}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      0.3,
      `evaluateDimension:${dimension}`,
    );

    const parsed = this.parseJsonResponse(llmResult?.answer || '');
    if (parsed) {
      return {
        dimension,
        weight,
        score: this.clampScore(this.toNumber(parsed.score) ?? 60),
        evidence: this.limitStrings(this.toStringArray(parsed.evidence), 4),
        strengths: this.limitStrings(this.toStringArray(parsed.strengths), 4),
        weaknesses: this.limitStrings(this.toStringArray(parsed.weaknesses), 4),
        suggestions: this.limitStrings(this.toStringArray(parsed.suggestions), 4),
      };
    }

    return this.buildHeuristicDimensionScore(taskType, dimension, weight, document, reference);
  }

  private buildHeuristicDimensionScore(
    taskType: string,
    dimension: string,
    weight: number,
    document: IngestedDocument,
    reference: string,
  ): DimensionScore {
    const hasAbstract = Boolean(document.abstract);
    const hasMethod = Boolean(document.methodology);
    const hasExperiment = Boolean(document.experimentDesign);
    const hasResults = Boolean(document.results);
    const hasConclusion = Boolean(document.conclusion);
    const contributionCount = document.claimedContributions?.length || 0;
    const referenceCount = document.referenceCount || 0;
    const figureCount = document.figureCount || 0;
    const wordCount = document.wordCount || 0;
    const paragraphCount = document.paragraphCount || 0;
    const referenceAlignment = reference
      ? this.computeTextOverlap(
          `${document.title || ''} ${document.abstract || ''} ${document.methodology || ''}`,
          reference,
        )
      : 0;
    const deliveryCue = /milestone|schedule|dataset|resource|benchmark|阶段|计划|资源|数据集|交付|里程碑/i.test(
      document.rawText,
    );
    const applicationCue = /application|deployment|industry|scenario|impact|应用|落地|场景|产业|价值/i.test(
      document.rawText,
    );

    let score = 60;
    const evidence: string[] = [];
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const suggestions: string[] = [];

    switch (dimension) {
      case '创新性':
        score = 58 + contributionCount * 7 + (hasMethod ? 6 : -4) + referenceAlignment * 12;
        evidence.push(
          contributionCount > 0
            ? `检测到 ${contributionCount} 条贡献或方案主张。`
            : '未检测到清晰的贡献条目，需要人工确认创新点边界。',
        );
        if (document.title) {
          evidence.push(`标题聚焦于“${document.title}”。`);
        }
        if (contributionCount >= 2) {
          strengths.push('文档已经显式提出多个可辨识的贡献点。');
        } else {
          weaknesses.push('创新点呈现仍然偏弱，贡献边界不够清楚。');
          suggestions.push('增加“贡献点/创新点”小节，用 2-3 条明确说明相对现有工作的差异。');
        }
        if (!hasMethod) {
          weaknesses.push('方法细节不足，导致创新性难以和现有方案区分。');
          suggestions.push('补充关键设计、流程和机制，让创新点能落到实现层。');
        }
        break;
      case '科学性':
        score =
          54 +
          (hasMethod ? 14 : -8) +
          (hasExperiment ? 10 : -6) +
          (hasResults ? 6 : 0) +
          Math.min(referenceCount, 12) * 1.2;
        evidence.push(
          hasMethod ? '文档包含方法或技术路线描述。' : '文档缺少完整的方法或技术路线说明。',
        );
        evidence.push(
          hasExperiment ? '文档包含实验或验证设计。' : '文档缺少明确的验证设计。',
        );
        if (hasMethod && hasExperiment) {
          strengths.push('问题、方法与验证链条基本闭合。');
        }
        if (!hasExperiment) {
          weaknesses.push('验证链条偏弱，科学性主要停留在论述层。');
          suggestions.push('补充实验设置、指标、对比对象或预期验证方式。');
        }
        if (referenceCount < 5) {
          weaknesses.push('参考文献或外部依据偏少，论证支撑不足。');
          suggestions.push('增加与主题直接相关的代表性文献或数据依据。');
        }
        break;
      case '可行性':
        score =
          57 +
          (hasMethod ? 10 : -5) +
          (deliveryCue ? 10 : -4) +
          (hasExperiment ? 6 : 0) +
          Math.min(wordCount / 500, 8);
        evidence.push(deliveryCue ? '文档出现计划、资源或交付相关表述。' : '交付路径描述仍然偏弱。');
        evidence.push(
          hasMethod ? '技术路线可以支撑可行性评估。' : '缺少方法细节，难以判断执行落地。',
        );
        if (deliveryCue) {
          strengths.push('可行性判断不只停留在目标层，已经触及执行与资源。');
        } else {
          weaknesses.push('资源、时间、数据或执行安排说明不够具体。');
          suggestions.push('增加阶段目标、资源依赖、风险与备选方案。');
        }
        break;
      case '应用价值':
        score =
          56 +
          (applicationCue ? 14 : -2) +
          (hasResults ? 6 : 0) +
          (hasConclusion ? 4 : 0) +
          referenceAlignment * 8;
        evidence.push(
          applicationCue ? '文档直接讨论应用场景、部署或业务价值。' : '应用价值主要停留在泛化描述。',
        );
        if (applicationCue) {
          strengths.push('场景价值和落地收益表达较明确。');
        } else {
          weaknesses.push('应用场景、用户对象或价值指标还不够具体。');
          suggestions.push('明确目标用户、使用场景和业务/学术价值指标。');
        }
        break;
      case '规范性':
        score =
          55 +
          (hasAbstract ? 8 : -4) +
          (hasConclusion ? 8 : -4) +
          Math.min(referenceCount, 10) * 1.4 +
          (figureCount > 0 ? 4 : 0) +
          Math.min(paragraphCount / 4, 8);
        evidence.push(`检测到约 ${referenceCount} 条参考标记，图表线索 ${figureCount} 处。`);
        if (hasAbstract && hasConclusion) {
          strengths.push('文档首尾结构较完整，便于评审快速理解。');
        } else {
          weaknesses.push('摘要或结论缺失，规范性和可读性受影响。');
          suggestions.push('补齐摘要、结论和引用格式，让整体结构更像可评审稿。');
        }
        break;
      case '技术质量':
        score =
          53 +
          (hasMethod ? 16 : -10) +
          (hasExperiment ? 12 : -8) +
          (hasResults ? 8 : -3) +
          Math.min(referenceCount, 15) * 1.1;
        evidence.push(hasMethod ? '技术方案描述存在。' : '技术方案描述不足。');
        evidence.push(hasExperiment ? '实验评估部分存在。' : '实验评估部分不足。');
        if (hasMethod && hasExperiment && hasResults) {
          strengths.push('方法、实验和结果基本形成完整技术链路。');
        }
        if (!hasExperiment || !hasResults) {
          weaknesses.push('缺少足够实验或结果支撑，技术质量说服力不足。');
          suggestions.push('补充 baseline、指标、消融或关键结果分析。');
        }
        break;
      case '写作质量':
        score =
          58 +
          (hasAbstract ? 8 : -4) +
          (hasConclusion ? 8 : -3) +
          Math.min(paragraphCount / 5, 8) +
          Math.min(wordCount / 800, 8);
        evidence.push(`文档约 ${wordCount} 词 / 字级内容，段落数约 ${paragraphCount}。`);
        if (hasAbstract && hasConclusion) {
          strengths.push('摘要和结论存在，整体叙事框架更完整。');
        }
        if (wordCount < 700) {
          weaknesses.push('正文偏短，很多论点尚未展开。');
          suggestions.push('扩展核心论证段，减少口号式表述，增加证据链。');
        }
        break;
      case '相关性':
        score = 62 + (hasAbstract ? 8 : -2) + referenceAlignment * 15 + (document.title ? 5 : 0);
        evidence.push(
          reference
            ? `与参考标准的语义重合度约为 ${(referenceAlignment * 100).toFixed(0)}%。`
            : '没有额外领域参考，相关性主要依据文档自身主题判断。',
        );
        if (document.title && document.abstract) {
          strengths.push('标题与摘要能共同支撑主题聚焦。');
        }
        if (!document.abstract) {
          weaknesses.push('摘要缺失，评审难以快速确认主题边界。');
          suggestions.push('补一段摘要，说明研究问题、方法和适用场景。');
        }
        break;
      case '完整性':
        score =
          42 +
          (hasAbstract ? 14 : 0) +
          (hasMethod ? 14 : 0) +
          (hasExperiment ? 10 : 0) +
          (hasResults ? 8 : 0) +
          (hasConclusion ? 8 : 0) +
          Math.min(referenceCount, 8);
        evidence.push(
          `摘要:${hasAbstract ? '有' : '缺'} 方法:${hasMethod ? '有' : '缺'} 实验:${hasExperiment ? '有' : '缺'} 结果:${hasResults ? '有' : '缺'} 结论:${hasConclusion ? '有' : '缺'}`,
        );
        if (hasAbstract && hasMethod && hasExperiment && hasConclusion) {
          strengths.push('核心章节较齐全，已具备完整评审稿雏形。');
        } else {
          weaknesses.push('关键章节还没有完全闭合，完整性不足。');
          suggestions.push('优先补齐缺失章节，再做更细的技术和表达优化。');
        }
        break;
      default:
        score = 60;
        evidence.push('当前维度没有专门启发式规则，使用通用评分。');
        suggestions.push('补充更明确的结构和证据，让下次评审更稳定。');
        break;
    }

    if (taskType === 'project' && dimension === '科学性' && !applicationCue && hasMethod) {
      strengths.push('项目论证更偏研究导向，而非单纯业务口径。');
    }

    if (taskType === 'paper' && dimension === '完整性' && referenceCount < 5) {
      weaknesses.push('参考文献数量偏少，论文形态仍不够完整。');
      suggestions.push('补充关键参考文献并建立 related work 对照。');
    }

    score = this.clampScore(score);

    return {
      dimension,
      weight,
      score,
      evidence: this.limitStrings(this.dedupeStrings(evidence), 4),
      strengths: this.limitStrings(this.dedupeStrings(strengths), 4),
      weaknesses: this.limitStrings(this.dedupeStrings(weaknesses), 4),
      suggestions: this.limitStrings(this.dedupeStrings(suggestions), 4),
    };
  }

  async getStatus(id: string, userId: string) {
    const task = await this.getOwnedTask(id, userId);
    return {
      id: task.id,
      status: task.status,
      overallScore: task.overallScore,
      recommendation: task.recommendation,
      errorMessage: task.errorMessage,
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  async getReport(id: string, userId: string) {
    const task = await this.getOwnedTask(id, userId);
    return this.hydrateReviewReport(task.report, {
      overallScore: task.overallScore,
      recommendation: task.recommendation,
    });
  }

  async list(userId: string, query: ListAiReviewDto = {}) {
    const pageNo = query.pageNo || 1;
    const pageSize = query.pageSize || 10;
    const where: Prisma.AIReviewTaskWhereInput = {
      userId,
    };
    const trimmedSearchKey = query.searchKey?.trim();

    if (trimmedSearchKey) {
      where.fileName = { contains: trimmedSearchKey, mode: 'insensitive' };
    }

    if (query.docType && query.docType !== 'all') {
      where.type = query.docType;
    }

    const timeRange = this.resolveTimeRange(query.checkTime);
    if (timeRange) {
      where.createdAt = timeRange;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.aIReviewTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.aIReviewTask.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        docType: item.type,
        name: item.fileName.replace(/\.[^.]+$/, ''),
        fileName: item.fileName,
        kbId: item.kbId,
        uploadedAt: item.createdAt,
        updatedAt: item.updatedAt,
        status: item.status,
        overallScore: item.overallScore,
        recommendation: item.recommendation,
        reportReady: Boolean(item.report),
        report: item.report
          ? this.hydrateReviewReport(item.report, {
              overallScore: item.overallScore,
              recommendation: item.recommendation,
            })
          : null,
        hasKbBinding: Boolean(item.kbId),
        errorMessage: item.errorMessage,
      })),
      total,
      pageNo,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async delete(id: string, userId: string) {
    await this.getOwnedTask(id, userId);
    return this.prisma.aIReviewTask.delete({ where: { id } });
  }

  private async generateSummary(
    ingested: IngestedDocument,
    overallScore: number,
    recommendation: string,
    scores: DimensionScore[],
  ) {
    const llmResult = await this.safeGenerate(
      [
        {
          role: 'system',
          content:
            '你是资深评审专家。请根据各维度评分，输出 300 字以内的综合评审意见，突出结论、优势和主要风险。',
        },
        {
          role: 'user',
          content: `标题：${ingested.title || '未命名文档'}
综合评分：${overallScore.toFixed(1)}
建议：${recommendation}
维度：${JSON.stringify(
  scores.map((item) => ({
    dimension: item.dimension,
    score: item.score,
    strengths: item.strengths,
    weaknesses: item.weaknesses,
  })),
)}`,
        },
      ],
      0.4,
      'generateSummary',
    );

    return this.toNonEmptyString(llmResult?.answer);
  }

  private async safeReferenceQuery(question: string, kbId?: string) {
    if (!kbId?.trim()) {
      return '';
    }

    try {
      const result = await this.dualRouteService.query(question, kbId);
      return this.toNonEmptyString(result.answer) || '';
    } catch (error) {
      this.logger.warn(`Review reference fallback activated: ${this.getErrorMessage(error)}`);
      return '';
    }
  }

  private async safeGenerate(
    messages: LlmMessage[],
    temperature: number,
    stage: string,
  ): Promise<LlmResponse | null> {
    try {
      return await this.llmService.generate(messages, temperature);
    } catch (error) {
      this.logger.warn(`Review LLM fallback activated at ${stage}: ${this.getErrorMessage(error)}`);
      return null;
    }
  }

  private buildReviewReport(input: {
    overallScore: number;
    recommendation: string;
    summary: string;
    dimensions: DimensionScore[];
    ingested?: ReviewIngestedSnapshot;
  }): ReviewReport {
    const normalizedSummary = this.toNonEmptyString(input.summary) ?? '';
    const normalizedDimensions = this.normalizeDimensionScores(input.dimensions);
    const narrative = this.deriveReviewNarrative({
      overallScore: input.overallScore,
      recommendation: input.recommendation,
      summary: normalizedSummary,
      dimensions: normalizedDimensions,
    });

    return {
      overallScore: input.overallScore,
      recommendation: input.recommendation,
      summary: normalizedSummary,
      dimensions: normalizedDimensions,
      conclusion: narrative.conclusion,
      keyStrengths: narrative.keyStrengths,
      keyRisks: narrative.keyRisks,
      nextActions: narrative.nextActions,
      radarChartData: {
        labels: normalizedDimensions.map((item) => item.dimension),
        scores: normalizedDimensions.map((item) => item.score),
      },
      ingested: {
        title: this.toNonEmptyString(input.ingested?.title),
        abstract: this.toNonEmptyString(input.ingested?.abstract),
      },
    };
  }

  private hydrateReviewReport(
    rawReport: Prisma.JsonValue | null,
    fallback: {
      overallScore?: number | null;
      recommendation?: string | null;
    } = {},
  ): ReviewReport | null {
    const reportRecord = this.toRecord(rawReport);
    if (!reportRecord) {
      return null;
    }

    const dimensions = this.normalizeDimensionScores(reportRecord.dimensions);
    const overallScore =
      this.toNumber(reportRecord.overallScore) ??
      (typeof fallback.overallScore === 'number' ? fallback.overallScore : undefined) ??
      this.calculateOverallScore(dimensions) ??
      0;
    const recommendation =
      this.toNonEmptyString(reportRecord.recommendation) ??
      this.toNonEmptyString(fallback.recommendation) ??
      this.resolveRecommendation(overallScore);
    const summary =
      this.toNonEmptyString(reportRecord.summary) ??
      this.buildFallbackSummary(overallScore, recommendation, dimensions);
    const derivedNarrative = this.deriveReviewNarrative({
      overallScore,
      recommendation,
      summary,
      dimensions,
    });
    const ingestedRecord = this.toRecord(reportRecord.ingested);

    return {
      overallScore,
      recommendation,
      summary,
      dimensions,
      conclusion:
        this.pickFirstString(
          reportRecord.conclusion,
          reportRecord.finalConclusion,
          reportRecord.decisionConclusion,
        ) ?? derivedNarrative.conclusion,
      keyStrengths: this.pickFirstStringArray(
        reportRecord.keyStrengths,
        reportRecord.highlights,
        reportRecord.topStrengths,
        derivedNarrative.keyStrengths,
      ),
      keyRisks: this.pickFirstStringArray(
        reportRecord.keyRisks,
        reportRecord.risks,
        reportRecord.blockers,
        reportRecord.keyWeaknesses,
        derivedNarrative.keyRisks,
      ),
      nextActions: this.pickFirstStringArray(
        reportRecord.nextActions,
        reportRecord.actions,
        reportRecord.actionItems,
        reportRecord.followUps,
        derivedNarrative.nextActions,
      ),
      radarChartData: this.normalizeRadarChartData(reportRecord.radarChartData, dimensions),
      ingested: {
        title: this.toNonEmptyString(ingestedRecord?.title),
        abstract: this.toNonEmptyString(ingestedRecord?.abstract),
      },
    };
  }

  private deriveReviewNarrative(input: {
    overallScore: number;
    recommendation: string;
    summary: string;
    dimensions: DimensionScore[];
  }): DerivedReviewNarrative {
    const sortedByScoreDesc = [...input.dimensions].sort(
      (left, right) => right.score - left.score || right.weight - left.weight,
    );
    const sortedByScoreAsc = [...input.dimensions].sort(
      (left, right) => left.score - right.score || right.weight - left.weight,
    );
    const strongDimensions = sortedByScoreDesc.filter((item) => item.score >= 75);
    const weakDimensions = sortedByScoreAsc.filter((item) => item.score < 75);

    const keyStrengths = this.limitStrings(
      this.dedupeStrings([
        ...strongDimensions.flatMap((item) =>
          item.strengths.map((strength) => this.prefixDimension(item.dimension, strength)),
        ),
        ...sortedByScoreDesc.slice(0, 2).map(
          (item) => `${item.dimension} 得分 ${item.score.toFixed(0)}，当前表现相对稳定。`,
        ),
      ]),
      4,
    );

    const keyRisks = this.limitStrings(
      this.dedupeStrings([
        ...weakDimensions.flatMap((item) =>
          item.weaknesses.map((risk) => this.prefixDimension(item.dimension, risk)),
        ),
        ...weakDimensions.flatMap((item) =>
          item.suggestions.slice(0, 1).map((suggestion) => `${item.dimension}: ${suggestion}`),
        ),
        ...sortedByScoreAsc.slice(0, 2).map(
          (item) => `${item.dimension} 当前得分 ${item.score.toFixed(0)}，是本轮评审的主要压力点。`,
        ),
      ]),
      4,
    );

    const strongDimensionNames = this.joinDimensionNames(strongDimensions.slice(0, 2));
    const weakDimensionNames = this.joinDimensionNames(weakDimensions.slice(0, 2));
    const summarySnippet = this.toSentenceSnippet(input.summary);
    const conclusion = [
      this.buildRecommendationLead(input.recommendation, input.overallScore),
      strongDimensionNames
        ? `当前最稳的维度是 ${strongDimensionNames}。`
        : '当前没有明显的单点强项，整体更多依赖均衡度。',
      weakDimensionNames
        ? `主要评审压力集中在 ${weakDimensionNames}。`
        : '当前没有特别突出的阻塞维度。',
      summarySnippet ? `综合摘要信号：${summarySnippet}` : undefined,
    ]
      .filter((item): item is string => Boolean(item))
      .join(' ');

    const nextActions = this.limitStrings(
      this.dedupeStrings([
        ...this.buildRecommendationActions(input.recommendation, weakDimensions),
        ...weakDimensions.flatMap((item) =>
          item.suggestions
            .slice(0, 1)
            .map((suggestion) => this.formatAction(item.dimension, suggestion)),
        ),
        ...sortedByScoreAsc
          .filter((item) => item.evidence.length === 0)
          .slice(0, 1)
          .map((item) => `为 ${item.dimension} 增加更明确的证据，以降低下一轮评审的不确定性。`),
      ]),
      4,
    );

    return {
      conclusion,
      keyStrengths:
        keyStrengths.length > 0
          ? keyStrengths
          : [`总体得分 ${input.overallScore.toFixed(1)}，说明文档仍然具备继续打磨的基础。`],
      keyRisks:
        keyRisks.length > 0
          ? keyRisks
          : [
              input.recommendation === '录用'
                ? '当前没有暴露出明显阻塞风险。'
                : `当前建议为“${input.recommendation}”，说明仍有待解决的评审风险。`,
            ],
      nextActions:
        nextActions.length > 0
          ? nextActions
          : ['优先处理最低分维度，再进入下一轮精修和复审。'],
    };
  }

  private normalizeDimensionScores(value: unknown): DimensionScore[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((item) => {
      const record = this.toRecord(item);

      return {
        dimension: this.toNonEmptyString(record?.dimension) ?? 'Unknown dimension',
        weight: this.toNumber(record?.weight) ?? 0,
        score: this.toNumber(record?.score) ?? 0,
        evidence: this.toStringArray(record?.evidence),
        strengths: this.toStringArray(record?.strengths),
        weaknesses: this.toStringArray(record?.weaknesses),
        suggestions: this.toStringArray(record?.suggestions),
      };
    });
  }

  private normalizeRadarChartData(
    value: unknown,
    dimensions: DimensionScore[],
  ): ReviewReport['radarChartData'] {
    const record = this.toRecord(value);
    const labels = this.toStringArray(record?.labels);
    const scores = Array.isArray(record?.scores)
      ? record.scores.filter((item): item is number => typeof item === 'number')
      : [];

    if (labels.length > 0 && scores.length > 0) {
      return { labels, scores };
    }

    return {
      labels: dimensions.map((item) => item.dimension),
      scores: dimensions.map((item) => item.score),
    };
  }

  private calculateOverallScore(dimensions: DimensionScore[]): number | undefined {
    if (dimensions.length === 0) {
      return undefined;
    }

    const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight > 0) {
      return Number(
        dimensions.reduce((sum, item) => sum + item.score * item.weight, 0).toFixed(1),
      );
    }

    return Number(
      (dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length).toFixed(1),
    );
  }

  private resolveRecommendation(overallScore: number): string {
    if (overallScore >= 80) {
      return '录用';
    }

    if (overallScore >= 60) {
      return '修改后录用';
    }

    return '拒稿';
  }

  private buildFallbackSummary(
    overallScore: number,
    recommendation: string,
    dimensions: DimensionScore[],
  ): string {
    const weakestDimensions = this.joinDimensionNames(
      [...dimensions]
        .sort((left, right) => left.score - right.score || right.weight - left.weight)
        .slice(0, 2),
    );
    const strongestDimensions = this.joinDimensionNames(
      [...dimensions]
        .sort((left, right) => right.score - left.score || right.weight - left.weight)
        .slice(0, 2),
    );

    return [
      `综合得分 ${overallScore.toFixed(1)}，当前建议为“${recommendation}”。`,
      strongestDimensions ? `相对稳健的维度包括 ${strongestDimensions}。` : '',
      weakestDimensions ? `当前主要短板集中在 ${weakestDimensions}。` : '',
      '该结论基于本地启发式评审生成，适合作为继续打磨文档的工作底稿。',
    ]
      .filter(Boolean)
      .join(' ');
  }

  private buildRecommendationLead(recommendation: string, overallScore: number): string {
    switch (recommendation) {
      case '录用':
        return `建议：录用。综合得分 ${overallScore.toFixed(1)}，当前稿件已经具备较强竞争力。`;
      case '修改后录用':
        return `建议：修改后录用。综合得分 ${overallScore.toFixed(1)}，稿件有潜力，但仍需要一轮针对性强化。`;
      case '拒稿':
        return `建议：拒稿。综合得分 ${overallScore.toFixed(1)}，当前仍有核心阻塞问题未解决。`;
      default:
        return `建议：${recommendation}。综合得分 ${overallScore.toFixed(1)}。`;
    }
  }

  private buildRecommendationActions(
    recommendation: string,
    weakDimensions: DimensionScore[],
  ): string[] {
    const weakDimensionNames = this.joinDimensionNames(weakDimensions.slice(0, 2));

    switch (recommendation) {
      case '录用':
        return [
          '准备最终提交版本，并保持当前高分维度的论证链不被破坏。',
          weakDimensionNames
            ? `对 ${weakDimensionNames} 做轻量清理，降低后续评审波动。`
            : '对摘要、图表、引用和结论做一次一致性检查。',
        ];
      case '修改后录用':
        return [
          weakDimensionNames
            ? `优先围绕 ${weakDimensionNames} 做一轮集中修订。`
            : '先完成一轮针对性修订，再进入下一次评审。',
          '用更清晰的证据、实验或评审可读性解释强化最弱主张。',
        ];
      case '拒稿':
        return [
          weakDimensionNames
            ? `先重构 ${weakDimensionNames} 相关内容，再考虑重新提交。`
            : '先重做最低分维度，再考虑下一轮提交。',
          '重建主张背后的证据链，避免下一轮继续被相同问题卡住。',
        ];
      default:
        return ['优先处理最低分维度，再准备下一轮更清晰的评审版本。'];
    }
  }

  private parseJsonResponse(value: string): Record<string, unknown> | null {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    const candidates = [
      normalized,
      normalized.replace(/^```json\s*/iu, '').replace(/^```\s*/u, '').replace(/\s*```$/u, ''),
    ];

    const firstBrace = normalized.indexOf('{');
    const lastBrace = normalized.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(normalized.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        const record = this.toRecord(parsed);
        if (record) {
          return record;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private toNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => this.toNonEmptyString(item))
      .filter((item): item is string => Boolean(item));
  }

  private pickFirstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      const normalized = this.toNonEmptyString(value);
      if (normalized) {
        return normalized;
      }
    }

    return undefined;
  }

  private pickFirstStringArray(...values: unknown[]): string[] {
    for (const value of values) {
      const normalized = this.toStringArray(value);
      if (normalized.length > 0) {
        return normalized;
      }
    }

    return [];
  }

  private dedupeStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
      const normalized = value.trim();
      if (!normalized) {
        continue;
      }

      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(normalized);
    }

    return result;
  }

  private limitStrings(values: string[], limit: number): string[] {
    return values.slice(0, limit);
  }

  private prefixDimension(dimension: string, text: string): string {
    return text.includes(dimension) ? text : `${dimension}: ${text}`;
  }

  private joinDimensionNames(dimensions: DimensionScore[]): string {
    return dimensions.map((item) => item.dimension).filter(Boolean).join('、');
  }

  private formatAction(dimension: string, suggestion: string): string {
    if (suggestion.toLowerCase().includes(dimension.toLowerCase())) {
      return suggestion;
    }

    return `优先处理 ${dimension}：${suggestion}`;
  }

  private toSentenceSnippet(summary: string): string | undefined {
    const normalized = this.toNonEmptyString(summary);
    if (!normalized) {
      return undefined;
    }

    const firstSentence = normalized.split(/(?<=[.!?。！？])/u)[0]?.trim() || normalized;
    return firstSentence.length > 180 ? `${firstSentence.slice(0, 177)}...` : firstSentence;
  }

  private clampScore(score: number) {
    return Number(Math.max(35, Math.min(95, score)).toFixed(1));
  }

  private extractTitle(text: string) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const firstMeaningful = lines.find((line) => line.length >= 4 && line.length <= 120);
    return firstMeaningful || '未命名文档';
  }

  private extractSection(text: string, aliases: string[]) {
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) {
        continue;
      }

      const normalized = this.normalizeHeading(line);
      if (!aliases.some((alias) => normalized.includes(alias.toLowerCase()))) {
        continue;
      }

      const collected: string[] = [];
      for (let inner = index + 1; inner < lines.length; inner += 1) {
        const current = lines[inner];
        if (!current) {
          if (collected.length > 0) {
            break;
          }
          continue;
        }

        if (this.isLikelyHeading(current) && collected.length > 0) {
          break;
        }

        collected.push(current);
        if (collected.join(' ').length >= 900) {
          break;
        }
      }

      const result = collected.join(' ').trim();
      if (result) {
        return result.slice(0, 1200);
      }
    }

    return '';
  }

  private normalizeHeading(value: string) {
    return value
      .replace(/^#+\s*/u, '')
      .replace(/^[\d一二三四五六七八九十.、()（）\-\s]+/u, '')
      .toLowerCase();
  }

  private isLikelyHeading(value: string) {
    const normalized = this.normalizeHeading(value);
    return /^(abstract|introduction|related work|method|methodology|approach|experiment|evaluation|results|discussion|conclusion|references|摘要|引言|相关工作|方法|实验|结果|结论|参考文献)/i.test(
      normalized,
    );
  }

  private extractClaimedContributions(text: string) {
    const matches = text.match(
      /(we propose|we present|our contributions are|本文提出|主要贡献|创新点)[^。.\n]{0,180}/giu,
    );

    if (!matches) {
      return [];
    }

    return this.limitStrings(
      this.dedupeStrings(matches.map((item) => item.replace(/\s+/g, ' ').trim())),
      4,
    );
  }

  private countReferences(text: string) {
    const citationMatches = text.match(/\[\d+\]/g) || [];
    const referenceSection = this.extractSection(text, ['references', '参考文献']);
    const lineMatches = referenceSection.match(/(^|\n)\s*(\[\d+\]|\d+\.)/g) || [];

    return Math.max(citationMatches.length, lineMatches.length);
  }

  private countFigures(text: string) {
    return (text.match(/\b(fig(?:ure)?\.?\s*\d+|图\s*\d+)/giu) || []).length;
  }

  private countWords(text: string) {
    const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return Math.max(cjkCount, wordCount);
  }

  private countParagraphs(text: string) {
    return text
      .split(/\n\s*\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean).length;
  }

  private computeTextOverlap(left: string, right: string) {
    const leftTokens = this.tokenize(left);
    const rightTokens = this.tokenize(right);
    if (leftTokens.length === 0 || rightTokens.length === 0) {
      return 0;
    }

    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
    const union = new Set([...leftSet, ...rightSet]).size;
    return union > 0 ? intersection / union : 0;
  }

  private tokenize(text: string) {
    return (text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g) || []).filter(Boolean);
  }

  private async parseFile(filePath: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    if (filePath.endsWith('.pdf')) {
      const data = await pdfParse(buffer);
      return data.text;
    }

    return buffer.toString('utf-8');
  }

  private async getTask(id: string) {
    const task = await this.prisma.aIReviewTask.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException('评审任务不存在。');
    }

    return task;
  }

  private async getTaskById(id: string) {
    return this.getTask(id);
  }

  private async getOwnedTask(id: string, userId: string) {
    const task = await this.prisma.aIReviewTask.findFirst({ where: { id, userId } });
    if (!task) {
      throw new NotFoundException('Review task not found.');
    }

    return task;
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return 'unknown error';
  }

  private resolveTimeRange(
    checkTime?: 'all' | '7d' | '30d' | '180d' | '365d' | 'older',
  ) {
    const now = new Date();

    if (!checkTime || checkTime === 'all') {
      return undefined;
    }

    const date = new Date(now);

    switch (checkTime) {
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
