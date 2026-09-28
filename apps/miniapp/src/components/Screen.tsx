/** Раскладка экрана: шапка (заголовок + «Модельные данные»), контент, ActionBar снизу. */
import { Typography } from '@maxhub/max-ui';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { isWebPlatform, setBackButton } from '../bridge/webapp.ts';
import { t } from '../i18n.ts';
import { Icon } from './Icon.tsx';
import { ModelDataBadge } from './ui.tsx';

/** Куда ведёт «Назад»: адрес экрана или действие (например, предыдущий шаг формы); null — корневой экран. */
export type BackTarget = string | (() => void) | null;

/**
 * Нативная «Назад» MAX: на вложенных экранах ведёт на `to`, на корневом (null) скрыта.
 * Экран, открытый по ссылке, возвращает на корень роли, а не закрывает приложение.
 */
export function useBack(to: BackTarget): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!to) {
      setBackButton(null);
      return;
    }
    setBackButton(typeof to === 'function' ? to : () => void navigate(to));
    return () => setBackButton(null);
  }, [to, navigate]);
}

export interface ScreenProps {
  title: ReactNode;
  sub?: ReactNode;
  /** Экран с домами, УК или АДС — плашка «Модельные данные». */
  model?: boolean;
  headerAfter?: ReactNode;
  /** Плашки под заголовком рядом с «Модельные данные» (например, «Демо-роль»). */
  badges?: ReactNode;
  /** Куда ведёт «Назад»; null — корневой экран. */
  back?: BackTarget;
  width?: 'narrow' | 'normal' | 'wide';
  actions?: ReactNode;
  /** Почему главная кнопка неактивна — строкой над ней. */
  actionsReason?: ReactNode;
  children: ReactNode;
}

export function Screen({ title, sub, model = false, headerAfter, badges, back = null, width = 'normal', actions, actionsReason, children }: ScreenProps) {
  useBack(back);
  const navigate = useNavigate();
  return (
    <div className={`screen width-${width} ${actions ? 'with-actions' : ''}`}>
      {back && isWebPlatform() ? (
        <button type="button" className="back-link" onClick={() => (typeof back === 'function' ? back() : void navigate(back))}>
          <Icon name="chevron-right" size={16} className="flip" />
          {t('common.back')}
        </button>
      ) : null}
      <header className="screen-header">
        <div className="screen-title-block">
          <Typography.Text variant="subheader" asChild>
            <h1 className="screen-title">{title}</h1>
          </Typography.Text>
          {sub ? <p className="muted screen-sub">{sub}</p> : null}
        </div>
        {headerAfter ? <div className="screen-header-after">{headerAfter}</div> : null}
        {/* Плашки — отдельной строкой во всю ширину: кнопки справа от заголовка их не сжимают. */}
        {model || badges ? (
          <div className="screen-badges">
            {model ? <ModelDataBadge /> : null}
            {badges}
          </div>
        ) : null}
      </header>
      <div className="screen-content">{children}</div>
      {actions ? <ActionBar reason={actionsReason}>{actions}</ActionBar> : null}
    </div>
  );
}

/** Нижняя панель: 1–2 кнопки на всю ширину; неактивная главная — всегда с причиной над ней. */
export function ActionBar({ children, reason }: { children: ReactNode; reason?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Отступ под панелью — по её фактической высоте: две кнопки и строка причины выше одной кнопки.
  useLayoutEffect(() => {
    const bar = ref.current;
    const screen = bar?.parentElement;
    if (!bar || !screen || typeof ResizeObserver === 'undefined') return;
    const sync = () => screen.style.setProperty('--app-action-bar-height', `${bar.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      screen.style.removeProperty('--app-action-bar-height');
    };
  }, []);
  return (
    <div className="action-bar" ref={ref}>
      {reason ? <p className="action-reason">{reason}</p> : null}
      <div className="action-bar-buttons">{children}</div>
    </div>
  );
}
