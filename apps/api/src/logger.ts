import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Пути, которые не должны попадать в логи: авторизация, initData, имена, телефоны,
 * контакты и тексты заявлений. Тела запросов webhook и API не логируются вовсе.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-max-bot-api-secret"]',
  'headers.authorization',
  'authorization',
  '*.authorization',
  'initData',
  '*.initData',
  'token',
  '*.token',
  '*.botToken',
  'application',
  '*.application',
  'statementText',
  '*.statementText',
  ...['phone', 'first_name', 'last_name', 'vcf_info', 'username'].flatMap((key) => [
    key,
    `*.${key}`,
    `*.*.${key}`,
    `*.*.*.${key}`,
  ]),
  // name встречается в объекте User MAX; на верхнем уровне это имя логгера — его не трогаем.
  '*.name',
  '*.*.name',
  '*.*.*.name',
];

export function createLogger(level: LoggerOptions['level'], name: string): Logger {
  return pino({
    name,
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  });
}
