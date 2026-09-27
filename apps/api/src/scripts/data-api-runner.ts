/**
 * Прогон проверок DATA-API 1.0 (docs/api/DATA-API.yaml): запросы по порядку, переменные из extract,
 * сверка кода ответа, типа содержимого, обязательных полей и bodySchema; после проверок — cleanup.
 * Транспорт подставляется: в тестах — app.inject, против стенда — fetch. Токены ролей — снаружи.
 */

type Json = unknown;
type Schema = Record<string, unknown>;

export interface DataApiStep {
  id: string;
  name?: string;
  method: string;
  path: string;
  role: string;
  request?: { path?: Record<string, Json>; query?: Record<string, Json>; headers?: Record<string, string>; body?: Json };
  expected?: { statusCodes: number[]; contentType?: string; requiredFields?: string[]; bodySchema?: Schema };
  extract?: Record<string, string>;
}

export interface DataApiDoc {
  api: { baseUrl: string; defaultHeaders?: Record<string, string> };
  checks: DataApiStep[];
  cleanup?: DataApiStep[];
}

export interface HttpRequest {
  method: string;
  /** Путь с query, без базового адреса. */
  url: string;
  headers: Record<string, string>;
  body?: Json;
}

export interface HttpResponse {
  status: number;
  contentType: string | null;
  body: Json;
}

export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

export interface StepResult {
  id: string;
  status: number | null;
  problems: string[];
}

export interface RunResult {
  ok: boolean;
  checks: StepResult[];
  cleanup: StepResult[];
}

/** Тело ответа: JSON, если разбирается, иначе текст; пустое — null. */
export function parseBody(text: string): Json {
  if (!text) return null;
  try {
    return JSON.parse(text) as Json;
  } catch {
    return text;
  }
}

const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g;
const PATH_PARAM = /\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g;

function substitute(value: Json, vars: Map<string, Json>): Json {
  if (typeof value === 'string') {
    const whole = /^\$\{([A-Za-z_][A-Za-z0-9_.-]*)\}$/.exec(value);
    if (whole?.[1] && vars.has(whole[1])) return vars.get(whole[1]);
    return value.replace(VARIABLE, (m, name: string) => (vars.has(name) ? String(vars.get(name)) : m));
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, vars)]));
  return value;
}

/** Поле по выражению вида $.a.b (подмножество JSONPath, которого хватает для extract). */
function pick(body: Json, expression: string): { found: boolean; value: Json } {
  if (expression === '$') return { found: true, value: body };
  if (!expression.startsWith('$.')) return { found: false, value: undefined };
  let current: Json = body;
  for (const key of expression.slice(2).split('.')) {
    if (!current || typeof current !== 'object' || !(key in current)) return { found: false, value: undefined };
    current = (current as Record<string, Json>)[key];
  }
  return { found: true, value: current };
}

function typeOf(value: Json): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

const SUPPORTED = new Set(['type', 'required', 'properties', 'const', 'enum', 'minimum', 'minItems', 'items', 'contains']);

/** Подмножество JSON Schema, которым пользуется DATA-API.yaml; незнакомое ключевое слово — ошибка, а не пропуск. */
export function schemaProblems(schema: Schema, value: Json, at = '$'): string[] {
  const out: string[] = [];
  for (const key of Object.keys(schema)) if (!SUPPORTED.has(key)) out.push(`${at}: ключевое слово «${key}» не поддерживается прогоном`);
  const actual = typeOf(value);
  if (schema.type !== undefined) {
    const allowed = (Array.isArray(schema.type) ? schema.type : [schema.type]) as string[];
    const ok = allowed.includes(actual) || (actual === 'integer' && allowed.includes('number'));
    if (!ok) return [...out, `${at}: ожидался тип ${allowed.join(' | ')}, пришёл ${actual}`];
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) out.push(`${at}: ожидалось ${JSON.stringify(schema.const)}, пришло ${JSON.stringify(value)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    out.push(`${at}: ${JSON.stringify(value)} не из ${JSON.stringify(schema.enum)}`);
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) out.push(`${at}: ${value} < ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) out.push(`${at}: элементов ${value.length} < ${schema.minItems}`);
    if (schema.items) value.forEach((item, i) => out.push(...schemaProblems(schema.items as Schema, item, `${at}[${i}]`)));
    if (schema.contains && !value.some((item) => schemaProblems(schema.contains as Schema, item).length === 0)) out.push(`${at}: нет элемента, подходящего под contains`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, Json>;
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in obj)) out.push(`${at}: нет поля ${key}`);
    for (const [key, sub] of Object.entries((schema.properties as Record<string, Schema> | undefined) ?? {})) {
      if (key in obj) out.push(...schemaProblems(sub, obj[key], `${at}.${key}`));
    }
  }
  return out;
}

