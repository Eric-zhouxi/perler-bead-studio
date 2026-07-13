import { HttpError } from './http.js';

export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'validation_error', '提交的数据不正确', result.error.flatten());
  }
  return result.data;
}
