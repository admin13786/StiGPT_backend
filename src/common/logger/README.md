# Logger 使用示例

## 基本使用

### 方式一：使用 CustomLogger（推荐）

```typescript
import { Injectable } from '@nestjs/common';
import { CustomLogger } from '../common/logger/custom-logger';

@Injectable()
export class UserService {
  private readonly logger = new CustomLogger(UserService.name);

  async createUser(data: CreateUserDto) {
    try {
      this.logger.log('开始创建用户', { username: data.username });
      const user = await this.prisma.user.create({ data });
      this.logger.log('用户创建成功', { userId: user.id });
      return user;
    } catch (error) {
      this.logger.error('创建用户失败', error.stack, 'UserService', { username: data.username });
      throw error;
    }
  }
}
```

### 方式二：使用 NestJS Logger（已配置为使用自定义 LoggerService）

```typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  async createUser(data: CreateUserDto) {
    try {
      this.logger.log('开始创建用户');
      const user = await this.prisma.user.create({ data });
      this.logger.log('用户创建成功');
      return user;
    } catch (error) {
      this.logger.error('创建用户失败', error.stack);
      throw error;
    }
  }
}
```

## 日志级别

```typescript
// ERROR - 错误日志（始终记录）
this.logger.error('操作失败', error.stack, 'ServiceName', { additionalData });

// WARN - 警告日志
this.logger.warn('数据可能不完整', 'ServiceName', { userId: 123 });

// LOG - 信息日志
this.logger.log('操作成功', 'ServiceName', { result });

// DEBUG - 调试日志（仅在开发环境）
this.logger.debug('调试信息', 'ServiceName', { debugData });

// VERBOSE - 详细日志（仅在开发环境）
this.logger.verbose('详细信息', 'ServiceName', { verboseData });
```

## 在异常过滤器中使用

```typescript
import { LoggerService } from '../logger/logger.service';

export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new LoggerService();

  catch(exception: unknown, host: ArgumentsHost) {
    // ... 错误处理逻辑
    this.logger.error('HTTP错误', exception.stack, 'HttpExceptionFilter', {
      path: request.url,
      method: request.method,
    });
  }
}
```

