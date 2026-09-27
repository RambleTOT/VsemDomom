/**
 * Прогон проверок DATA-API против стенда (или локального API):
 *   pnpm data-api:run [--base https://app.<домен>] [--file docs/api/DATA-API.yaml]
 * Без --base берётся api.baseUrl из файла. Токены ролей — из окружения: CHECKER_TOKEN_RESIDENT,
 * CHECKER_TOKEN_RESIDENT_2, CHECKER_TOKEN_UK; они никуда не печатаются.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { resolveDataDir } from '../util/paths.ts';
import { parseBody, runDataApi, type DataApiDoc, type Transport } from './data-api-runner.ts';

const TIMEOUT_MS = 15_000;

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const file = option('--file') ?? resolve(resolveDataDir(undefined, 'docs/api'), 'DATA-API.yaml');
  const doc = parse(await readFile(file, 'utf8')) as DataApiDoc;
  const base = (option('--base') ?? doc.api.baseUrl).replace(/\/+$/, '');
  const send: Transport = async (req) => {
    const res = await fetch(`${base}${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, contentType: res.headers.get('content-type'), body: parseBody(await res.text()) };
  };
  const result = await runDataApi(doc, send, {
    resident: process.env.CHECKER_TOKEN_RESIDENT,
    resident2: process.env.CHECKER_TOKEN_RESIDENT_2,
    uk: process.env.CHECKER_TOKEN_UK,
  });
  process.stdout.write(`DATA-API: ${base}\n`);
  for (const step of [...result.checks, ...result.cleanup]) {
    const mark = step.problems.length === 0 ? 'ок' : 'ОШИБКА';
    process.stdout.write(`  ${mark}  ${step.id} (${step.status ?? '—'})${step.problems.length ? `: ${step.problems.join('; ')}` : ''}\n`);
  }
  process.stdout.write(result.ok ? 'Все проверки прошли\n' : 'Есть непрошедшие проверки\n');
  return result.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`data-api: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  },
);
