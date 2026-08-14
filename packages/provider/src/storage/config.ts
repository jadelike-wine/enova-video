import type { UrlGuardOptions } from './downloader.js';

export type StorageProviderName = 'aws_s3' | 'qiniu' | 'none';

export interface StorageSettingsReader {
  getString(key: string): Promise<string | null>;
  getSecret(key: string): Promise<string | null>;
}

export interface StorageEnvironment {
  STORAGE_PROVIDER?: unknown;
  AWS_REGION?: unknown;
  AWS_S3_BUCKET?: unknown;
  AWS_S3_PREFIX?: unknown;
  AWS_S3_PUBLIC_BASE_URL?: unknown;
  AWS_S3_ENDPOINT_URL?: unknown;
  AWS_ACCESS_KEY_ID?: unknown;
  AWS_SECRET_ACCESS_KEY?: unknown;
  AWS_SESSION_TOKEN?: unknown;
  QINIU_ACCESS_KEY?: unknown;
  QINIU_SECRET_KEY?: unknown;
  QINIU_BUCKET?: unknown;
  QINIU_DOMAIN?: unknown;
  QINIU_REGION?: unknown;
}

export interface ResolvedStorageConfig {
  provider: StorageProviderName;
  configured: boolean;
  region: string;
  bucket: string;
  prefix: string;
  publicBaseUrl: string;
  endpointUrl: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  qiniu: {
    accessKey: string;
    secretKey: string;
    bucket: string;
    domain: string;
    region: string;
  };
}

function envString(env: StorageEnvironment, key: keyof StorageEnvironment, fallback = ''): string {
  const value = env[key];
  return value === undefined || value === null ? fallback : String(value);
}

async function settingOrEnv(
  reader: StorageSettingsReader,
  key: string,
  env: StorageEnvironment,
  envKey: keyof StorageEnvironment,
  fallback = '',
): Promise<string> {
  const persisted = await reader.getString(key);
  return persisted ?? envString(env, envKey, fallback);
}

async function secretOrEnv(
  reader: StorageSettingsReader,
  key: string,
  env: StorageEnvironment,
  envKey: keyof StorageEnvironment,
): Promise<string> {
  const persisted = await reader.getSecret(key);
  return persisted ?? envString(env, envKey);
}

/**
 * 统一的对象存储配置读取器：数据库系统设置 > 环境变量 > 注册表默认值。
 * 该函数只负责解析，不创建网络客户端；API 测试和 Worker 资源重建共用它。
 */
export async function resolveStorageConfig(
  reader: StorageSettingsReader,
  env: StorageEnvironment,
): Promise<ResolvedStorageConfig> {
  const rawProvider = await settingOrEnv(reader, 'storage.provider', env, 'STORAGE_PROVIDER', 'aws_s3');
  const provider = rawProvider === 's3' ? 'aws_s3' : rawProvider as StorageProviderName;

  const region = await settingOrEnv(reader, 'storage.awsRegion', env, 'AWS_REGION', 'ap-southeast-1');
  const bucket = await settingOrEnv(reader, 'storage.awsS3Bucket', env, 'AWS_S3_BUCKET');
  const prefix = await settingOrEnv(reader, 'storage.awsS3Prefix', env, 'AWS_S3_PREFIX', 'agnes-ai');
  const publicBaseUrl = await settingOrEnv(reader, 'storage.awsS3PublicBaseUrl', env, 'AWS_S3_PUBLIC_BASE_URL');
  const endpointUrl = await settingOrEnv(reader, 'storage.awsS3EndpointUrl', env, 'AWS_S3_ENDPOINT_URL');
  const accessKeyId = await secretOrEnv(reader, 'storage.awsAccessKeyId', env, 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = await secretOrEnv(reader, 'storage.awsSecretAccessKey', env, 'AWS_SECRET_ACCESS_KEY');
  const sessionToken = await secretOrEnv(reader, 'storage.awsSessionToken', env, 'AWS_SESSION_TOKEN');

  const qiniuAccessKey = await secretOrEnv(reader, 'storage.qiniuAccessKey', env, 'QINIU_ACCESS_KEY');
  const qiniuSecretKey = await secretOrEnv(reader, 'storage.qiniuSecretKey', env, 'QINIU_SECRET_KEY');
  const qiniuBucket = await settingOrEnv(reader, 'storage.qiniuBucket', env, 'QINIU_BUCKET');
  const qiniuDomain = await settingOrEnv(reader, 'storage.qiniuDomain', env, 'QINIU_DOMAIN');
  const qiniuRegion = await settingOrEnv(reader, 'storage.qiniuRegion', env, 'QINIU_REGION', 'z0');

  const awsCredentials = accessKeyId && secretAccessKey
    ? { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) }
    : undefined;
  const awsCredentialsValid = !accessKeyId && !secretAccessKey || Boolean(awsCredentials);
  const awsConfigured = Boolean(region && bucket && awsCredentialsValid);
  const qiniuConfigured = Boolean(qiniuAccessKey && qiniuSecretKey && qiniuBucket && qiniuDomain && qiniuRegion);

  return {
    provider,
    configured: provider === 'none' || (provider === 'aws_s3' ? awsConfigured : provider === 'qiniu' ? qiniuConfigured : false),
    region,
    bucket,
    prefix,
    publicBaseUrl,
    endpointUrl,
    credentials: awsCredentials,
    qiniu: {
      accessKey: qiniuAccessKey,
      secretKey: qiniuSecretKey,
      bucket: qiniuBucket,
      domain: qiniuDomain,
      region: qiniuRegion,
    },
  };
}

export type { UrlGuardOptions };
