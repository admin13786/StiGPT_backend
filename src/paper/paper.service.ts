import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DocumentProcessorService } from '../document/document-processor.service';
import { LightragService } from '../rag/lightrag.service';
import { LlmService } from '../rag/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { VectorService } from '../vector/vector.service';
import { IndexPaperToKbDto } from './dto/index-paper-to-kb.dto';

const pdfParse = require('pdf-parse');

interface ExtractedAuthor {
  name: string;
  affiliation?: string;
}

interface ExtractedMetadata {
  title?: string;
  abstract?: string;
  authors?: ExtractedAuthor[];
  keywords?: string[];
  year?: number;
  venue?: string;
  discipline?: string;
  subField?: string;
  language?: string;
}

interface ResolvedAuthor {
  id: string;
  name: string;
  affiliation: string | null;
}

@Injectable()
export class PaperService {
  private readonly logger = new Logger(PaperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly vectorService: VectorService,
    private readonly lightragService: LightragService,
    private readonly documentProcessorService: DocumentProcessorService,
  ) {}

  async uploadPaper(
    file: { originalname: string; path: string; size: number },
    dto: { discipline?: string; kbId?: string },
  ) {
    const paper = await this.prisma.paper.create({
      data: {
        title: file.originalname.replace(/\.pdf$/i, ''),
        filePath: file.path,
        discipline: dto.discipline,
        status: 'pending',
      },
    });

    this.processPaper(paper.id, dto.kbId).catch((error: Error) => {
      this.logger.error(`Paper processing failed: ${paper.id}`, error.message);
    });

    return paper;
  }

  async processPaper(paperId: string, kbId?: string) {
    await this.prisma.paper.update({
      where: { id: paperId },
      data: { status: 'processing' },
    });

    try {
      const paper = await this.prisma.paper.findUnique({ where: { id: paperId } });
      if (!paper?.filePath) {
        throw new Error('Paper file path is missing');
      }

      const buffer = fs.readFileSync(paper.filePath);
      const pdfData = await pdfParse(buffer);
      const text = pdfData.text;

      const metadata = await this.extractMetadata(text);
      const authors = this.normalizeAuthors(metadata.authors);
      const keywords = this.normalizeKeywords(metadata.keywords);
      const topics = this.normalizeTopics(metadata.subField, keywords);

      await this.prisma.paper.update({
        where: { id: paperId },
        data: {
          title: metadata.title || paper.title,
          abstract: metadata.abstract,
          keywords,
          year: metadata.year,
          venue: metadata.venue,
          discipline: paper.discipline || metadata.discipline,
          subField: metadata.subField,
          language: metadata.language,
        },
      });

      const previousAuthorIds = await this.prisma.paperAuthor.findMany({
        where: { paperId },
        select: { authorId: true },
      });

      const resolvedAuthors = await this.syncPaperAuthors(paperId, authors);

      try {
        await this.syncPaperTopics(paperId, topics);
        await this.syncAuthorInstitutions(resolvedAuthors);
        await this.syncAuthorCollaborations([
          ...previousAuthorIds.map((item) => item.authorId),
          ...resolvedAuthors.map((author) => author.id),
        ]);
      } catch (error: any) {
        this.logger.warn(
          `Graph sync skipped for paper ${paperId}: ${error.message || 'unknown error'}`,
        );
      }

      if (kbId) {
        await this.indexToKnowledgeBase(paperId, { kbId });
      }

      await this.lightragService.insertDocument(text.slice(0, 10000));

      await this.prisma.paper.update({
        where: { id: paperId },
        data: {
          status: 'ready',
          errorMessage: null,
        },
      });
      this.logger.log(`Paper processed: ${paperId}`);
    } catch (error: any) {
      await this.prisma.paper.update({
        where: { id: paperId },
        data: {
          status: 'failed',
          errorMessage: error.message,
        },
      });
      throw error;
    }
  }

  private async extractMetadata(text: string): Promise<ExtractedMetadata> {
    try {
      const result = await this.llmService.generate(
        [
          {
            role: 'system',
            content: `Extract structured metadata from the paper and return JSON:
{
  "title": "Paper title",
  "abstract": "Abstract",
  "authors": [{ "name": "Author", "affiliation": "Institution" }],
  "keywords": ["keyword 1", "keyword 2"],
  "year": 2024,
  "venue": "Journal or conference",
  "discipline": "Primary discipline",
  "subField": "Sub-field",
  "language": "zh or en"
}`,
          },
          {
            role: 'user',
            content: text.slice(0, 5000),
          },
        ],
        0.2,
      );

      return JSON.parse(result.answer) as ExtractedMetadata;
    } catch {
      return {
        title: '',
        abstract: '',
        authors: [],
        keywords: [],
        discipline: 'Uncategorized',
      };
    }
  }

