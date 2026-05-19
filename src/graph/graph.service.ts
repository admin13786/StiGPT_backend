import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SearchGraphDto } from './dto/search-graph.dto';

export interface CollaboratorSummary {
  id: string;
  name: string;
  affiliation: string | null;
  paperCount: number;
  lastYear: number | null;
}

@Injectable()
export class GraphService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchGraphDto) {
    const keyword = this.normalizeKeyword(query.q);
    const type = query.type || 'all';
    const pageNo = query.pageNo || 1;
    const pageSize = Math.min(query.pageSize || 8, 20);
    const skip = (pageNo - 1) * pageSize;

    if (type === 'paper') {
      const [items, total] = await Promise.all([
        this.searchPapers(keyword, skip, pageSize),
        this.countPapers(keyword),
      ]);
      return { query: keyword, type, pageNo, pageSize, total, items };
    }

    if (type === 'author') {
      const [items, total] = await Promise.all([
        this.searchAuthors(keyword, skip, pageSize),
        this.countAuthors(keyword),
      ]);
      return { query: keyword, type, pageNo, pageSize, total, items };
    }

    if (type === 'institution') {
      const [items, total] = await Promise.all([
        this.searchInstitutions(keyword, skip, pageSize),
        this.countInstitutions(keyword),
      ]);
      return { query: keyword, type, pageNo, pageSize, total, items };
    }

    if (type === 'topic') {
      const [items, total] = await Promise.all([
        this.searchTopics(keyword, skip, pageSize),
        this.countTopics(keyword),
      ]);
      return { query: keyword, type, pageNo, pageSize, total, items };
    }

    const [papers, authors, institutions, topics, paperTotal, authorTotal, institutionTotal, topicTotal] =
      await Promise.all([
        this.searchPapers(keyword, 0, pageSize),
        this.searchAuthors(keyword, 0, pageSize),
        this.searchInstitutions(keyword, 0, pageSize),
        this.searchTopics(keyword, 0, pageSize),
        this.countPapers(keyword),
        this.countAuthors(keyword),
        this.countInstitutions(keyword),
        this.countTopics(keyword),
      ]);

