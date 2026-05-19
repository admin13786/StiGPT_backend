import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { BaseResponse } from '../dto/base-response.dto';

/**
 * 自定义装饰器，用于为 Swagger 响应 Schema 包裹 BaseResponse 结构
 *
 * @param model - DTO 类，用于定义 data 字段的类型
 * @param isArray - 可选，默认 false。为 true 时，data 字段为数组类型
 *
 * @example
 * // 单个对象响应
 * @ApiResult(LoginResponseDto)
 *
 * @example
 * // 数组响应
 * @ApiResult(UserDto, true)
 */
export const ApiResult = <TModel extends Type<any>>(
  model: TModel,
  isArray: boolean = false,
) => {
  return applyDecorators(
    // 注册 BaseResponse 和传入的 model 到 Swagger Schema
    ApiExtraModels(BaseResponse, model),

    // 使用 ApiOkResponse 自定义响应 Schema
    ApiOkResponse({
      schema: {
        // 使用 allOf 组合 BaseResponse 和 data 字段
        allOf: [
          // 引用 BaseResponse 的基础字段（code, message, timestamp）
          { $ref: getSchemaPath(BaseResponse) },

          // 定义 data 字段的类型
          {
            properties: {
              data: isArray
                ? {
                    // 数组类型：data 是 model 的数组
                    type: 'array',
                    items: { $ref: getSchemaPath(model) },
                  }
                : {
                    // 对象类型：data 直接引用 model
                    $ref: getSchemaPath(model),
                  },
            },
          },
        ],
      },
    }),
  );
};
