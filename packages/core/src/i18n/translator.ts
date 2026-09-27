/**
 * Тексты — только по ключам словаря (ru.json). Ядро получает словарь параметром,
 * поэтому рендеры не зависят от того, где словарь лежит.
 */
export type TextParams = Record<string, string | number>;

export interface Translator {
  /** Текст по ключу с подстановкой {параметров}. Неизвестный ключ — ошибка (ловится тестами). */
  t(key: string, params?: TextParams): string;
  has(key: string): boolean;
  /** Форма слова по числу: plural.<name>.one|few|many. */
  plural(count: number, name: string): string;
}

export type PluralForm = 'one' | 'few' | 'many';

const TEN = 10;
const HUNDRED = 100;
const FEW_MIN = 2;
const FEW_MAX = 4;
const TEENS_MIN = 11;
const TEENS_MAX = 14;

/** Русские правила: 1, 21 — one; 2–4, 22–24 — few; 0, 5–20, 11–14 — many. */
export function pluralForm(count: number): PluralForm {
  const n = Math.abs(Math.trunc(count));
  const mod10 = n % TEN;
  const mod100 = n % HUNDRED;
  if (mod10 === 1 && mod100 !== TEENS_MIN) return 'one';
  if (mod10 >= FEW_MIN && mod10 <= FEW_MAX && (mod100 < TEENS_MIN || mod100 > TEENS_MAX)) return 'few';
  return 'many';
}

export class MissingTextError extends Error {
  constructor(key: string) {
    super(`нет текста по ключу ${key}`);
    this.name = 'MissingTextError';
  }
}

export function createTranslator(dictionary: Readonly<Record<string, unknown>>): Translator {
  const lookup = (key: string): string => {
    const value = dictionary[key];
    if (typeof value !== 'string') throw new MissingTextError(key);
    return value;
  };
  const t = (key: string, params: TextParams = {}): string =>
    lookup(key).replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
  return {
    t,
    has: (key) => typeof dictionary[key] === 'string',
    plural: (count, name) => t(`plural.${name}.${pluralForm(count)}`),
  };
}
