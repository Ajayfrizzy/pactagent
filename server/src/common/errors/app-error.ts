export type ApiErrorType =
  | 'authentication_error'
  | 'permission_error'
  | 'invalid_request_error'
  | 'not_found_error'
  | 'conflict_error'
  | 'rate_limit_error'
  | 'internal_error';

export class AppError extends Error {
  readonly statusCode: number;
  readonly type: ApiErrorType;
  readonly code: string;
  readonly details?: unknown;

  constructor(params: {
    statusCode: number;
    type: ApiErrorType;
    code: string;
    message: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.statusCode = params.statusCode;
    this.type = params.type;
    this.code = params.code;
    this.details = params.details;
  }
}

export function authenticationError(message = 'Authentication required.') {
  return new AppError({
    statusCode: 401,
    type: 'authentication_error',
    code: 'authentication_required',
    message,
  });
}

export function permissionError(message = 'Permission denied.', code = 'permission_denied') {
  return new AppError({
    statusCode: 403,
    type: 'permission_error',
    code,
    message,
  });
}

export function invalidRequest(message: string, code = 'invalid_request', details?: unknown) {
  return new AppError({
    statusCode: 400,
    type: 'invalid_request_error',
    code,
    message,
    details,
  });
}

export function notFound(message = 'Resource not found.', code = 'not_found') {
  return new AppError({
    statusCode: 404,
    type: 'not_found_error',
    code,
    message,
  });
}

export function conflict(message: string, code = 'conflict') {
  return new AppError({
    statusCode: 409,
    type: 'conflict_error',
    code,
    message,
  });
}

export function rateLimitError(message = 'Too many requests. Please slow down and try again shortly.') {
  return new AppError({
    statusCode: 429,
    type: 'rate_limit_error',
    code: 'rate_limit_exceeded',
    message,
  });
}
