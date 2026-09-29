/** Копирование с ответом: получилось — тост о результате, браузер не дал доступ к буферу — подсказка. */
import { useCallback } from 'react';
import { copyText } from '../bridge/webapp.ts';
import { t } from '../i18n.ts';
import { useToast } from './Toast.tsx';

export function useCopy(): (text: string, doneText: string) => Promise<boolean> {
  const toast = useToast();
  return useCallback(
    async (text: string, doneText: string) => {
      const ok = await copyText(text);
      toast(ok ? doneText : t('copy.failed'), ok ? 'success' : 'error');
      return ok;
    },
    [toast],
  );
}
