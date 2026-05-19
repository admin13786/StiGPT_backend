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
import { GameService } from './game.service';
import { CreateGameDto, UpdateGameDto } from './dto/create-game.dto';
import { CreateServerDto, UpdateServerDto } from './dto/create-server.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('games')
@Controller('games')
export class GameController {
  constructor(private readonly gameService: GameService) {}

  // 玩家端API - 获取已启用的游戏列表
  @Public()
  @Get('enabled')
  @ApiOperation({ summary: '获取已启用的游戏列表（玩家端）' })
  @ApiResponse({ status: 200, description: '返回游戏列表' })
  findEnabled() {
    return this.gameService.findEnabled();
  }

  // 管理端API - 需要认证
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '获取所有游戏列表（管理端）' })
  @ApiResponse({ status: 200, description: '返回游戏列表' })
  findAll() {
    return this.gameService.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get(':id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '获取游戏详情（管理端）' })
  @ApiParam({ name: 'id', description: '游戏ID' })
  @ApiResponse({ status: 200, description: '返回游戏信息' })
  findOne(@Param('id') id: string) {
    return this.gameService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '创建游戏（管理端）' })
  @ApiResponse({ status: 201, description: '创建成功' })
  create(@Body() createGameDto: CreateGameDto) {
    return this.gameService.create(createGameDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch(':id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '更新游戏（管理端）' })
  @ApiParam({ name: 'id', description: '游戏ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  update(@Param('id') id: string, @Body() updateGameDto: UpdateGameDto) {
    return this.gameService.update(id, updateGameDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '删除游戏（管理端）' })
  @ApiParam({ name: 'id', description: '游戏ID' })
  @ApiResponse({ status: 200, description: '删除成功' })
  remove(@Param('id') id: string) {
    return this.gameService.remove(id);
  }

  // 区服管理
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get(':gameId/servers')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '获取游戏的区服列表（管理端）' })
  @ApiParam({ name: 'gameId', description: '游戏ID' })
  @ApiResponse({ status: 200, description: '返回区服列表' })
  findServersByGame(@Param('gameId') gameId: string) {
    return this.gameService.findServersByGame(gameId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post(':gameId/servers')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '创建区服（管理端）' })
  @ApiParam({ name: 'gameId', description: '游戏ID' })
  @ApiResponse({ status: 201, description: '创建成功' })
  createServer(
    @Param('gameId') gameId: string,
    @Body() createServerDto: Omit<CreateServerDto, 'gameId'>,
  ) {
    return this.gameService.createServer({ ...createServerDto, gameId });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('servers/:id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '更新区服（管理端）' })
  @ApiParam({ name: 'id', description: '区服ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  updateServer(
    @Param('id') id: string,
    @Body() updateServerDto: UpdateServerDto,
  ) {
    return this.gameService.updateServer(id, updateServerDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete('servers/:id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '删除区服（管理端）' })
  @ApiParam({ name: 'id', description: '区服ID' })
  @ApiResponse({ status: 200, description: '删除成功' })
  removeServer(@Param('id') id: string) {
    return this.gameService.removeServer(id);
  }
}
