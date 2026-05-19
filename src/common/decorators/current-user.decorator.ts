import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// 获取当前用户
// 参数：data - 数据

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
