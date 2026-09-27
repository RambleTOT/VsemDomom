/**
 * Конфигурация из переменных окружения. Проверяется zod при старте: не хватает
 * обязательной переменной для выбранного режима — процесс падает с понятным сообщением.
 * Значения секретов в сообщения об ошибках не попадают.
 */
import { type FeatureFlags } from '@vsemdomom/core';
import { z } from 'zod';
import { readBuildInfo } from './build-info.ts';

/** Тестовый секрет сессий из .env.example: допустим только локально. */
export const LOCAL_SESSION_SECRET = 'local-only-session-secret-change-me-0123456789';

/** Тестовые checker-токены из .env.example: допустимы только локально. */
export const LOCAL_CHECKER_TOKENS = [
  'local-only-checker-resident-token-01',
  'local-only-checker-resident-token-02',
  'local-only-checker-uk-token-000000001',
];

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1' || v === 'yes'));

const int = (fallback: number, min = 0) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return fallback;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min) {
        ctx.addIssue({ code: 'custom', message: `ожидается целое число ≥ ${min}` });
        return z.NEVER;
      }
      return n;
    });

const optionalPositiveInt = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v.trim() === '') return undefined;
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n <= 0) {
      ctx.addIssue({ code: 'custom', message: 'ожидается положительное целое число' });
      return z.NEVER;
    }
    return n;
  });

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const maxIdList = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v.trim() === '') return [];
    const ids = v.split(',').map((s) => Number(s.trim()));
    if (ids.some((n) => !Number.isSafeInteger(n) || n <= 0)) {
      ctx.addIssue({ code: 'custom', message: 'ожидается список MAX ID через запятую' });
      return z.NEVER;
    }
    return ids;
  });

const quietHours = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const raw = v === undefined || v.trim() === '' ? '22:00-08:00' : v.trim();
    const m = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
    if (!m) {
      ctx.addIssue({ code: 'custom', message: 'формат HH:MM-HH:MM' });
      return z.NEVER;
    }
    return { from: `${m[1]}:${m[2]}`, to: `${m[3]}:${m[4]}` };
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DOMAIN: optionalString,
  APP_NAME: z.string().default('Всем домом'),
  PUBLIC_BASE_URL: z.url().default('http://localhost:8080'),
  MAX_MODE: z.enum(['simulator', 'polling', 'webhook']).default('simulator'),
  MAX_API_BASE: z.url().default('https://platform-api2.max.ru'),
  MAX_BOT_TOKEN: optionalString,
  MAX_BOT_USERNAME: optionalString,
  /** Общий лимит запросов к MAX: документация говорит о 30 rps, держим запас. */
  MAX_RATE_GLOBAL_RPS: int(25, 1),
  /** Отправка и правка сообщений — не больше 2 в секунду в один чат (dev.max.ru). */
  MAX_RATE_PER_CHAT: int(2, 1),
  /** Ответы на нажатия (POST /answers) в один чат в секунду; 0 — без лимита по чату. */
  MAX_RATE_ANSWERS_PER_CHAT: int(2, 0),
  MAX_TEL_LINKS: bool(false),
  MAX_WEBHOOK_SECRET: optionalString.pipe(
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{5,256}$/, '5–256 символов A-Za-z0-9_-')
      .optional(),
  ),
  SESSION_SECRET: z.string().min(32, 'не короче 32 символов'),
  INITDATA_MAX_AGE_SEC: int(3600, 60),
  DATABASE_URL: z.string().min(1),
  DEMO_MODE: bool(true),
  DEMO_UK_CODE: optionalString,
  DEV_AUTH: bool(false),
  CHECKER_API_ENABLED: bool(true),
  CHECKER_TOKEN_RESIDENT: optionalString,
  CHECKER_TOKEN_RESIDENT_2: optionalString,
  CHECKER_TOKEN_UK: optionalString,
  SEED_UK_STAFF_MAX_IDS: maxIdList,
  ALERT_USER_ID: optionalPositiveInt,
  QUIET_HOURS: quietHours,
  CHECK_WINDOW_MIN: int(360, 1),
  DEMO_CHECK_WINDOW_MIN: int(5, 1),
  DISCREPANCY_MAX_HOURS: int(72, 1),
  DEMO_NEIGHBOUR_ANSWER_DELAY_SEC: int(60, 1),
  WATER_QUALITY_POLL_DELAY_HOURS: int(3, 1),
  FEATURE_KEYWORD_REPLY: bool(false),
  FEATURE_BRIGADE_CONFIRM: bool(true),
  FEATURE_TRUST_LEVELS: bool(true),
  FEATURE_JOIN_CHAT: bool(true),
  FEATURE_POLLS: bool(true),
  FEATURE_MONTHLY_SUMMARY: bool(true),
  FEATURE_ACT_TEMPLATE: bool(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HTTP_PORT: int(3000, 1),
});

