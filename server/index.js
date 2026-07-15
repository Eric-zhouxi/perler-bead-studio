import { buildApp } from './src/app.js';

let appPromise;

function getApp() {
  appPromise ||= buildApp();
  return appPromise;
}

function requestUrl(event) {
  const pathname = event.path || '/';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(event.queryStringParameters || {})) {
    if (Array.isArray(value)) value.forEach(item => params.append(key, String(item)));
    else if (value != null) params.append(key, String(value));
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function responseHeaders(headers) {
  const result = { ...headers };
  delete result['content-length'];
  delete result['transfer-encoding'];
  return result;
}

export async function main(event = {}) {
  const app = await getApp();
  const payload = event.body == null
    ? undefined
    : event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : event.body;
  const response = await app.inject({
    method: event.httpMethod || 'GET',
    url: requestUrl(event),
    headers: event.headers || {},
    payload,
  });

  return {
    statusCode: response.statusCode,
    headers: responseHeaders(response.headers),
    body: response.rawPayload.toString('base64'),
    isBase64Encoded: true,
  };
}
