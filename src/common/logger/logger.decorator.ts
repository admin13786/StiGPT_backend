import { Inject } from '@nestjs/common';
import { LoggerService } from './logger.service';

export const Logger = (context?: string) => {
  return (target: any, propertyKey?: string, parameterIndex?: number) => {
    const logger = new LoggerService();
    const contextName = context || target.constructor.name;

    // 创建一个代理对象，自动添加 context
    const loggerProxy = new Proxy(logger, {
      get(target, prop) {
        if (typeof target[prop] === 'function') {
          return function (...args: any[]) {
            // 如果方法需要 context 参数，自动添加
            if (
              prop === 'log' ||
              prop === 'error' ||
              prop === 'warn' ||
              prop === 'debug' ||
              prop === 'verbose'
            ) {
              const originalArgs = [...args];
              // 如果第二个参数不是字符串（context），则插入 context
              if (
                originalArgs.length >= 2 &&
                typeof originalArgs[1] !== 'string'
              ) {
                originalArgs.splice(1, 0, contextName);
              } else if (originalArgs.length === 1) {
                originalArgs.push(contextName);
              } else if (
                originalArgs.length >= 2 &&
                typeof originalArgs[1] === 'string'
              ) {
                // 如果已经有 context，替换为我们的 context
                originalArgs[1] = contextName;
              }
              return target[prop].apply(target, originalArgs);
            }
            return target[prop].apply(target, args);
          };
        }
        return target[prop];
      },
    });

    return loggerProxy;
  };
};

// 简单的注入装饰器
export const InjectLogger = () => Inject(LoggerService);