    return {
      query: keyword,
      type,
      pageNo,
      pageSize,
      totals: {
        papers: paperTotal,
        authors: authorTotal,
        institutions: institutionTotal,
        topics: topicTotal,
      },
      results: {
        papers,
        authors,
        institutions,
        topics,
      },
    };
  }

  async getPaper(id: string) {
    const paper = await this.prisma.paper.findUnique({
      where: { id },
      include: {
        authors: {
          include: {
            author: {
              include: {
                institutions: {
                  include: {
                    institution: true,
                  },
                  orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
                },
              },
            },
          },
          orderBy: { order: 'asc' },
        },
        topics: {
          include: {
            topic: true,
          },
          orderBy: [{ weight: 'desc' }, { createdAt: 'asc' }],
        },
        _count: {
          select: {
            authors: true,
            topics: true,
            citing: true,
            citedBy: true,
          },
        },
      },
    });

    if (!paper) {
      throw new NotFoundException('Paper not found');
    }

    return {
      ...paper,
      authors: paper.authors.map((item) => ({
        id: item.author.id,
        name: item.author.name,
        affiliation: item.author.affiliation,
        email: item.author.email,
        hIndex: item.author.hIndex,
        order: item.order,
        institutions: item.author.institutions.map((relation) => ({
          id: relation.institution.id,
          name: relation.institution.name,
          country: relation.institution.country,
          city: relation.institution.city,
          isPrimary: relation.isPrimary,
          startYear: relation.startYear,
          endYear: relation.endYear,
        })),
      })),
      topics: paper.topics.map((item) => ({
        id: item.topic.id,
        name: item.topic.name,
        normalizedName: item.topic.normalizedName,
        weight: item.weight,
      })),
    };
  }

  async getPaperRelations(id: string) {
    const paper = await this.prisma.paper.findUnique({
      where: { id },
      include: {
        authors: {
          include: {
            author: true,
          },
          orderBy: { order: 'asc' },
        },
        topics: {
          include: {
            topic: true,
          },
          orderBy: [{ weight: 'desc' }, { createdAt: 'asc' }],
        },
        citing: {
          include: {
            citedPaper: {
              select: {
                id: true,
                title: true,
                year: true,
                venue: true,
                citationCount: true,
              },
            },
          },
        },
        citedBy: {
          include: {
            citingPaper: {
              select: {
                id: true,
                title: true,
                year: true,
                venue: true,
                citationCount: true,
              },
            },
          },
        },
      },
    });

    if (!paper) {
      throw new NotFoundException('Paper not found');
    }

    return {
      paper: {
        id: paper.id,
        title: paper.title,
        year: paper.year,
        venue: paper.venue,
        discipline: paper.discipline,
        subField: paper.subField,
      },
      authors: paper.authors.map((item) => ({
        id: item.author.id,
        name: item.author.name,
        affiliation: item.author.affiliation,
        order: item.order,
      })),
      topics: paper.topics.map((item) => ({
        id: item.topic.id,
        name: item.topic.name,
        weight: item.weight,
      })),
      references: paper.citing.map((item) => item.citedPaper),
      citedBy: paper.citedBy.map((item) => item.citingPaper),
    };
  }

  async getPaperReferences(id: string) {
    const paper = await this.prisma.paper.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        citing: {
          include: {
            citedPaper: {
              select: {
                id: true,
                title: true,
                year: true,
                venue: true,
                citationCount: true,
              },
            },
          },
        },
      },
    });

    if (!paper) {
      throw new NotFoundException('Paper not found');
    }

    return {
      paperId: paper.id,
      paperTitle: paper.title,
      total: paper.citing.length,
      items: paper.citing.map((item) => item.citedPaper),
    };
  }

  async getAuthor(id: string) {
    const author = await this.prisma.author.findUnique({
      where: { id },
      include: {
        institutions: {
          include: {
            institution: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
        },
        papers: {
          include: {
            paper: {
              select: {
                id: true,
                title: true,
                year: true,
                venue: true,
                citationCount: true,
                discipline: true,
                subField: true,
                status: true,
              },
            },
          },
          orderBy: { order: 'asc' },
        },
        collaborationsFrom: {
          include: {
            collaborator: {
              select: {
                id: true,
                name: true,
                affiliation: true,
              },
            },
          },
          orderBy: [{ paperCount: 'desc' }, { updatedAt: 'desc' }],
        },
        collaborationsTo: {
          include: {
            author: {
              select: {
                id: true,
                name: true,
                affiliation: true,
              },
            },
          },
          orderBy: [{ paperCount: 'desc' }, { updatedAt: 'desc' }],
        },
        _count: {
          select: {
            papers: true,
            institutions: true,
            collaborationsFrom: true,
            collaborationsTo: true,
          },
        },
      },
    });

    if (!author) {
      throw new NotFoundException('Author not found');
    }

    const papers = author.papers
      .map((item) => ({
        ...item.paper,
        authorOrder: item.order,
      }))
      .sort((left, right) => {
        if ((right.year || 0) !== (left.year || 0)) {
          return (right.year || 0) - (left.year || 0);
        }
        return left.title.localeCompare(right.title);
      });

    const collaborators = this.mergeCollaborators(
      author.collaborationsFrom,
      author.collaborationsTo,
    );

    return {
      id: author.id,
      name: author.name,
      affiliation: author.affiliation,
      email: author.email,
      hIndex: author.hIndex,
      createdAt: author.createdAt,
      stats: {
        paperCount: author._count.papers,
        institutionCount: author._count.institutions,
        collaborationCount: collaborators.length,
      },
      institutions: author.institutions.map((item) => ({
        id: item.institution.id,
        name: item.institution.name,
        country: item.institution.country,
        city: item.institution.city,
        isPrimary: item.isPrimary,
        startYear: item.startYear,
        endYear: item.endYear,
      })),
      papers,
      topCollaborators: collaborators.slice(0, 20),
    };
  }

  async getAuthorCollaborators(id: string) {
    const author = await this.prisma.author.findUnique({
      where: { id },
      include: {
        collaborationsFrom: {
          include: {
            collaborator: {
              select: {
                id: true,
                name: true,
                affiliation: true,
              },
            },
          },
          orderBy: [{ paperCount: 'desc' }, { updatedAt: 'desc' }],
        },
        collaborationsTo: {
          include: {
            author: {
              select: {
                id: true,
                name: true,
                affiliation: true,
              },
            },
          },
          orderBy: [{ paperCount: 'desc' }, { updatedAt: 'desc' }],
        },
      },
    });

    if (!author) {
      throw new NotFoundException('Author not found');
    }

    const items = this.mergeCollaborators(
      author.collaborationsFrom,
      author.collaborationsTo,
    );

    return {
      authorId: author.id,
      authorName: author.name,
      total: items.length,
      items,
    };
  }

  async getInstitution(id: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id },
      include: {
        authors: {
          include: {
            author: {
              include: {
                _count: {
                  select: {
                    papers: true,
                  },
                },
              },
            },
          },
          orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
        },
      },
    });

    if (!institution) {
      throw new NotFoundException('Institution not found');
    }

    const topAuthors = institution.authors
      .map((item) => ({
        id: item.author.id,
        name: item.author.name,
        affiliation: item.author.affiliation,
        paperCount: item.author._count.papers,
        isPrimary: item.isPrimary,
        startYear: item.startYear,
        endYear: item.endYear,
      }))
      .sort((left, right) => {
        if (right.paperCount !== left.paperCount) {
          return right.paperCount - left.paperCount;
        }
        return left.name.localeCompare(right.name);
      });

    return {
      id: institution.id,
      name: institution.name,
      normalizedName: institution.normalizedName,
      nameEn: institution.nameEn,
      country: institution.country,
      city: institution.city,
      createdAt: institution.createdAt,
      updatedAt: institution.updatedAt,
      stats: {
        authorCount: institution.authors.length,
      },
      topAuthors: topAuthors.slice(0, 20),
    };
  }

  async getInstitutionTopAuthors(id: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
      },
    });

    if (!institution) {
      throw new NotFoundException('Institution not found');
    }

    const relations = await this.prisma.authorInstitution.findMany({
      where: { institutionId: id },
      include: {
        author: {
          include: {
            _count: {
              select: {
                papers: true,
              },
            },
          },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
    });

    const items = relations
      .map((item) => ({
        id: item.author.id,
        name: item.author.name,
        affiliation: item.author.affiliation,
        paperCount: item.author._count.papers,
        isPrimary: item.isPrimary,
        startYear: item.startYear,
        endYear: item.endYear,
      }))
      .sort((left, right) => {
        if (right.paperCount !== left.paperCount) {
          return right.paperCount - left.paperCount;
        }
        return left.name.localeCompare(right.name);
      });

    return {
      institutionId: institution.id,
      institutionName: institution.name,
      total: items.length,
      items,
    };
  }

  private normalizeKeyword(value?: string | null) {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  }

  private async searchPapers(keyword: string | undefined, skip: number, take: number) {
    return this.prisma.paper.findMany({
      where: keyword
        ? {
            OR: [
              { title: { contains: keyword, mode: 'insensitive' } },
              { abstract: { contains: keyword, mode: 'insensitive' } },
              { venue: { contains: keyword, mode: 'insensitive' } },
              { discipline: { contains: keyword, mode: 'insensitive' } },
              { subField: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: {
        id: true,
        title: true,
        year: true,
        venue: true,
        discipline: true,
        subField: true,
        citationCount: true,
        createdAt: true,
        _count: {
          select: {
            authors: true,
            citing: true,
            citedBy: true,
            topics: true,
          },
        },
      },
      orderBy: [{ year: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    });
  }

  private async countPapers(keyword: string | undefined) {
    return this.prisma.paper.count({
      where: keyword
        ? {
            OR: [
              { title: { contains: keyword, mode: 'insensitive' } },
              { abstract: { contains: keyword, mode: 'insensitive' } },
              { venue: { contains: keyword, mode: 'insensitive' } },
              { discipline: { contains: keyword, mode: 'insensitive' } },
              { subField: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : undefined,
    });
  }

  private async searchAuthors(keyword: string | undefined, skip: number, take: number) {
    return this.prisma.author.findMany({
      where: keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { affiliation: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: {
        id: true,
        name: true,
        affiliation: true,
        hIndex: true,
        createdAt: true,
        _count: {
          select: {
            papers: true,
            institutions: true,
            collaborationsFrom: true,
            collaborationsTo: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
      skip,
      take,
    });
  }

  private async countAuthors(keyword: string | undefined) {
    return this.prisma.author.count({
      where: keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { affiliation: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : undefined,
    });
  }

  private async searchInstitutions(keyword: string | undefined, skip: number, take: number) {
    return this.prisma.institution.findMany({
      where: keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { nameEn: { contains: keyword, mode: 'insensitive' } },
              { country: { contains: keyword, mode: 'insensitive' } },
              { city: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: {
        id: true,
        name: true,
        nameEn: true,
        country: true,
        city: true,
        updatedAt: true,
        _count: {
          select: {
            authors: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      skip,
      take,
    });
  }

  private async countInstitutions(keyword: string | undefined) {
    return this.prisma.institution.count({
      where: keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { nameEn: { contains: keyword, mode: 'insensitive' } },
              { country: { contains: keyword, mode: 'insensitive' } },
              { city: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : undefined,
    });
  }

  private async searchTopics(keyword: string | undefined, skip: number, take: number) {
    return this.prisma.topic.findMany({
      where: keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { normalizedName: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: {
        id: true,
        name: true,
        normalizedName: true,
        updatedAt: true,
        _count: {
          select: {
            papers: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      skip,
      take,
    });
  }

  private async countTopics(keyword: string | undefined) {
    return this.prisma.topic.count({
      where: keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { normalizedName: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : undefined,
    });
  }

  private mergeCollaborators(
    collaborationsFrom: Array<{
      collaborator: { id: string; name: string; affiliation: string | null };
      paperCount: number;
      lastYear: number | null;
    }>,
    collaborationsTo: Array<{
      author: { id: string; name: string; affiliation: string | null };
      paperCount: number;
      lastYear: number | null;
    }>,
  ): CollaboratorSummary[] {
    const items = new Map<string, CollaboratorSummary>();

    for (const relation of collaborationsFrom) {
      items.set(relation.collaborator.id, {
        id: relation.collaborator.id,
        name: relation.collaborator.name,
        affiliation: relation.collaborator.affiliation,
        paperCount: relation.paperCount,
        lastYear: relation.lastYear,
      });
    }

    for (const relation of collaborationsTo) {
      const current = items.get(relation.author.id);
      const nextValue: CollaboratorSummary = {
        id: relation.author.id,
        name: relation.author.name,
        affiliation: relation.author.affiliation,
        paperCount: relation.paperCount,
        lastYear: relation.lastYear,
      };

      if (!current) {
        items.set(relation.author.id, nextValue);
        continue;
      }

      items.set(relation.author.id, {
        ...current,
        paperCount: Math.max(current.paperCount, nextValue.paperCount),
        lastYear:
          current.lastYear && nextValue.lastYear
            ? Math.max(current.lastYear, nextValue.lastYear)
            : current.lastYear || nextValue.lastYear,
      });
    }

    return Array.from(items.values()).sort((left, right) => {
      if (right.paperCount !== left.paperCount) {
        return right.paperCount - left.paperCount;
      }

      if ((right.lastYear || 0) !== (left.lastYear || 0)) {
        return (right.lastYear || 0) - (left.lastYear || 0);
      }

      return left.name.localeCompare(right.name);
    });
  }
}