type RawEnv = z.infer<typeof envSchema>;

export interface AppConfig {
  nodeEnv: RawEnv['NODE_ENV'];
  appName: string;
  domain: string | undefined;
  publicBaseUrl: string;
  max: {
    mode: RawEnv['MAX_MODE'];
    apiBase: string;
    botToken: string | undefined;
    botUsername: string;
    webhookSecret: string | undefined;
    rate: { globalRps: number; perChat: number; answersPerChat: number };
    /** Кнопка «Позвонить» (link tel:) — включать после проверки 22.15 на живом MAX. */
    telLinks: boolean;
  };
  sessionSecret: string;
  initDataMaxAgeSec: number;
  databaseUrl: string;
  demo: { enabled: boolean; ukCode: string | undefined; checkWindowMin: number; neighbourAnswerDelaySec: number };
  devAuth: boolean;
  checker: {
    enabled: boolean;
    tokens: { resident: string | undefined; resident2: string | undefined; uk: string | undefined };
  };
  seedStaffMaxIds: number[];
  alertUserId: number | undefined;
  quietHours: { from: string; to: string };
  checkWindowMin: number;
  discrepancyMaxHours: number;
  waterQualityPollDelayHours: number;
  features: FeatureFlags;
  logLevel: RawEnv['LOG_LEVEL'];
  httpPort: number;
  build: { commit: string; builtAt: string | undefined };
}

