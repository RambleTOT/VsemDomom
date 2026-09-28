import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DISPLAY_STATUSES,
  DISPLAY_STATUS_I18N_KEY,
  FEATURE_FLAGS,
  INCIDENT_EVENT_TYPES,
  RESIDENCY_ROLES,
  RESIDENCY_ROLE_I18N_KEY,
  ruDictionary,
  SERVICE_I18N_KEY,
  SERVICE_TYPES,
} from '@vsemdomom/shared/browser';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

/** Код без комментариев: в них можно называть запрещённое и писать по-русски. */
const codeOf = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const has = (key: string) => Object.hasOwn(ruDictionary, key);

describe('тексты мини-приложения — только ключи словаря', () => {
  it('каждый ключ t()/has() из кода есть в ru.json', () => {
    const missing: string[] = [];
    for (const file of sources(SRC)) {
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(/\b(?:t|has)\(\s*'([^'$]+)'/g)) if (!has(m[1]!)) missing.push(`${m[1]} (${file.slice(SRC.length + 1)})`);
    }
    expect(missing).toEqual([]);
  });

  it('ключи, собираемые из перечислений, есть для каждого значения', () => {
    const keys = [
      ...SERVICE_TYPES.flatMap((s) => {
        const k = SERVICE_I18N_KEY[s];
        return [`service.${k}`, `service_gen.${k}`, `restore.question.${k}`, `service_acc.${k}`, `receipt_line.${k}`];
      }),
      ...DISPLAY_STATUSES.map((s) => `status.${DISPLAY_STATUS_I18N_KEY[s]}`),
      ...RESIDENCY_ROLES.map((r) => `role.${RESIDENCY_ROLE_I18N_KEY[r]}`),
      ...INCIDENT_EVENT_TYPES.map((e) => `timeline.event.${e}`),
      ...['reported', 'accepted', 'brigade_on_site', 'localized', 'resolved', 'closed'].map((s) => `stepper.step.${s}`),
      ...['flat', 'entrance', 'house'].map((s) => `screen.S05.scope.${s}`),
      ...[0, 1, 2].flatMap((l) => [`trust.${l}`, `trust.${l}.text`]),
      ...['warm', 'luke', 'cold', 'none'].map((h) => `heat.${h}`),
      ...['open', 'expired', 'closed'].map((f) => `filter.${f}`),
    ];
    expect(keys.filter((k) => !has(k))).toEqual([]);
  });

  it('флаги функций из контракта известны мини-приложению', () => {
    expect(FEATURE_FLAGS).toEqual(expect.arrayContaining(['brigadeConfirm', 'trustLevels', 'polls', 'monthlySummary', 'actTemplate']));
  });
});

describe('веб-версия MAX', () => {
  // Эти возможности моста не работают в веб-версии MAX — основной путь без них (правило 1).
  const FORBIDDEN = ['DeviceStorage', 'SecureStorage', 'BiometricManager', 'HapticFeedback', 'shareContent(', 'downloadFile'];

  it('код не обращается к возможностям, недоступным в вебе', () => {
    const hits = sources(SRC).flatMap((file) => {
      const code = codeOf(file);
      return FORBIDDEN.filter((word) => code.includes(word)).map((word) => `${word} (${file.slice(SRC.length + 1)})`);
    });
    expect(hits).toEqual([]);
  });

  it('тексты интерфейса не зашиты в код: нет кириллицы вне комментариев', () => {
    const hits = sources(SRC).flatMap((file) => (/[А-Яа-яЁё]/.test(codeOf(file)) ? [file.slice(SRC.length + 1)] : []));
    expect(hits).toEqual([]);
  });
});
