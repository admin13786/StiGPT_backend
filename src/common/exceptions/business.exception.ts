import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCodes } from './error-codes';

/**
 * 业务异常基类
 */
export class BusinessException extends HttpException {
  readonly errorCode: ErrorCodes;
  private readonly responseData: any;

  constructor(
    errorCode: ErrorCodes,
    message: string = '操作失败',
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    data: any = null,
  ) {
    const responseBody = {
      success: false,
      code: errorCode,
      message,
      data,
    };
    super(responseBody, status);
    this.errorCode = errorCode;
    this.responseData = data;
  }

  getCode(): ErrorCodes {
    return this.errorCode;
  }

  getData(): any {
    return this.responseData;
  }
}

/**
 * 认证异常
 */
export class AuthException extends BusinessException {
  constructor(
    errorCode: ErrorCodes = ErrorCodes.UNAUTHORIZED,
    message: string = '认证失败',
  ) {
    super(errorCode, message, HttpStatus.UNAUTHORIZED);
  }
}

/**
 * 未找到异常
 */
export class NotFoundException extends BusinessException {
  constructor(
    errorCode: ErrorCodes = ErrorCodes.NOT_FOUND,
    message: string = '资源不存在',
  ) {
    super(errorCode, message, HttpStatus.NOT_FOUND);
  }
}

/**
 * 抛出用户不存在异常
 */
export function throwUserNotFound(message: string = '用户不存在'): never {
  throw new NotFoundException(ErrorCodes.USER_NOT_FOUND, message);
}

/**
 * 抛出游戏不存在异常
 */
export function throwGameNotFound(message: string = '游戏不存在'): never {
  throw new NotFoundException(ErrorCodes.GAME_NOT_FOUND, message);
}

/**
 * 抛出工单不存在异常
 */
export function throwTicketNotFound(message: string = '工单不存在'): never {
  throw new NotFoundException(ErrorCodes.TICKET_NOT_FOUND, message);
}

/**
 * 抛出会话不存在异常
 */
export function throwSessionNotFound(message: string = '会话不存在'): never {
  throw new NotFoundException(ErrorCodes.SESSION_NOT_FOUND, message);
}
