import { ApiProperty } from '@nestjs/swagger';

/**
 * 统一响应结构的泛型包装类
 * 用于包装所有 API 响应，确保响应格式一致
 */
export class BaseResponse<T> {
  @ApiProperty({
    example: 200,
    description: '响应状态码',
  })
  code: number;

  @ApiProperty({
    example: 'success',
    description: '响应消息',
  })
  message: string;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: '时间戳（ISO 格式）',
  })
  timestamp: string;

  // data 字段不添加 @ApiProperty 装饰器
  // 由 @ApiResult 装饰器动态处理
  data: T;
}
