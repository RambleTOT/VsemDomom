import { createTranslator, type Translator } from '@vsemdomom/core/i18n';
import ru from '../i18n/ru.json' with { type: 'json' };

/** Словарь «Всем домом» — один для бота и мини-приложения. */
export const ruDictionary: Readonly<Record<string, unknown>> = ru;

export const ruTranslator: Translator = createTranslator(ruDictionary);
