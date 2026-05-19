import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { SatisfactionService } from './satisfaction.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('satisfaction')
@Controller('satisfaction')
export class SatisfactionController {
  constructor(private readonly satisfactionService: SatisfactionService) {}

  // 玩家端API - 提交满意度评价
  @Public()
  @Post()
  @ApiOperation({ summary: '提交满意度评价（玩家端）' })
  @ApiResponse({ status: 201, description: '提交成功' })
  create(@Body() createRatingDto: CreateRatingDto) {
    return this.satisfactionService.create(createRatingDto);
  }

  // 玩家端API - 获取评价
  @Public()
  @Get('session/:sessionId')
  @ApiOperation({ summary: '获取会话评价（玩家端）' })
  @ApiParam({ name: 'sessionId', description: '会话ID' })
  @ApiResponse({ status: 200, description: '返回评价信息' })
  findBySession(@Param('sessionId') sessionId: string) {
    return this.satisfactionService.findBySession(sessionId);
  }

  // 管理端API - 获取客服评价统计
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Get('agent/:agentId/stats')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '获取客服评价统计（管理端）' })
  @ApiParam({ name: 'agentId', description: '客服ID' })
  @ApiQuery({ name: 'startDate', required: false, description: '开始日期' })
  @ApiQuery({ name: 'endDate', required: false, description: '结束日期' })
  @ApiResponse({ status: 200, description: '返回统计信息' })
  getAgentStats(
    @Param('agentId') agentId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.satisfactionService.getAgentStats(
      agentId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }
}
