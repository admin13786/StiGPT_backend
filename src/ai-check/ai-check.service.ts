import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RetrievalService } from '../rag/retrieval.service';
import { RerankCandidate, RerankService } from '../rag/rerank.service';
import { LlmResponse, LlmService } from '../rag/llm.service';
import { ListAiCheckDto } from './dto/list-ai-check.dto';
import * as fs from 'fs';

const pdfParse = require('pdf-parse');

interface ParagraphCheckResult {
  paragraphIndex: number;
  paragraph: string;
  isDuplicate: boolean;
  similarity: number;
  matchedSource?: { title: string; content: string };
  judgement?: string;
  confidence?: number;
  suggestion?: string;
  reviewAction?: string;
}

interface CreateTaskDto {
  type: string;
  fileName: string;
  filePath: string;
  kbId?: string;
}

interface ReportMetrics {
  overallSimilarity: number;
  duplicateParagraphs: number;
  flaggedParagraphs: number;
  needsReviewParagraphs: number;
  lowConfidenceParagraphs: number;
  topSimilarity: number;
  topSourceTitle: string | null;
  riskLevel: 'high' | 'medium' | 'low' | 'clean' | 'unknown';
  attentionCount: number;
  watchCount: number;
  clearCount: number;
  confidenceAverage: number | null;
}

interface MatchCandidate {
  id: string;
  title: string;
  content: string;
  score: number;
  source: 'kb' | 'fallback';
}

interface HeuristicJudgement {
  judgement: string;
  confidence: number;
  suggestion: string;
  reviewAction: string;
}

@Injectable()
export class AiCheckService {
  private readonly logger = new Logger(AiCheckService.name);

  private readonly fallbackSources: Array<{ id: string; title: string; content: string }> = [
    {
      id: 'fallback-1',
      title: 'Survey on Retrieval-Augmented Question Answering',
      content:
        'Retrieval-augmented question answering combines external document search with generative reasoning. A typical pipeline retrieves candidate passages, reranks the evidence, and synthesizes an answer with explicit grounding so the model can reduce hallucination while keeping traceable citations.',
    },
    {
      id: 'fallback-2',
      title: 'Academic Writing Quality Guide',
      content:
        'A strong academic paragraph usually contains one clear claim, supporting evidence, and a short interpretation of why the evidence matters. Repeated wording without new reasoning often signals shallow paraphrasing rather than original analysis.',
    },
    {
      id: 'fallback-3',
      title: 'Research Proposal Evaluation Criteria',
      content:
        'Research proposals are often evaluated by innovation, feasibility, scientific significance, execution path, and measurable deliverables. Reviewers expect the problem statement, methodology, validation plan, and resource assumptions to align with each other.',
    },
    {
      id: 'fallback-4',
      title: 'Scientific Integrity and Citation Practice',
      content:
        'Reasonable citation requires the author to distinguish prior work from original contribution. When language or structure is borrowed too closely, the author should quote, cite explicitly, or rewrite the passage to avoid substantive duplication.',
    },
    {
      id: 'fallback-5',
      title: 'Experiment Design for Applied AI',
      content:
        'Applied AI evaluation normally compares the proposed method against competitive baselines, reports ablations, and explains why each metric reflects the intended capability. Without this chain, claims about superiority remain weak even when qualitative examples look convincing.',
    },
    {
      id: 'fallback-6',
      title: 'Knowledge Graph Product Note',
      content:
        'Knowledge graph systems organize entities, relations, and evidence chains into a structured graph. The graph helps connect papers, authors, institutions, topics, and citation links so users can move from isolated documents to navigable research context.',
    },
  ];

  constructor(
    private prisma: PrismaService,
    private retrievalService: RetrievalService,
    private rerankService: RerankService,
    private llmService: LlmService,
  ) {}

