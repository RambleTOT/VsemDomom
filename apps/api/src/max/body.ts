import type { KeyboardButton } from '@vsemdomom/core';
import type { components } from './schema.gen.ts';
import type { MaxNewMessageBody, OutgoingMessage } from './types.ts';

type ApiButton =
  | components['schemas']['CallbackButton']
  | components['schemas']['LinkButton']
  | components['schemas']['OpenAppButton']
  | components['schemas']['ClipboardButton']
  | components['schemas']['RequestContactButton'];

function toApiButton(b: KeyboardButton): ApiButton & { type: string; text: string } {
  switch (b.type) {
    case 'callback':
      return { type: 'callback', text: b.text, payload: b.payload };
    case 'link':
      return { type: 'link', text: b.text, url: b.url };
    case 'open_app':
      return { type: 'open_app', text: b.text, web_app: b.webApp, ...(b.payload === undefined ? {} : { payload: b.payload }) };
    case 'clipboard':
      return { type: 'clipboard', text: b.text, payload: b.payload };
    case 'request_contact':
      return { type: 'request_contact', text: b.text };
  }
}

/**
 * OutgoingMessage → NewMessageBody MAX. При правке attachments передаётся всегда:
 * пустой массив снимает клавиатуру, а null оставил бы старую.
 */
export function toNewMessageBody(message: OutgoingMessage, mode: 'send' | 'edit'): MaxNewMessageBody {
  const hasKeyboard = message.keyboard.length > 0;
  const attachments = hasKeyboard
    ? [{ type: 'inline_keyboard' as const, payload: { buttons: message.keyboard.map((row) => row.map(toApiButton)) } }]
    : [];
  return {
    text: message.text,
    format: message.format,
    ...(hasKeyboard || mode === 'edit' ? { attachments } : {}),
    ...(message.notify === undefined ? {} : { notify: message.notify }),
    ...(message.replyToMid ? { link: { type: 'reply' as const, mid: message.replyToMid } } : {}),
  };
}
