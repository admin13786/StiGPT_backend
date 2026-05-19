import { Injectable } from '@nestjs/common';
import { Priority } from '@prisma/client';
import { IssueTypeService } from '../issue-type/issue-type.service';

@Injectable()
export class TicketPriorityService {
  constructor(private issueTypeService: IssueTypeService) {}

  /**
   * 计算工单优先级
   * 简化公式：直接基于问题类型权重计算
   * priorityScore = maxWeight + (sumOfOtherWeights * 0.3)
   */
  async calculatePriority(issueTypeIds: string[]): Promise<{
    priorityScore: number;
    priority: Priority;
  }> {
    // 默认分数
    let priorityScore = 50;

    if (issueTypeIds && issueTypeIds.length > 0) {
      const issueTypes = await this.issueTypeService.findByIds(issueTypeIds);

      if (issueTypes.length > 0) {
        const weights = issueTypes.map((type) => type.priorityWeight);
        const maxWeight = Math.max(...weights);
        const otherWeights = weights.filter((w) => w !== maxWeight);
        const sumOfOtherWeights = otherWeights.reduce((sum, w) => sum + w, 0);
        priorityScore = Math.round(maxWeight + sumOfOtherWeights * 0.3);
      }
    }

    // 映射到 Priority 枚举
    const priority = this.mapScoreToPriority(priorityScore);

    return { priorityScore, priority };
  }

  /**
   * 将分数映射到优先级枚举
   */
  private mapScoreToPriority(score: number): Priority {
    if (score >= 150) return Priority.URGENT;
    if (score >= 100) return Priority.HIGH;
    if (score >= 60) return Priority.NORMAL;
    return Priority.LOW;
  }
}
