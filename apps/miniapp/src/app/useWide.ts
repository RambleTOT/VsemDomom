/** Ширина L (ноутбук, планшет в альбоме): от 840 px — раскладки в две колонки. */
import { useEffect, useState } from 'react';

const WIDE_QUERY = '(min-width: 840px)';

export function useWide(): boolean {
  const [wide, setWide] = useState(() => globalThis.matchMedia?.(WIDE_QUERY).matches ?? false);
  useEffect(() => {
    const mq = globalThis.matchMedia?.(WIDE_QUERY);
    if (!mq) return;
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}
