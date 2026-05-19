/**
 * Swagger辅助装饰器
 * 用于快速为Controller添加Swagger文档
 */

import { applyDecorators } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';

/**
 * 为Controller添加Swagger标签
 */
export function ApiController(tag: string) {
  return applyDecorators(ApiTags(tag));
}

/**
 * 为需要认证的接口添加Bearer Auth
 */
export function ApiAuth() {
  return applyDecorators(ApiBearerAuth('JWT-auth'));
}

/**
 * 为接口添加操作描述
 */
export function ApiOperationSummary(summary: string) {
  return applyDecorators(ApiOperation({ summary }));
}

/**
 * 为接口添加参数描述
 */
export function ApiParamDescription(name: string, description: string) {
  return applyDecorators(ApiParam({ name, description }));
}

/**
 * 为接口添加查询参数描述
 */
export function ApiQueryDescription(
  name: string,
  description: string,
  required = false,
  type: any = String,
) {
  return applyDecorators(ApiQuery({ name, description, required, type }));
}
