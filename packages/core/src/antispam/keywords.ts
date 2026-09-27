/**
 * F13: ответ на «нет воды» — только словарь ключевых слов, без LLM.
 * Сравнение без учёта регистра, «ё» и лишних пробелов.
 */
function normalize(text: string): string {
  return text.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
}

export function keywordMatcher(phrases: readonly string[]): (text: string) => boolean {
  const normalized = phrases.map(normalize).filter((p) => p.length > 0);
  return (text) => {
    const t = normalize(text);
    return normalized.some((p) => t.includes(p));
  };
}
