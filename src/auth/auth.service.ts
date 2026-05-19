import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthException, ErrorCodes } from '../common/exceptions';
import { BusinessException } from '../common/exceptions/business.exception';
import { LoginDto, LoginResponseDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private websocketGateway: WebsocketGateway,
  ) {}

  async validateUser(username: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      throw new AuthException(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    if (user.deletedAt) {
      throw new AuthException(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    // 密码验证：只支持 BCrypt 哈希密码（生产环境标准）
    let isPasswordValid = false;

    if (!user.password) {
      throw new AuthException(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    // 检查是否是 bcrypt 哈希密码
    if (
      user.password.startsWith('$2b$') ||
      user.password.startsWith('$2a$') ||
      user.password.startsWith('$2y$')
    ) {
      try {
        isPasswordValid = await bcrypt.compare(password, user.password);
      } catch (error) {
        this.logger.error('密码验证错误', error);
        isPasswordValid = false;
      }
    } else {
      // 如果不是 bcrypt 格式，尝试用 bcrypt 验证（兼容性处理）
      try {
        isPasswordValid = await bcrypt.compare(password, user.password);
      } catch (error) {
        // 忽略错误
        isPasswordValid = false;
      }
    }

    if (!isPasswordValid) {
      throw new AuthException(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }
    const { password: _, ...result } = user;
    return result;
  }

  async login(loginDto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.validateUser(loginDto.username, loginDto.password);

    // 更新最后登录时间及在线状态
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), isOnline: true },
    });

    if (user.role === 'AGENT') {
      this.websocketGateway.notifyAgentStatusChange(user.id, true, {
        username: user.username,
        realName: user.realName || undefined,
      });
    }

    const payload = { username: user.username, sub: user.id, role: user.role };
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '8h',
    });

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        realName: user.realName || undefined,
      },
    };
  }

  async register(dto: RegisterDto): Promise<LoginResponseDto> {
    // 检查用户名是否已存在
    const existing = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existing) {
      throw new BusinessException(ErrorCodes.AUTH_USER_EXISTS, '用户名已存在', 409);
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        password: hashedPassword,
        role: 'USER',
        realName: dto.realName,
        email: dto.email,
        lastLoginAt: new Date(),
        isOnline: true,
      },
    });

    const payload = { username: user.username, sub: user.id, role: user.role };
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '8h',
    });

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        realName: user.realName || undefined,
      },
    };
  }

  async validateToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      return payload;
    } catch (error) {
      throw new AuthException(ErrorCodes.AUTH_INVALID_TOKEN);
    }
  }

  async logout(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        username: true,
        realName: true,
      },
    });

    if (!user) {
      throw new AuthException(ErrorCodes.AUTH_USER_NOT_FOUND);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { isOnline: false },
    });

    if (user.role === 'AGENT') {
      this.websocketGateway.notifyAgentStatusChange(userId, false, {
        username: user.username,
        realName: user.realName || undefined,
      });
    }

    return { success: true };
  }
}
