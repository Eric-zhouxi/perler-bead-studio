export class HttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
export function assert(condition, statusCode, code, message, details) {
  if (!condition) throw new HttpError(statusCode, code, message, details);
}

export function requestIp(request) {
  return request.ip || request.socket?.remoteAddress || null;
}
