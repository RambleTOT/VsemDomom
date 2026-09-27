import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findUp } from '../src/util/paths.ts';

/**
 * Числа нормативов (сроки, лимиты, ставки) живут только в таблице norm.
 * В ядре их ловит правило ESLint no-magic-numbers; здесь — поиск по коду приложений:
 * ставки снижения платы и характерные длительности нормативов не должны встречаться литералами.
 */
const root = findUp('pnpm-workspace.yaml')!.replace(/pnpm-workspace\.yaml$/, '');
const SCAN = ['packages/core/src', 'packages/shared/src', 'apps/api/src'];
const FORBIDDEN: [RegExp, string][] = [
  [/\b0[.,]15\b/, 'ставка 0,15 %'],
  [/\b0[.,]1\b(?![.\d])/, 'ставка 0,1 %'],
  [/\b(?:30|120)\s*\*\s*60\s*\*\s*1000\b/, 'срок в минутах литералом (30 мин / 2 ч)'],
  [/\b(?:4|8|16|24|72)\s*\*\s*(?:60\s*\*\s*60\s*\*\s*1000|3_?600_?000)\b/, 'лимит в часах литералом'],
  [/\b3\s*\*\s*24\s*\*\s*60/, 'срок «3 суток» литералом'],
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith('.ts') && !path.endsWith('.gen.ts') ? [path] : [];
  });
}

describe('нормативы только из справочника', () => {
  it('в коде нет литералов ставок и сроков нормативов', () => {
    const hits: string[] = [];
    for (const dir of SCAN) {
      for (const file of files(join(root, dir))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            const t = line.trim();
            // Комментарии и примеры в документации контракта (example) — не логика.
            if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || /\bexample:/.test(t)) return;
            for (const [re, what] of FORBIDDEN) {
              if (re.test(line)) hits.push(`${relative(root, file)}:${i + 1} — ${what}: ${line.trim()}`);
            }
          });
      }
    }
    expect(hits).toEqual([]);
  });
});
