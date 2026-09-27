import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARAMS } from '../src/config/params.ts';
import { findUp } from '../src/util/paths.ts';

/** Политика по ссылке из согласия (152-ФЗ): редакция совпадает с версией согласия, Caddy её отдаёт. */
const root = findUp('pnpm-workspace.yaml')!.replace(/pnpm-workspace\.yaml$/, '');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('страница «Политика данных»', () => {
  it('редакция совпадает с версией согласия', () => {
    const page = read('infra/privacy/index.html');
    const [year, month, day] = PARAMS.consentVersion.split('-');
    expect(page).toContain(`версия согласия ${PARAMS.consentVersion}`);
    expect(page).toContain(`Редакция от ${day}.${month}.${year}`);
  });

  it('без внешних ресурсов: CSP стенда разрешает только свой источник', () => {
    const page = read('infra/privacy/index.html');
    expect(page).not.toMatch(/<(script|link|img)\b/i);
  });

  it('Caddy отдаёт /privacy локально и на стенде, образ web содержит страницу', () => {
    for (const file of ['infra/Caddyfile', 'infra/Caddyfile.prod']) expect(read(file)).toContain('handle /privacy {');
    expect(read('Dockerfile')).toContain('COPY infra/privacy /srv/privacy');
  });
});
