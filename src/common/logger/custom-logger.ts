import { Injectable } from '@nestjs/common';
import { LoggerService } from './logger.service';

/**
 * 自定义 Logger 类，用于在服务中方便地使用日志
 * 使用方式：
 * private readonly logger = new CustomLogger(ServiceName.name);
 */
@Injectable()
export class CustomLogger {
  constructor(
    private readonly context: string,
    private readonly loggerService: LoggerService = new LoggerService(),
  ) {}

  log(message: any, ...optionalParams: any[]) {
    this.loggerService.log(message, this.context, ...optionalParams);
  }

  error(message: any, trace?: string, ...optionalParams: any[]) {
    this.loggerService.error(message, trace, this.context, ...optionalParams);
  }

  warn(message: any, ...optionalParams: any[]) {
    this.loggerService.warn(message, this.context, ...optionalParams);
  }

  debug(message: any, ...optionalParams: any[]) {
    this.loggerService.debug(message, this.context, ...optionalParams);
  }

  verbose(message: any, ...optionalParams: any[]) {
    this.loggerService.verbose(message, this.context, ...optionalParams);
  }
}