  private normalizeAuthors(authors: ExtractedMetadata['authors']): ExtractedAuthor[] {
    if (!Array.isArray(authors)) {
      return [];
    }

    const deduped = new Map<string, ExtractedAuthor>();

    for (const item of authors) {
      if (!item?.name) {
        continue;
      }

      const name = this.normalizeText(item.name);
      const affiliation = this.normalizeText(item.affiliation) || undefined;
      const dedupeKey = `${this.normalizeEntityKey(name)}|${this.normalizeEntityKey(affiliation)}`;

      if (!name || deduped.has(dedupeKey)) {
        continue;
      }

      deduped.set(dedupeKey, {
        name,
        affiliation,
      });
    }

    return Array.from(deduped.values());
  }

  private normalizeKeywords(keywords: string[] | undefined): string[] {
    if (!Array.isArray(keywords)) {
      return [];
    }

    const deduped = new Map<string, string>();

    for (const keyword of keywords) {
      const displayName = this.normalizeText(keyword);
      const normalizedName = this.normalizeEntityKey(displayName);

      if (!displayName || !normalizedName || deduped.has(normalizedName)) {
        continue;
      }

      deduped.set(normalizedName, displayName);
    }

    return Array.from(deduped.values());
  }

  private normalizeTopics(subField?: string, keywords: string[] = []) {
    return this.normalizeKeywords([subField || '', ...keywords]);
  }

  private async syncPaperAuthors(
    paperId: string,
    authors: ExtractedAuthor[],
  ): Promise<ResolvedAuthor[]> {
    const resolvedAuthors: ResolvedAuthor[] = [];

    for (const author of authors) {
      resolvedAuthors.push(await this.findOrCreateAuthor(author));
    }

    await this.prisma.paperAuthor.deleteMany({
      where: { paperId },
    });

    if (resolvedAuthors.length > 0) {
      await this.prisma.paperAuthor.createMany({
        data: resolvedAuthors.map((author, index) => ({
          paperId,
          authorId: author.id,
          order: index,
        })),
        skipDuplicates: true,
      });
    }

    return resolvedAuthors;
  }

