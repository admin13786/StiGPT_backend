import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { QuickReplyService } from './quick-reply.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import { UpdateReplyDto } from './dto/update-reply.dto';
import { QueryReplyDto } from './dto/query-reply.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('QuickReply')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('quick-reply')
export class QuickReplyController {
  constructor(private readonly quickReplyService: QuickReplyService) {}

  // ========== 分类接口 ==========

  @ApiOperation({ summary: '获取分类列表' })
  @Get('categories')
  async getCategories(@CurrentUser() user: User) {
    return this.quickReplyService.getCategories(user.id, user.role === 'ADMIN');
  }

  @ApiOperation({ summary: '创建分类' })
  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  async createCategory(
    @CurrentUser() user: User,
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    return this.quickReplyService.createCategory(
      user.id,
      user.role === 'ADMIN',
      createCategoryDto,
    );
  }

  @ApiOperation({ summary: '更新分类' })
  @Patch('categories/:id')
  async updateCategory(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.quickReplyService.updateCategory(
      id,
      user.id,
      user.role === 'ADMIN',
      updateCategoryDto,
    );
  }

  @ApiOperation({ summary: '删除分类' })
  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCategory(@Param('id') id: string, @CurrentUser() user: User) {
    await this.quickReplyService.deleteCategory(
      id,
      user.id,
      user.role === 'ADMIN',
    );
  }

  // ========== 快捷回复接口 ==========

  @ApiOperation({ summary: '获取快捷回复列表' })
  @Get('replies')
  async getReplies(@CurrentUser() user: User, @Query() query: QueryReplyDto) {
    return this.quickReplyService.getReplies(
      user.id,
      user.role === 'ADMIN',
      query,
    );
  }

  @ApiOperation({ summary: '创建快捷回复' })
  @Post('replies')
  @HttpCode(HttpStatus.CREATED)
  async createReply(
    @CurrentUser() user: User,
    @Body() createReplyDto: CreateReplyDto,
  ) {
    return this.quickReplyService.createReply(
      user.id,
      user.role === 'ADMIN',
      createReplyDto,
    );
  }

  @ApiOperation({ summary: '更新快捷回复' })
  @Patch('replies/:id')
  async updateReply(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() updateReplyDto: UpdateReplyDto,
  ) {
    return this.quickReplyService.updateReply(
      id,
      user.id,
      user.role === 'ADMIN',
      updateReplyDto,
    );
  }

  @ApiOperation({ summary: '删除快捷回复' })
  @Delete('replies/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteReply(@Param('id') id: string, @CurrentUser() user: User) {
    await this.quickReplyService.deleteReply(
      id,
      user.id,
      user.role === 'ADMIN',
    );
  }

  // ========== 收藏接口 ==========

  @ApiOperation({ summary: '切换收藏状态' })
  @Post('replies/:id/favorite')
  @HttpCode(HttpStatus.OK)
  async toggleFavorite(@Param('id') id: string, @CurrentUser() user: User) {
    await this.quickReplyService.toggleFavorite(id, user.id);
    return { success: true };
  }

  @ApiOperation({ summary: '获取我的收藏' })
  @Get('favorites')
  async getUserFavorites(
    @CurrentUser() user: User,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
  ) {
    return this.quickReplyService.getUserFavorites(user.id, page, pageSize);
  }

  // ========== 统计接口 ==========

  @ApiOperation({ summary: '增加使用次数' })
  @Post('replies/:id/usage')
  @HttpCode(HttpStatus.OK)
  async incrementUsage(@Param('id') id: string) {
    await this.quickReplyService.incrementUsage(id);
    return { success: true };
  }
}
