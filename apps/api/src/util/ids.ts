/** Публичные ID сущностей: nanoid из 10 символов A-Za-z0-9. Внутренние числовые ID наружу не отдаём. */
import { customAlphabet } from 'nanoid';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const PUBLIC_ID_LENGTH = 10;

export const newPublicId: () => string = customAlphabet(ALPHABET, PUBLIC_ID_LENGTH);