  private async findOrCreateAuthor(authorData: ExtractedAuthor): Promise<ResolvedAuthor> {
    const name = this.normalizeText(authorData.name);
    const affiliation = this.normalizeText(authorData.affiliation) || null;

    let author =
      affiliation
        ? await this.prisma.author.findFirst({
            where: {
              name,
              affiliation,
            },
            orderBy: { createdAt: 'asc' },
          })
        : null;

    if (!author) {
      author = await this.prisma.author.findFirst({
        where: { name },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (author) {
      if (!author.affiliation && affiliation) {
        author = await this.prisma.author.update({
          where: { id: author.id },
          data: { affiliation },
        });
      }

      return {
        id: author.id,
        name: author.name,
        affiliation: author.affiliation,
      };
    }

    const created = await this.prisma.author.create({
      data: {
        name,
        affiliation,
      },
    });

    return {
      id: created.id,
      name: created.name,
      affiliation: created.affiliation,
    };
  }

  private async syncPaperTopics(paperId: string, topics: string[]) {
    const topicLinks: Array<{ paperId: string; topicId: string; weight: number }> = [];

    for (const topicName of topics) {
      const displayName = this.normalizeText(topicName);
      const normalizedName = this.normalizeEntityKey(displayName);

      if (!displayName || !normalizedName) {
        continue;
      }

      const topic = await this.prisma.topic.upsert({
        where: { normalizedName },
        create: {
          name: displayName,
          normalizedName,
        },
        update: {
          name: displayName,
        },
      });

      topicLinks.push({
        paperId,
        topicId: topic.id,
        weight: 1,
      });
    }

    await this.prisma.paperTopic.deleteMany({
      where: { paperId },
    });

    if (topicLinks.length > 0) {
      await this.prisma.paperTopic.createMany({
        data: topicLinks,
        skipDuplicates: true,
      });
    }
  }

  private async syncAuthorInstitutions(authors: ResolvedAuthor[]) {
    for (const author of authors) {
      const institutionName = this.normalizeText(author.affiliation);
      const normalizedName = this.normalizeEntityKey(institutionName);

      if (!institutionName || !normalizedName) {
        continue;
      }

      const institution = await this.prisma.institution.upsert({
        where: { normalizedName },
        create: {
          name: institutionName,
          normalizedName,
        },
        update: {
          name: institutionName,
        },
      });

      await this.prisma.authorInstitution.upsert({
        where: {
          authorId_institutionId: {
            authorId: author.id,
            institutionId: institution.id,
          },
        },
        create: {
          authorId: author.id,
          institutionId: institution.id,
          isPrimary: true,
        },
        update: {
          isPrimary: true,
        },
      });
    }
  }

  private async syncAuthorCollaborations(authorIds: string[]) {
    const dedupedAuthorIds = Array.from(new Set(authorIds));

    if (dedupedAuthorIds.length < 2) {
      return;
    }

    for (let leftIndex = 0; leftIndex < dedupedAuthorIds.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < dedupedAuthorIds.length;
        rightIndex += 1
      ) {
        const [authorId, collaboratorId] = [
          dedupedAuthorIds[leftIndex],
          dedupedAuthorIds[rightIndex],
        ].sort();

        const [stats] = await this.prisma.$queryRaw<
          { paperCount: bigint; lastYear: number | null }[]
        >`
          SELECT
            COUNT(DISTINCT pa1."paperId")::bigint AS "paperCount",
            MAX(p."year")::int AS "lastYear"
          FROM "PaperAuthor" pa1
          INNER JOIN "PaperAuthor" pa2
            ON pa1."paperId" = pa2."paperId"
          INNER JOIN "Paper" p
            ON p."id" = pa1."paperId"
          WHERE pa1."authorId" = ${authorId}
            AND pa2."authorId" = ${collaboratorId}
        `;

        const paperCount = Number(stats?.paperCount || 0);

        if (paperCount <= 0) {
          await this.prisma.authorCollaboration.deleteMany({
            where: {
              authorId,
              collaboratorId,
            },
          });
          continue;
        }

        await this.prisma.authorCollaboration.upsert({
          where: {
            authorId_collaboratorId: {
              authorId,
              collaboratorId,
            },
          },
          create: {
            authorId,
            collaboratorId,
            paperCount,
            lastYear: stats?.lastYear || null,
          },
          update: {
            paperCount,
            lastYear: stats?.lastYear || null,
          },
        });
      }
    }
  }

  async list(query: {
    discipline?: string;
    status?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: any = {};

    if (query.discipline) {
      where.discipline = query.discipline;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.keyword) {
      where.OR = [
        { title: { contains: query.keyword, mode: 'insensitive' } },
        { abstract: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const [items, total] = await Promise.all([
      this.prisma.paper.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          authors: {
            include: {
              author: true,
            },
          },
        },
      }),
      this.prisma.paper.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async getById(id: string) {
    const paper = await this.prisma.paper.findUnique({
      where: { id },
      include: {
        authors: {
          include: {
            author: true,
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!paper) {
      throw new NotFoundException('Paper not found');
    }

    return paper;
  }

  async update(
    id: string,
    data: {
      title?: string;
      discipline?: string;
      subField?: string;
      keywords?: string[];
    },
  ) {
    return this.prisma.paper.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return this.prisma.paper.delete({ where: { id } });
  }

  async getDisciplineStats() {
    const stats = await this.prisma.paper.groupBy({
      by: ['discipline'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    return stats.map((item) => ({
      discipline: item.discipline || 'Uncategorized',
      count: item._count.id,
    }));
  }

  async reprocess(id: string, kbId?: string) {
    await this.prisma.paper.update({
      where: { id },
      data: { status: 'pending' },
    });

    this.processPaper(id, kbId).catch((error: Error) => {
      this.logger.error(`Paper reprocess failed: ${id}`, error.message);
    });

    return { message: 'Reprocessing started' };
  }

  async indexToKnowledgeBase(paperId: string, dto: IndexPaperToKbDto) {
    const kbId = dto.kbId?.trim();

    if (!kbId) {
      throw new BadRequestException('kbId is required');
    }

    const paper = await this.prisma.paper.findUnique({
      where: { id: paperId },
      select: {
        id: true,
        documentId: true,
        title: true,
        abstract: true,
        keywords: true,
        year: true,
        venue: true,
        language: true,
        discipline: true,
        subField: true,
        filePath: true,
      },
    });

    if (!paper) {
      throw new NotFoundException('Paper not found');
    }

    if (!paper.filePath || !fs.existsSync(paper.filePath)) {
      throw new NotFoundException('Paper file not found');
    }

    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, deletedAt: null },
      select: { id: true },
    });

    if (!kb) {
      throw new NotFoundException('Knowledge base not found');
    }

    const fileBuffer = fs.readFileSync(paper.filePath);
    const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
    const fileStat = fs.statSync(paper.filePath);
    const fileType = path.extname(paper.filePath).replace('.', '').toLowerCase() || 'pdf';

    const linkedDocument = paper.documentId
      ? await this.prisma.document.findFirst({
          where: { id: paper.documentId, deletedAt: null },
        })
      : null;

    if (linkedDocument && linkedDocument.kbId !== kbId) {
      throw new ConflictException(
        `Paper ${paperId} is already linked to document ${linkedDocument.id} in another knowledge base`,
      );
    }

    let document =
      linkedDocument ||
      (await this.prisma.document.findFirst({
        where: {
          kbId,
          fileHash,
          deletedAt: null,
        },
        orderBy: { uploadTime: 'asc' },
      }));

    let action = 'linked-existing-document';
    let queued = false;

    if (!document) {
      document = await this.prisma.document.create({
        data: {
          kbId,
          title: paper.title || path.basename(paper.filePath, path.extname(paper.filePath)),
          filePath: paper.filePath,
          fileType,
          fileSize: Number(fileStat.size),
          fileHash,
          status: 'pending',
          metadata: {
            source: 'paper',
            paperId: paper.id,
            paperTitle: paper.title,
            abstract: paper.abstract,
            keywords: paper.keywords,
            year: paper.year,
            venue: paper.venue,
            language: paper.language,
            discipline: paper.discipline,
            subField: paper.subField,
          },
        },
      });
      action = 'created-document';
    }

    if (paper.documentId !== document.id) {
      await this.prisma.paper.update({
        where: { id: paperId },
        data: { documentId: document.id },
      });
    }

    const shouldQueue =
      dto.reprocess === true ||
      action === 'created-document' ||
      document.status === 'pending' ||
      document.status === 'failed';

    if (shouldQueue) {
      await this.prepareDocumentForProcessing(document.id, kbId);
      this.documentProcessorService.processDocument(document.id).catch((error: Error) => {
        this.logger.error(`Paper document processing failed: ${document?.id}`, error.message);
      });
      queued = true;
      action = action === 'created-document' ? action : 'queued-document-processing';
    }

    return {
      success: true,
      message: queued
        ? 'Paper has been queued for knowledge base indexing'
        : 'Paper is already linked to a knowledge base document',
      data: {
        paperId,
        kbId,
        documentId: document.id,
        documentStatus: shouldQueue ? 'pending' : document.status,
        queued,
        action,
      },
    };
  }

  private async prepareDocumentForProcessing(documentId: string, kbId: string) {
    const currentDocument = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        status: true,
        chunkCount: true,
        processedAt: true,
      },
    });

    await this.vectorService.deleteByDocumentId(kbId, documentId).catch((error: Error) => {
      this.logger.warn(
        `Failed to cleanup vectors for document ${documentId}: ${error.message || 'unknown error'}`,
      );
    });

    await this.prisma.documentChunk.deleteMany({
      where: { documentId },
    });

    if (currentDocument?.processedAt || currentDocument?.status === 'completed') {
      await this.prisma.knowledgeBase.update({
        where: { id: kbId },
        data: {
          documentCount: { decrement: 1 },
          chunkCount: { decrement: currentDocument.chunkCount || 0 },
        },
      });
    }

    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'pending',
        errorMessage: null,
        processedAt: null,
        chunkCount: 0,
        tokenCount: 0,
      },
    });
  }

  private normalizeText(value?: string | null) {
    return value?.replace(/\s+/g, ' ').trim() || '';
  }

  private normalizeEntityKey(value?: string | null) {
    return this.normalizeText(value).toLowerCase();
  }
}