function buildRequest(doc: DataApiDoc, step: DataApiStep, vars: Map<string, Json>, tokens: Record<string, string | undefined>): HttpRequest | string {
  const request = (substitute(step.request ?? {}, vars) ?? {}) as NonNullable<DataApiStep['request']>;
  let missing = '';
  const path = step.path.replace(PATH_PARAM, (_m, name: string) => {
    const value = request.path?.[name];
    if (value === undefined || (typeof value === 'string' && value.includes('${'))) missing = name;
    return encodeURIComponent(String(value));
  });
  if (missing) return `нет значения для {${missing}}`;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query ?? {})) {
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, String(v));
  }
  const headers: Record<string, string> = { ...doc.api.defaultHeaders, ...request.headers };
  if (step.role !== 'public') {
    const token = tokens[step.role];
    if (!token) return `нет токена роли ${step.role}`;
    headers.Authorization = `Bearer ${token}`;
  }
  const qs = query.toString();
  return { method: step.method, url: qs ? `${path}?${qs}` : path, headers, ...(request.body === undefined ? {} : { body: request.body }) };
}

async function runStep(doc: DataApiDoc, step: DataApiStep, vars: Map<string, Json>, tokens: Record<string, string | undefined>, send: Transport): Promise<StepResult> {
  const req = buildRequest(doc, step, vars, tokens);
  if (typeof req === 'string') return { id: step.id, status: null, problems: [req] };
  let res: HttpResponse;
  try {
    res = await send(req);
  } catch (err) {
    return { id: step.id, status: null, problems: [`запрос не выполнен: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const problems: string[] = [];
  const expected = step.expected;
  if (expected && !expected.statusCodes.includes(res.status)) problems.push(`код ${res.status}, ожидался ${expected.statusCodes.join(' или ')}`);
  const mediaType = res.contentType?.split(';')[0]?.trim().toLowerCase() ?? null;
  if (expected?.contentType && mediaType !== expected.contentType.toLowerCase()) problems.push(`тип ${mediaType ?? 'нет'}, ожидался ${expected.contentType}`);
  for (const field of expected?.requiredFields ?? []) if (!pick(res.body, `$.${field}`).found) problems.push(`нет поля ${field}`);
  if (expected?.bodySchema) problems.push(...schemaProblems(expected.bodySchema, res.body));
  for (const [name, expression] of Object.entries(step.extract ?? {})) {
    const got = pick(res.body, expression);
    if (got.found) vars.set(name, got.value);
    else problems.push(`extract ${name}: нет значения по ${expression}`);
  }
  return { id: step.id, status: res.status, problems };
}

/** Все проверки по порядку, затем cleanup (даже если проверки не прошли). */
export async function runDataApi(doc: DataApiDoc, send: Transport, tokens: Record<string, string | undefined>): Promise<RunResult> {
  const vars = new Map<string, Json>();
  const checks: StepResult[] = [];
  for (const step of doc.checks) checks.push(await runStep(doc, step, vars, tokens, send));
  const cleanup: StepResult[] = [];
  for (const step of doc.cleanup ?? []) cleanup.push(await runStep(doc, step, vars, tokens, send));
  return { ok: [...checks, ...cleanup].every((r) => r.problems.length === 0), checks, cleanup };
}
