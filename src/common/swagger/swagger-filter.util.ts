/**
 * Swagger 文档过滤工具函数
 * 用于判断 API 端点应该出现在哪个 Swagger 文档中
 */

/**
 * 判断端点是否属于管理端 API
 *
 * @param path - API 路径
 * @param tags - API 标签数组
 * @returns 如果是管理端 API 返回 true，否则返回 false
 *
 * 判断规则：
 * - 路径以 /admin 开头，或
 * - 标签中有任意一个以 Admin 开头
 */
export function isAdminEndpoint(path: string, tags: string[]): boolean {
  // 检查路径是否以 /admin 开头
  if (path.startsWith('/admin')) {
    return true;
  }

  // 检查标签中是否有以 Admin 开头的
  if (tags && tags.some((tag) => tag.startsWith('Admin'))) {
    return true;
  }

  return false;
}

/**
 * 判断端点是否属于玩家端 API
 *
 * @param path - API 路径
 * @param tags - API 标签数组
 * @returns 如果是玩家端 API 返回 true，否则返回 false
 *
 * 判断规则：
 * - 路径以 /app 或 /client 开头，或
 * - 标签中有任意一个以 App 开头
 */
export function isPlayerEndpoint(path: string, tags: string[]): boolean {
  // 检查路径是否以 /app 或 /client 开头
  if (path.startsWith('/app') || path.startsWith('/client')) {
    return true;
  }

  // 检查标签中是否有以 App 开头的
  if (tags && tags.some((tag) => tag.startsWith('App'))) {
    return true;
  }

  return false;
}
