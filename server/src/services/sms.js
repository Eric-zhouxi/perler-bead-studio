import tencentcloud from 'tencentcloud-sdk-nodejs-sms';
import { config } from '../config.js';
import { HttpError } from '../http.js';

let client;

function getClient() {
  if (!config.smsConfigured) throw new HttpError(503, 'sms_not_configured', '短信服务尚未配置');
  if (!client) {
    const SmsClient = tencentcloud.sms.v20210111.Client;
    client = new SmsClient({
      credential: { secretId: config.TENCENT_SECRET_ID, secretKey: config.TENCENT_SECRET_KEY },
      region: config.TENCENT_SMS_REGION,
      profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } },
    });
  }
  return client;
}
export async function sendVerificationSms(phone, code, expiresMinutes = 5) {
  const response = await getClient().SendSms({
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: config.TENCENT_SMS_APP_ID,
    SignName: config.TENCENT_SMS_SIGN_NAME,
    TemplateId: config.TENCENT_SMS_TEMPLATE_ID,
    TemplateParamSet: [code, String(expiresMinutes)],
  });
  const status = response.SendStatusSet?.[0];
  if (!status || status.Code !== 'Ok') {
    throw new HttpError(502, 'sms_delivery_failed', '验证码发送失败', { providerCode: status?.Code });
  }
}
