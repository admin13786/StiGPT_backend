import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { IssueTypeService } from './issue-type.service';
import { CreateIssueTypeDto } from './dto/create-issue-type.dto';
import { UpdateIssueTypeDto } from './dto/update-issue-type.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('issue-types')
@Controller('issue-types')
export class IssueTypeController {
  constructor(private readonly issueTypeService: IssueTypeService) {}

  // 获取启用的问题类型（公开接口，玩家端使用）
  @Public()
  @Get()
  @ApiOperation({ summary: '获取启用的问题类型（玩家端）' })
  @ApiResponse({ status: 200, description: '返回问题类型列表' })
  findEnabled() {
    return this.issueTypeService.findEnabled();
  }

  // 获取所有问题类型（管理端和客服端）
  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '获取所有问题类型（管理端和客服端）' })
  @ApiResponse({ status: 200, description: '返回问题类型列表' })
  findAll() {
    return this.issueTypeService.findAll();
  }

  // 获取单个问题类型
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '获取问题类型详情（管理端）' })
  @ApiParam({ name: 'id', description: '问题类型ID' })
  @ApiResponse({ status: 200, description: '返回问题类型信息' })
  findOne(@Param('id') id: string) {
    return this.issueTypeService.findOne(id);
  }

  // 创建问题类型
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '创建问题类型（管理端）' })
  @ApiResponse({ status: 201, description: '创建成功' })
  create(@Body() createDto: CreateIssueTypeDto) {
    return this.issueTypeService.create(createDto);
  }

  // 更新问题类型
  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '更新问题类型（管理端）' })
  @ApiParam({ name: 'id', description: '问题类型ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  update(@Param('id') id: string, @Body() updateDto: UpdateIssueTypeDto) {
    return this.issueTypeService.update(id, updateDto);
  }

  // 切换启用状态
  @Patch(':id/toggle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '切换问题类型启用状态（管理端）' })
  @ApiParam({ name: 'id', description: '问题类型ID' })
  @ApiResponse({ status: 200, description: '切换成功' })
  toggle(@Param('id') id: string) {
    return this.issueTypeService.toggle(id);
  }

  // 删除问题类型
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '删除问题类型（管理端）' })
  @ApiParam({ name: 'id', description: '问题类型ID' })
  @ApiResponse({ status: 200, description: '删除成功' })
  remove(@Param('id') id: string) {
    return this.issueTypeService.remove(id);
  }
}
