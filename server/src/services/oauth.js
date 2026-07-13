import { config } from '../config.js';
import { HttpError } from '../http.js';

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { Accept: 'application/json', ...options.headers } });
    if (!response.ok) throw new HttpError(502, 'oauth_provider_error', '第三方登录服务暂时不可用', { status: response.status });
    return response;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'oauth_provider_error', '第三方登录服务暂时不可用');
  } finally {
    clearTimeout(timeout);
  }
}
export function oauthAuthorizeUrl(provider, state) {
  if (provider === 'wechat') {
    const query = new URLSearchParams({
      appid: config.WECHAT_APP_ID,
      redirect_uri: config.WECHAT_REDIRECT_URI,
      response_type: 'code',
      scope: 'snsapi_login',
      state,
    });
    return `https://open.weixin.qq.com/connect/qrconnect?${query}#wechat_redirect`;
  }
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: config.QQ_APP_ID,
    redirect_uri: config.QQ_REDIRECT_URI,
    state,
    scope: 'get_user_info',
  });
  return `https://graph.qq.com/oauth2.0/authorize?${query}`;
}

async function exchangeWechat(code) {
  const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  tokenUrl.search = new URLSearchParams({
    appid: config.WECHAT_APP_ID,
    secret: config.WECHAT_APP_SECRET,
    code,
    grant_type: 'authorization_code',
  });
  const token = await (await fetchWithTimeout(tokenUrl)).json();
  if (!token.access_token || !token.openid) throw new HttpError(401, 'oauth_exchange_failed', '微信授权失败', { providerCode: token.errcode });
  const profileUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
  profileUrl.search = new URLSearchParams({ access_token: token.access_token, openid: token.openid, lang: 'zh_CN' });
  const profile = await (await fetchWithTimeout(profileUrl)).json();
  if (profile.errcode) throw new HttpError(401, 'oauth_profile_failed', '无法获取微信用户资料', { providerCode: profile.errcode });
  return {
    providerUserId: token.openid,
    unionId: token.unionid || profile.unionid || null,
    nickname: profile.nickname || '微信用户',
    avatarUrl: profile.headimgurl || null,
    profile,
  };
}

function parseQqCallback(text) {
  const match = text.match(/callback\(\s*({.*})\s*\);?/s);
  if (!match) throw new HttpError(502, 'oauth_provider_error', 'QQ 登录响应格式不正确');
  return JSON.parse(match[1]);
}

async function exchangeQq(code) {
  const tokenUrl = new URL('https://graph.qq.com/oauth2.0/token');
  tokenUrl.search = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.QQ_APP_ID,
    client_secret: config.QQ_APP_KEY,
    code,
    redirect_uri: config.QQ_REDIRECT_URI,
    fmt: 'json',
  });
  const tokenResponse = await fetchWithTimeout(tokenUrl);
  const tokenText = await tokenResponse.text();
  let token;
  try {
    token = JSON.parse(tokenText);
  } catch {
    token = Object.fromEntries(new URLSearchParams(tokenText));
  }
  if (!token.access_token) throw new HttpError(401, 'oauth_exchange_failed', 'QQ 授权失败', { providerCode: token.error });

  const meUrl = new URL('https://graph.qq.com/oauth2.0/me');
  meUrl.search = new URLSearchParams({ access_token: token.access_token, fmt: 'json' });
  const meText = await (await fetchWithTimeout(meUrl)).text();
  let me;
  try {
    me = JSON.parse(meText);
  } catch {
    me = parseQqCallback(meText);
  }
  if (!me.openid) throw new HttpError(401, 'oauth_profile_failed', '无法获取 QQ 用户标识');

  const profileUrl = new URL('https://graph.qq.com/user/get_user_info');
  profileUrl.search = new URLSearchParams({ access_token: token.access_token, oauth_consumer_key: config.QQ_APP_ID, openid: me.openid, fmt: 'json' });
  const profile = await (await fetchWithTimeout(profileUrl)).json();
  if (profile.ret !== 0) throw new HttpError(401, 'oauth_profile_failed', '无法获取 QQ 用户资料', { providerCode: profile.ret });
  return {
    providerUserId: me.openid,
    unionId: me.unionid || null,
    nickname: profile.nickname || 'QQ用户',
    avatarUrl: profile.figureurl_qq_2 || profile.figureurl_qq_1 || null,
    profile,
  };
}

export function exchangeOAuthCode(provider, code) {
  return provider === 'wechat' ? exchangeWechat(code) : exchangeQq(code);
}
