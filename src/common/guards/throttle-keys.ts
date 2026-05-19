type RequestLike = Record<string, any>;

const normalize = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value) && value.length > 0) {
    return normalize(value[0]);
  }
  return undefined;
};

export const getUserIdFromRequest = (req: RequestLike): string | undefined => {
  return normalize(req?.user?.id) || normalize(req?.user?.userId);
};

export const getSessionIdFromRequest = (
  req: RequestLike,
): string | undefined => {
  const direct =
    normalize(req?.body?.sessionId) ||
    normalize(req?.params?.sessionId) ||
    normalize(req?.query?.sessionId);
  if (direct) {
    return direct;
  }

  const baseUrl = normalize(req?.baseUrl);
  if (baseUrl && baseUrl.endsWith('/sessions')) {
    const id = normalize(req?.params?.id);
    if (id) {
      return id;
    }
  }

  return undefined;
};

export const getTicketTokenFromRequest = (
  req: RequestLike,
): string | undefined => {
  return (
    normalize(req?.headers?.['x-ticket-token']) ||
    normalize(req?.query?.token) ||
    normalize(req?.body?.token) ||
    normalize(req?.params?.token) ||
    normalize(req?.query?.ticketToken) ||
    normalize(req?.body?.ticketToken) ||
    normalize(req?.params?.ticketToken)
  );
};

export const getTicketIdFromRequest = (req: RequestLike): string | undefined =>
  normalize(req?.body?.ticketId);

export const getConversationIdFromRequest = (
  req: RequestLike,
): string | undefined => {
  return (
    normalize(req?.body?.conversation_id) ||
    normalize(req?.body?.conversationId) ||
    normalize(req?.query?.conversation_id) ||
    normalize(req?.query?.conversationId)
  );
};

export const getClientIpFromRequest = (req: RequestLike): string => {
  const forwardedFor = normalize(req?.headers?.['x-forwarded-for']);
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim() || 'unknown';
  }

  const ip =
    normalize(req?.ip) ||
    normalize(req?.connection?.remoteAddress) ||
    normalize(req?.socket?.remoteAddress);
  return ip || 'unknown';
};

export const getDefaultThrottleKey = (
  req: RequestLike,
  _context?: unknown,
): string => {
  const userId = getUserIdFromRequest(req);
  if (userId) {
    return `user:${userId}`;
  }

  const sessionId = getSessionIdFromRequest(req);
  if (sessionId) {
    return `session:${sessionId}`;
  }

  const token = getTicketTokenFromRequest(req);
  if (token) {
    return `token:${token}`;
  }

  return `ip:${getClientIpFromRequest(req)}`;
};

export const getDifyThrottleKey = (
  req: RequestLike,
  _context?: unknown,
): string => {
  const conversationId = getConversationIdFromRequest(req);
  if (conversationId) {
    return `conversation:${conversationId}`;
  }

  const sessionId = getSessionIdFromRequest(req);
  if (sessionId) {
    return `session:${sessionId}`;
  }

  const token = getTicketTokenFromRequest(req);
  if (token) {
    return `token:${token}`;
  }

  const ticketId = getTicketIdFromRequest(req);
  if (ticketId) {
    return `ticket:${ticketId}`;
  }

  const userId = getUserIdFromRequest(req);
  if (userId) {
    return `user:${userId}`;
  }

  return `ip:${getClientIpFromRequest(req)}`;
};

const normalizePath = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
};

export const isDifyHttpRequest = (req: RequestLike): boolean => {
  const method = normalize(req?.method)?.toUpperCase() || '';
  if (method !== 'POST') {
    return false;
  }

  const baseUrl = normalizePath(req?.baseUrl);
  const routePath = normalizePath(req?.route?.path) || normalizePath(req?.path);

  if (baseUrl.endsWith('/dify') && routePath === '/chat-messages') {
    return true;
  }

  if (baseUrl.endsWith('/sessions')) {
    if (routePath === '/' || routePath === '') {
      return true;
    }
    if (routePath === '/:id/messages') {
      return true;
    }
    if (/^\/[^/]+\/messages$/.test(routePath)) {
      return true;
    }
  }

  return false;
};
