export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

// Convenience factories for the codes used across the API.
export const Errors = {
  invalidRequest: (message = 'Invalid request') => new ApiError(400, 'INVALID_REQUEST', message),
  unauthorized: (message = 'Unauthorized') => new ApiError(401, 'UNAUTHORIZED', message),
  passwordRequired: (message = 'This share requires a password') =>
    new ApiError(401, 'PASSWORD_REQUIRED', message),
  invalidPassword: (message = 'Incorrect password') => new ApiError(403, 'INVALID_PASSWORD', message),
  forbidden: (message = 'Forbidden') => new ApiError(403, 'FORBIDDEN', message),
  shareNotFound: (message = 'Share not found') => new ApiError(404, 'SHARE_NOT_FOUND', message),
  notFound: (message = 'Not found') => new ApiError(404, 'NOT_FOUND', message),
  conflict: (message = 'Conflict') => new ApiError(409, 'CONFLICT', message),
  shareExpired: (message = 'This link has expired') => new ApiError(410, 'SHARE_EXPIRED', message),
  accessLimitReached: (message = 'Access limit reached for this link') =>
    new ApiError(410, 'ACCESS_LIMIT_REACHED', message),
  fileTooLarge: (message = 'File exceeds the maximum allowed size') =>
    new ApiError(413, 'FILE_TOO_LARGE', message),
  textTooLarge: (message = 'Text exceeds the maximum allowed length') =>
    new ApiError(413, 'TEXT_TOO_LARGE', message),
  unsupportedFileType: (message = 'This file type is not allowed') =>
    new ApiError(415, 'UNSUPPORTED_FILE_TYPE', message),
  rateLimited: (message = 'Too many attempts. Please try again later.') =>
    new ApiError(429, 'RATE_LIMITED', message),
  internal: (message = 'Internal server error') => new ApiError(500, 'INTERNAL_ERROR', message),
};
