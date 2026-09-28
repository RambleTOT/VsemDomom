/** Тост: результат действия, 4 секунды, над ActionBar; role=status. */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

const TOAST_MS = 4000;
const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const show = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = next.current++;
    setItems((list) => [...list.slice(-1), { id, text, kind }]);
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), TOAST_MS);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast toast-${i.kind}`}>
            <Icon name={i.kind === 'error' ? 'circle-alert' : i.kind === 'info' ? 'info' : 'circle-check'} size={20} />
            <span>{i.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (text: string, kind?: ToastKind) => void {
  return useContext(ToastContext);
}