  async createTask(dto: CreateTaskDto, userId: string) {
    let content = '';

    try {
      if (dto.filePath.endsWith('.pdf')) {
        const buffer = fs.readFileSync(dto.filePath);
        const data = await pdfParse(buffer);
        content = data.text;
      } else {
        content = fs.readFileSync(dto.filePath, 'utf-8');
      }
    } catch (error: unknown) {
      this.logger.error('File parsing failed', this.getErrorMessage(error));
    }

    return this.prisma.aICheckTask.create({
      data: {
        userId,
        type: this.normalizeTaskType(dto.type),
        fileName: dto.fileName,
        filePath: dto.filePath,
        kbId: dto.kbId?.trim() || undefined,
        content,
        status: 'pending',
      },
    });
  }

  async runCheck(taskId: string) {
    const task = await this.getTaskById(taskId);
    if (!task.content?.trim()) {
      throw new Error('Missing document content.');
    }

    await this.prisma.aICheckTask.update({
      where: { id: taskId },
      data: { status: 'processing' },
    });

    try {
      const paragraphs = this.splitIntoParagraphs(task.content);
      const results: ParagraphCheckResult[] = [];

      for (let index = 0; index < paragraphs.length; index += 1) {
        const paragraph = paragraphs[index];
        if (paragraph.length < 50) {
          continue;
        }

        const result = await this.checkParagraph(paragraph, index, task.kbId || undefined);
        results.push(result);
      }

      const duplicateCount = results.filter((item) => item.isDuplicate).length;
      const totalChecked = results.length;
      const overallSimilarity = totalChecked > 0 ? duplicateCount / totalChecked : 0;
      const metrics = this.buildReportMetrics(results, totalChecked, overallSimilarity);

      const report = {
        overallSimilarity: metrics.overallSimilarity,
        totalParagraphs: totalChecked,
        duplicateParagraphs: metrics.duplicateParagraphs,
        details: results.filter((item) => item.isDuplicate || item.similarity > 0.7),
        flaggedParagraphs: metrics.flaggedParagraphs,
        needsReviewParagraphs: metrics.needsReviewParagraphs,
        lowConfidenceParagraphs: metrics.lowConfidenceParagraphs,
        topSimilarity: metrics.topSimilarity,
        topSourceTitle: metrics.topSourceTitle,
        riskLevel: metrics.riskLevel,
        attentionCount: metrics.attentionCount,
        watchCount: metrics.watchCount,
        clearCount: metrics.clearCount,
        confidenceAverage: metrics.confidenceAverage,
        generatedAt: new Date().toISOString(),
      };

      await this.prisma.aICheckTask.update({
        where: { id: taskId },
        data: {
          report: JSON.parse(JSON.stringify(report)),
          overallSimilarity,
          status: 'completed',
          errorMessage: null,
        },
      });

      return report;
    } catch (error: unknown) {
      await this.prisma.aICheckTask.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          errorMessage: this.getErrorMessage(error),
        },
      });
      throw error;
    }
  }

  private async checkParagraph(
    paragraph: string,
    index: number,
    kbId?: string,
  ): Promise<ParagraphCheckResult> {
    const candidates = await this.collectCandidates(paragraph, kbId);
    const topMatch = candidates[0];

    if (!topMatch || topMatch.score < 0.22) {
      return {
        paragraphIndex: index,
        paragraph: paragraph.slice(0, 100),
        isDuplicate: false,
        similarity: 0,
        confidence: 0.92,
        suggestion: 'No meaningful overlap was detected in the current check scope.',
        reviewAction: 'Keep the paragraph as-is and rerun only after substantial edits.',
      };
    }

    const llmJudgement =
      topMatch.score >= 0.6 ? await this.safeJudgeWithLlm(paragraph, topMatch) : null;
    const fallbackJudgement = this.buildHeuristicJudgement(paragraph, topMatch);
    const judgement = llmJudgement || fallbackJudgement;

    return {
      paragraphIndex: index,
      paragraph: paragraph.slice(0, 100),
      isDuplicate: judgement.judgement === 'substantive duplication',
      similarity: topMatch.score,
      matchedSource: {
        title: topMatch.title,
        content: topMatch.content.slice(0, 200),
      },
      judgement: judgement.judgement,
      confidence: judgement.confidence,
      suggestion: judgement.suggestion,
      reviewAction: judgement.reviewAction,
    };
  }

  private async collectCandidates(paragraph: string, kbId?: string): Promise<MatchCandidate[]> {
    const fallbackCandidates = this.buildFallbackCandidates(paragraph);
    const kbCandidates = kbId ? await this.buildKnowledgeBaseCandidates(paragraph, kbId) : [];

    return [...kbCandidates, ...fallbackCandidates]
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
  }

  private buildFallbackCandidates(paragraph: string): MatchCandidate[] {
    return this.fallbackSources
      .map((source) => ({
        id: source.id,
        title: source.title,
        content: source.content,
        score: this.computeSimilarity(paragraph, source.content),
        source: 'fallback' as const,
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 4);
  }

  private async buildKnowledgeBaseCandidates(
    paragraph: string,
    kbId: string,
  ): Promise<MatchCandidate[]> {
    try {
      const retrieved = await this.retrievalService.vectorSearch(kbId, paragraph, 12);
      if (retrieved.length === 0) {
        return [];
      }

      const rerankCandidates: RerankCandidate[] = retrieved.map((candidate) => ({
        id: candidate.chunkId,
        content: candidate.content,
        documentTitle: candidate.documentTitle,
        score: candidate.score,
      }));

      const reranked = await this.safeRerank(paragraph, rerankCandidates, 5);
      return reranked.map((candidate) => ({
        id: candidate.id || `kb-${candidate.documentTitle || 'unknown'}`,
        title: candidate.documentTitle || 'Knowledge base source',
        content: candidate.content,
        score: this.normalizeScore(candidate.rerankScore, paragraph, candidate.content),
        source: 'kb' as const,
      }));
    } catch (error) {
      this.logger.warn(
        `Knowledge-base check fallback activated for kbId=${kbId}: ${this.getErrorMessage(error)}`,
      );
      return [];
    }
  }

  private async safeRerank(query: string, candidates: RerankCandidate[], topK: number) {
    try {
      return await this.rerankService.rerank(query, candidates, topK);
    } catch (error) {
      this.logger.warn(`Rerank fallback activated: ${this.getErrorMessage(error)}`);
      return candidates
        .map((candidate) => ({
          ...candidate,
          rerankScore: this.computeSimilarity(query, candidate.content),
        }))
        .sort((left, right) => right.rerankScore - left.rerankScore)
        .slice(0, topK);
    }
  }

  private async safeJudgeWithLlm(
    paragraph: string,
    candidate: MatchCandidate,
  ): Promise<HeuristicJudgement | null> {
    try {
      const response = await this.llmService.generate(
        [
          {
            role: 'system',
            content: `You are an academic integrity reviewer.
Return JSON only:
{"judgement":"reasonable citation|substantive duplication|similar wording but different idea","confidence":0.85,"suggestion":"...","reviewAction":"..."}`,
          },
          {
            role: 'user',
            content: `Paragraph:
${paragraph.slice(0, 800)}

Matched source:
${candidate.content.slice(0, 800)}

Source title: ${candidate.title}
Similarity: ${candidate.score.toFixed(3)}`,
          },
        ],
        0.2,
      );

      return this.parseJudgementResponse(response);
    } catch (error) {
      this.logger.warn(`LLM judgement fallback activated: ${this.getErrorMessage(error)}`);
      return null;
    }
  }

  private parseJudgementResponse(response: LlmResponse): HeuristicJudgement | null {
    const parsed = this.parseJsonResponse(response.answer);
    if (!parsed) {
      return null;
    }

    const judgement =
      this.toNonEmptyString(parsed.judgement) || this.toNonEmptyString(parsed.label);
    const confidence = this.toNumber(parsed.confidence);
    const suggestion = this.toNonEmptyString(parsed.suggestion);
    const reviewAction = this.toNonEmptyString(parsed.reviewAction);

    if (
      !judgement ||
      !confidence ||
      !suggestion ||
      !reviewAction ||
      ![
        'reasonable citation',
        'substantive duplication',
        'similar wording but different idea',
      ].includes(judgement)
    ) {
      return null;
    }

    return {
      judgement,
      confidence: Math.max(0, Math.min(confidence, 0.99)),
      suggestion,
      reviewAction,
    };
  }

  private buildHeuristicJudgement(
    paragraph: string,
    candidate: MatchCandidate,
  ): HeuristicJudgement {
    const citationCue = this.hasCitationCue(paragraph);
    const similarity = candidate.score;

    if (similarity >= 0.86) {
      return {
        judgement: 'substantive duplication',
        confidence: 0.9,
        suggestion:
          'Rewrite the paragraph substantially or convert the reused language into a clearly cited quotation.',
        reviewAction:
          'Treat this as a blocking issue before submission and revise the paragraph with new wording and explicit attribution.',
      };
    }

    if (similarity >= 0.68 && citationCue) {
      return {
        judgement: 'reasonable citation',
        confidence: 0.8,
        suggestion:
          'The overlap may be acceptable, but make the attribution boundary clearer and ensure your own contribution is separated from cited work.',
        reviewAction:
          'Keep the citation, tighten the attribution language, and check whether the sentence can be shortened or paraphrased more distinctly.',
      };
    }

    if (similarity >= 0.68) {
      return {
        judgement: 'substantive duplication',
        confidence: 0.78,
        suggestion:
          'The paragraph overlaps too closely with the matched source. Rewrite the structure and add clearer original analysis.',
        reviewAction:
          'Revise this paragraph now, then rerun the check to confirm the overlap drops out of the review band.',
      };
    }

    return {
      judgement: 'similar wording but different idea',
      confidence: 0.72,
      suggestion:
        'The wording is close enough to warrant a manual pass. Keep the core idea if it is original, but make the phrasing more distinct.',
      reviewAction:
        'Review this paragraph manually, keep the argument, and reduce phrase-level overlap before the next submission pass.',
    };
  }

  private splitIntoParagraphs(text: string): string[] {
    return text
      .split(/\n\n+/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 30);
  }

  async getStatus(id: string, userId: string) {
    const task = await this.getOwnedTask(id, userId);
    const report = this.readReport(task.report);
    const totalParagraphs =
      typeof report?.totalParagraphs === 'number'
        ? report.totalParagraphs
        : Array.isArray(report?.details)
          ? report.details.length
          : 0;
    const metrics = this.buildReportMetrics(report?.details || [], totalParagraphs, task.overallSimilarity || 0);

    return {
      id: task.id,
      status: task.status,
      overallSimilarity: task.overallSimilarity,
      errorMessage: task.errorMessage,
      updatedAt: task.updatedAt.toISOString(),
      riskLevel: report?.riskLevel || metrics.riskLevel,
      flaggedParagraphs:
        typeof report?.flaggedParagraphs === 'number'
          ? report.flaggedParagraphs
          : metrics.flaggedParagraphs,
      needsReviewParagraphs:
        typeof report?.needsReviewParagraphs === 'number'
          ? report.needsReviewParagraphs
          : metrics.needsReviewParagraphs,
      lowConfidenceParagraphs:
        typeof report?.lowConfidenceParagraphs === 'number'
          ? report.lowConfidenceParagraphs
          : metrics.lowConfidenceParagraphs,
      topSimilarity:
        typeof report?.topSimilarity === 'number' ? report.topSimilarity : metrics.topSimilarity,
      topSourceTitle:
        typeof report?.topSourceTitle === 'string' ? report.topSourceTitle : metrics.topSourceTitle,
      isStaleProcessing:
        task.status === 'processing' &&
        (Date.now() - task.updatedAt.getTime()) / (1000 * 60) >= 20,
    };
  }

  async getReport(id: string, userId: string) {
    const task = await this.getOwnedTask(id, userId);
    return task.report;
  }

  async list(userId: string, query: ListAiCheckDto = {}) {
    const pageNo = query.pageNo || 1;
    const pageSize = query.pageSize || 10;
    const where = this.buildListWhere(query, userId);

    const [items, summaryRecords, total, pending, processing, completed, failed] =
      await this.prisma.$transaction([
        this.prisma.aICheckTask.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (pageNo - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            type: true,
            fileName: true,
            filePath: true,
            kbId: true,
            status: true,
            overallSimilarity: true,
            report: true,
            errorMessage: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        this.prisma.aICheckTask.findMany({
          where,
          select: {
            status: true,
            overallSimilarity: true,
            report: true,
            updatedAt: true,
          },
        }),
        this.prisma.aICheckTask.count({ where }),
        this.prisma.aICheckTask.count({ where: { ...where, status: 'pending' } }),
        this.prisma.aICheckTask.count({ where: { ...where, status: 'processing' } }),
        this.prisma.aICheckTask.count({ where: { ...where, status: 'completed' } }),
        this.prisma.aICheckTask.count({ where: { ...where, status: 'failed' } }),
      ]);

    const mappedItems = items.map((item) => {
      const report = this.readReport(item.report);
      const totalParagraphs =
        typeof report?.totalParagraphs === 'number'
          ? report.totalParagraphs
          : Array.isArray(report?.details)
            ? report.details.length
            : 0;
      const metrics = this.buildReportMetrics(
        report?.details || [],
        totalParagraphs,
        item.overallSimilarity || 0,
      );
      const staleMinutes = (Date.now() - item.updatedAt.getTime()) / (1000 * 60);
      const isStaleProcessing = item.status === 'processing' && staleMinutes >= 20;

      return {
        id: item.id,
        type: item.type,
        fileName: item.fileName,
        filePath: item.filePath,
        kbId: item.kbId,
        status: item.status,
        report,
        reportReady: Boolean(report),
        overallSimilarity: item.overallSimilarity,
        errorMessage: item.errorMessage,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        riskLevel: report?.riskLevel || metrics.riskLevel,
        flaggedParagraphs:
          typeof report?.flaggedParagraphs === 'number'
            ? report.flaggedParagraphs
            : metrics.flaggedParagraphs,
        needsReviewParagraphs:
          typeof report?.needsReviewParagraphs === 'number'
            ? report.needsReviewParagraphs
            : metrics.needsReviewParagraphs,
        lowConfidenceParagraphs:
          typeof report?.lowConfidenceParagraphs === 'number'
            ? report.lowConfidenceParagraphs
            : metrics.lowConfidenceParagraphs,
        topSimilarity:
          typeof report?.topSimilarity === 'number' ? report.topSimilarity : metrics.topSimilarity,
        topSourceTitle:
          typeof report?.topSourceTitle === 'string'
            ? report.topSourceTitle
            : metrics.topSourceTitle,
        isStaleProcessing,
      };
    });

    const completedSimilarities = summaryRecords
      .filter((item) => item.status === 'completed' && typeof item.overallSimilarity === 'number')
      .map((item) => item.overallSimilarity as number);
    const enrichedSummaryRecords = summaryRecords.map((item) => {
      const report = this.readReport(item.report);
      const totalParagraphs =
        typeof report?.totalParagraphs === 'number'
          ? report.totalParagraphs
          : Array.isArray(report?.details)
            ? report.details.length
            : 0;
      const metrics = this.buildReportMetrics(
        report?.details || [],
        totalParagraphs,
        item.overallSimilarity || 0,
      );
      const isStaleProcessing =
        item.status === 'processing' &&
        (Date.now() - item.updatedAt.getTime()) / (1000 * 60) >= 20;

      return {
        ...item,
        metrics,
        report,
        isStaleProcessing,
      };
    });

    return {
      items: mappedItems,
      total,
      pageNo,
      pageSize,
      totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
      summary: {
        total,
        pending,
        processing,
        completed,
        failed,
        highRisk: enrichedSummaryRecords.filter((item) => (item.report?.riskLevel || item.metrics.riskLevel) === 'high').length,
        mediumRisk: enrichedSummaryRecords.filter((item) => (item.report?.riskLevel || item.metrics.riskLevel) === 'medium').length,
        lowRisk: enrichedSummaryRecords.filter((item) => (item.report?.riskLevel || item.metrics.riskLevel) === 'low').length,
        clean: enrichedSummaryRecords.filter((item) => (item.report?.riskLevel || item.metrics.riskLevel) === 'clean').length,
        averageSimilarity:
          completedSimilarities.length > 0
            ? completedSimilarities.reduce((sum, value) => sum + value, 0) / completedSimilarities.length
            : 0,
        needsReview: enrichedSummaryRecords.reduce(
          (sum, item) =>
            sum +
            (typeof item.report?.needsReviewParagraphs === 'number'
              ? item.report.needsReviewParagraphs
              : item.metrics.needsReviewParagraphs),
          0,
        ),
        lowConfidence: enrichedSummaryRecords.reduce(
          (sum, item) =>
            sum +
            (typeof item.report?.lowConfidenceParagraphs === 'number'
              ? item.report.lowConfidenceParagraphs
              : item.metrics.lowConfidenceParagraphs),
          0,
        ),
        withReport: enrichedSummaryRecords.filter((item) => Boolean(item.report)).length,
        staleProcessing: enrichedSummaryRecords.filter((item) => item.isStaleProcessing).length,
        attention: enrichedSummaryRecords.filter((item) => {
          const riskLevel = item.report?.riskLevel || item.metrics.riskLevel;
          const needsReviewParagraphs =
            typeof item.report?.needsReviewParagraphs === 'number'
              ? item.report.needsReviewParagraphs
              : item.metrics.needsReviewParagraphs;
          return (
            item.status === 'failed' ||
            item.isStaleProcessing ||
            riskLevel === 'high' ||
            needsReviewParagraphs > 0
          );
        }).length,
      },
    };
  }

  async delete(id: string, userId: string) {
    await this.getOwnedTask(id, userId);
    return this.prisma.aICheckTask.delete({ where: { id } });
  }

  private async getTaskById(id: string) {
    const task = await this.prisma.aICheckTask.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException('AI check task not found.');
    }
    return task;
  }

  private async getOwnedTask(id: string, userId: string) {
    const task = await this.prisma.aICheckTask.findFirst({ where: { id, userId } });
    if (!task) {
      throw new NotFoundException('AI check task not found.');
    }
    return task;
  }

  private buildListWhere(query: ListAiCheckDto, userId: string): Prisma.AICheckTaskWhereInput {
    const where: Prisma.AICheckTaskWhereInput = {
      userId,
    };
    const trimmedSearchKey = query.searchKey?.trim();

    if (trimmedSearchKey) {
      where.OR = [
        {
          fileName: {
            contains: trimmedSearchKey,
            mode: 'insensitive',
          },
        },
        {
          kbId: {
            contains: trimmedSearchKey,
            mode: 'insensitive',
          },
        },
      ];
    }

    if (query.busType && query.busType !== 'all') {
      where.type = query.busType;
    }

    const timeRange = this.resolveTimeRange(query.checkTime);
    if (timeRange) {
      where.createdAt = timeRange;
    }

    return where;
  }

  private normalizeTaskType(type?: string): string {
    if (type === 'project' || type === 'paper' || type === 'patent') {
      return type;
    }

    return 'paper';
  }

  private computeSimilarity(left: string, right: string) {
    const leftTokens = this.tokenize(left);
    const rightTokens = this.tokenize(right);
    if (leftTokens.length === 0 || rightTokens.length === 0) {
      return 0;
    }

    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
    const union = new Set([...leftSet, ...rightSet]).size;
    const tokenOverlap = intersection / Math.min(leftSet.size, rightSet.size);
    const jaccard = union > 0 ? intersection / union : 0;

    const leftShingles = this.buildShingles(leftTokens, 2);
    const rightShingles = this.buildShingles(rightTokens, 2);
    const shingleIntersection = [...leftShingles].filter((token) => rightShingles.has(token)).length;
    const shingleScore =
      leftShingles.size > 0 && rightShingles.size > 0
        ? shingleIntersection / Math.min(leftShingles.size, rightShingles.size)
        : 0;

    return Number(Math.min(0.99, tokenOverlap * 0.5 + jaccard * 0.25 + shingleScore * 0.25).toFixed(4));
  }

  private tokenize(text: string) {
    return (text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g) || []).filter(
      (token) => token.length > 0,
    );
  }

  private buildShingles(tokens: string[], size: number) {
    const result = new Set<string>();
    for (let index = 0; index <= tokens.length - size; index += 1) {
      result.add(tokens.slice(index, index + size).join(' '));
    }
    return result;
  }

  private normalizeScore(baseScore: number, paragraph: string, content: string) {
    const heuristicScore = this.computeSimilarity(paragraph, content);
    if (!Number.isFinite(baseScore)) {
      return heuristicScore;
    }

    if (baseScore >= 0 && baseScore <= 1) {
      return Number(Math.min(0.99, baseScore * 0.6 + heuristicScore * 0.4).toFixed(4));
    }

    const normalizedBase = 1 / (1 + Math.exp(-baseScore));
    return Number(Math.min(0.99, normalizedBase * 0.6 + heuristicScore * 0.4).toFixed(4));
  }

  private hasCitationCue(text: string) {
    return /(\[\d+\]|et al\.|according to|as shown in|prior work|已有研究|文献|参考)/i.test(text);
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
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
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

  private toNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return 'unknown error';
  }

  private readReport(value: Prisma.JsonValue | null): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, any>;
  }

  private buildReportMetrics(
    results: ParagraphCheckResult[],
    totalParagraphs: number,
    overallSimilarity: number,
  ): ReportMetrics {
    const duplicateParagraphs = results.filter((item) => item.isDuplicate).length;
    const flaggedParagraphs = results.filter((item) => item.similarity >= 0.7).length;
    const needsReviewParagraphs = results.filter(
      (item) => !item.isDuplicate && item.similarity >= 0.7,
    ).length;
    const lowConfidenceResults = results.filter(
      (item) => typeof item.confidence === 'number' && item.confidence < 0.7,
    );
    const lowConfidenceParagraphs = lowConfidenceResults.length;
    const topMatch = [...results].sort((left, right) => right.similarity - left.similarity)[0];
    const allConfidence = results.filter(
      (item): item is ParagraphCheckResult & { confidence: number } =>
        typeof item.confidence === 'number',
    );
    const confidenceAverage =
      allConfidence.length > 0
        ? allConfidence.reduce((sum, item) => sum + item.confidence, 0) / allConfidence.length
        : null;
    const attentionCount = duplicateParagraphs + needsReviewParagraphs;
    const watchCount = results.filter(
      (item) => !item.isDuplicate && item.similarity > 0 && item.similarity < 0.7,
    ).length;
    const clearCount = Math.max(totalParagraphs - attentionCount - watchCount, 0);

    return {
      overallSimilarity,
      duplicateParagraphs,
      flaggedParagraphs,
      needsReviewParagraphs,
      lowConfidenceParagraphs,
      topSimilarity: topMatch?.similarity || 0,
      topSourceTitle: topMatch?.matchedSource?.title || null,
      riskLevel: this.resolveRiskLevel(overallSimilarity),
      attentionCount,
      watchCount,
      clearCount,
      confidenceAverage,
    };
  }

  private resolveRiskLevel(overallSimilarity?: number | null): ReportMetrics['riskLevel'] {
    if (typeof overallSimilarity !== 'number') {
      return 'unknown';
    }

    if (overallSimilarity >= 0.7) {
      return 'high';
    }
    if (overallSimilarity >= 0.45) {
      return 'medium';
    }
    if (overallSimilarity > 0) {
      return 'low';
    }

    return 'clean';
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