/** Имя бота для открытия мини-приложения в режиме симулятора, пока нет настоящего. */
const SIMULATOR_BOT_USERNAME = 'vsemdomom_simulator_bot';

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Неверная конфигурация:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`),
    );
  }
  const env = parsed.data;
  const problems: string[] = [];

  if (env.MAX_MODE !== 'simulator') {
    if (!env.MAX_BOT_TOKEN) problems.push(`MAX_BOT_TOKEN обязателен при MAX_MODE=${env.MAX_MODE}`);
    if (!env.MAX_BOT_USERNAME) problems.push(`MAX_BOT_USERNAME обязателен при MAX_MODE=${env.MAX_MODE}`);
  }
  if (env.MAX_MODE === 'webhook') {
    if (!env.MAX_WEBHOOK_SECRET) problems.push('MAX_WEBHOOK_SECRET обязателен при MAX_MODE=webhook');
    if (!env.PUBLIC_BASE_URL.startsWith('https://')) {
      problems.push('PUBLIC_BASE_URL должен начинаться с https:// при MAX_MODE=webhook');
    }
  }
  if (env.DEV_AUTH && (env.MAX_MODE === 'webhook' || env.NODE_ENV === 'production')) {
    problems.push('DEV_AUTH=true запрещён при MAX_MODE=webhook и при NODE_ENV=production');
  }
  if (env.NODE_ENV === 'production' && env.SESSION_SECRET === LOCAL_SESSION_SECRET) {
    problems.push('SESSION_SECRET из .env.example допустим только локально — задайте свой (openssl rand -hex 32)');
  }
  const checkerTokens = [env.CHECKER_TOKEN_RESIDENT, env.CHECKER_TOKEN_RESIDENT_2, env.CHECKER_TOKEN_UK];
  if (env.NODE_ENV === 'production' && checkerTokens.some((tok) => tok !== undefined && LOCAL_CHECKER_TOKENS.includes(tok))) {
    problems.push('CHECKER_TOKEN_* из .env.example допустимы только локально — задайте свои (openssl rand -hex 24)');
  }
  if (checkerTokens.some((tok) => tok !== undefined && tok.length < 24)) {
    problems.push('CHECKER_TOKEN_* должны быть не короче 24 символов');
  }
  if (problems.length > 0) throw new ConfigError(problems);

  return {
    nodeEnv: env.NODE_ENV,
    appName: env.APP_NAME,
    domain: env.DOMAIN,
    publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    max: {
      mode: env.MAX_MODE,
      apiBase: env.MAX_API_BASE.replace(/\/+$/, ''),
      botToken: env.MAX_BOT_TOKEN,
      botUsername: env.MAX_BOT_USERNAME ?? SIMULATOR_BOT_USERNAME,
      webhookSecret: env.MAX_WEBHOOK_SECRET,
      rate: {
        globalRps: env.MAX_RATE_GLOBAL_RPS,
        perChat: env.MAX_RATE_PER_CHAT,
        answersPerChat: env.MAX_RATE_ANSWERS_PER_CHAT,
      },
      telLinks: env.MAX_TEL_LINKS,
    },
    sessionSecret: env.SESSION_SECRET,
    initDataMaxAgeSec: env.INITDATA_MAX_AGE_SEC,
    databaseUrl: env.DATABASE_URL,
    demo: {
      enabled: env.DEMO_MODE,
      ukCode: env.DEMO_UK_CODE,
      checkWindowMin: env.DEMO_CHECK_WINDOW_MIN,
      neighbourAnswerDelaySec: env.DEMO_NEIGHBOUR_ANSWER_DELAY_SEC,
    },
    devAuth: env.DEV_AUTH,
    checker: {
      enabled: env.CHECKER_API_ENABLED,
      tokens: {
        resident: env.CHECKER_TOKEN_RESIDENT,
        resident2: env.CHECKER_TOKEN_RESIDENT_2,
        uk: env.CHECKER_TOKEN_UK,
      },
    },
    seedStaffMaxIds: env.SEED_UK_STAFF_MAX_IDS,
    alertUserId: env.ALERT_USER_ID,
    quietHours: env.QUIET_HOURS,
    checkWindowMin: env.CHECK_WINDOW_MIN,
    discrepancyMaxHours: env.DISCREPANCY_MAX_HOURS,
    waterQualityPollDelayHours: env.WATER_QUALITY_POLL_DELAY_HOURS,
    features: {
      keywordReply: env.FEATURE_KEYWORD_REPLY,
      brigadeConfirm: env.FEATURE_BRIGADE_CONFIRM,
      trustLevels: env.FEATURE_TRUST_LEVELS,
      joinChat: env.FEATURE_JOIN_CHAT,
      polls: env.FEATURE_POLLS,
      monthlySummary: env.FEATURE_MONTHLY_SUMMARY,
      actTemplate: env.FEATURE_ACT_TEMPLATE,
    },
    logLevel: env.LOG_LEVEL,
    httpPort: env.HTTP_PORT,
    build: readBuildInfo(source),
  };
}

/** Переменные, нужные процессу migrate: только БД и сиды. */
const migrateSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SEED_UK_STAFF_MAX_IDS: maxIdList,
  LOG_LEVEL: envSchema.shape.LOG_LEVEL,
});

export interface MigrateConfig {
  databaseUrl: string;
  seedStaffMaxIds: number[];
  logLevel: RawEnv['LOG_LEVEL'];
}

export function loadMigrateConfig(source: Record<string, string | undefined> = process.env): MigrateConfig {
  const parsed = migrateSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`));
  }
  return {
    databaseUrl: parsed.data.DATABASE_URL,
    seedStaffMaxIds: parsed.data.SEED_UK_STAFF_MAX_IDS,
    logLevel: parsed.data.LOG_LEVEL,
  };
}
