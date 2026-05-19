import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { UrgencyRuleService } from './urgency-rule.service';
import {
  CreateUrgencyRuleDto,
  UpdateUrgencyRuleDto,
} from './dto/create-urgency-rule.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('urgency-rules')
@ApiBearerAuth('JWT-auth')
@Controller('urgency-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class UrgencyRuleController {
  constructor(private readonly urgencyRuleService: UrgencyRuleService) {}

  @Get()
  @ApiOperation({ summary: '获取紧急规则列表' })
  @ApiResponse({ status: 200, description: '返回规则列表' })
  findAll() {
    return this.urgencyRuleService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取紧急规则详情' })
  @ApiParam({ name: 'id', description: '规则ID' })
  @ApiResponse({ status: 200, description: '返回规则信息' })
  findOne(@Param('id') id: string) {
    return this.urgencyRuleService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '创建紧急规则' })
  @ApiResponse({ status: 201, description: '创建成功' })
  create(@Body() createUrgencyRuleDto: CreateUrgencyRuleDto) {
    return this.urgencyRuleService.create(createUrgencyRuleDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新紧急规则' })
  @ApiParam({ name: 'id', description: '规则ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  update(
    @Param('id') id: string,
    @Body() updateUrgencyRuleDto: UpdateUrgencyRuleDto,
  ) {
    return this.urgencyRuleService.update(id, updateUrgencyRuleDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除紧急规则' })
  @ApiParam({ name: 'id', description: '规则ID' })
  @ApiResponse({ status: 200, description: '删除成功' })
  remove(@Param('id') id: string) {
    return this.urgencyRuleService.remove(id);
  }

  @Post('recalculate-queue')
  @ApiOperation({ summary: '重新计算队列优先级' })
  @ApiResponse({ status: 200, description: '计算完成' })
  recalculateQueue() {
    return this.urgencyRuleService.recalculateQueue();
  }
}
