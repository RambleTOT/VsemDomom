import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { examplesMarkdown } from '../src/scripts/examples.ts';
import { resolveDataDir } from '../src/util/paths.ts';

describe('примеры сообщений для README', () => {
  it('docs/EXAMPLES.md собран из текущих рендеров (pnpm examples)', () => {
    expect(readFileSync(`${resolveDataDir(undefined, 'docs')}/EXAMPLES.md`, 'utf8')).toBe(examplesMarkdown());
  });
});
