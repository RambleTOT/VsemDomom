/** Шторка (S, M) и боковая панель (L), диалог подтверждения. Esc и фон закрывают, фокус — на заголовок. */
import { Button, Typography } from '@maxhub/max-ui';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pushBackOverride } from '../bridge/webapp.ts';
import { t } from '../i18n.ts';

/** Токены MAX UI заданы на корне <MaxUI>, поэтому шторки рендерим внутрь него, а не в body. */
const portalRoot = (): HTMLElement => document.getElementById('portal-root') ?? document.body;

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  role?: 'dialog' | 'alertdialog';
  side?: boolean;
  /** Шторка с одним полем ввода: фокус сразу в поле, а не на заголовок. */
  focusField?: boolean;
}

export function Sheet({ open, onClose, title, children, footer, role = 'dialog', side = false, focusField = false }: SheetProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);
  // Кнопки MAX UI срабатывают на нажатие: отпускание того же жеста не должно закрыть шторку.
  const pressedOnOverlay = useRef(false);
  // Обработчик — через ref: новый onClose при перерисовке родителя не должен сбрасывать фокус.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Нативная «Назад» MAX, пока шторка открыта, закрывает её, а не уводит с экрана.
  useEffect(() => {
    if (!open) return;
    return pushBackOverride(() => closeRef.current());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement;
    const field = focusField ? sheetRef.current?.querySelector<HTMLElement>('input, textarea') : null;
    (field ?? titleRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus();
    };
  }, [open, focusField]);

  if (!open) return null;
  return createPortal(
    <div
      className="sheet-overlay"
      onPointerDown={(e) => {
        pressedOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnOverlay.current && e.target === e.currentTarget) onClose();
        pressedOnOverlay.current = false;
      }}
    >
      <div ref={sheetRef} className={`sheet ${side ? 'sheet-side' : ''}`} role={role} aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-grabber" aria-hidden="true" />
        <Typography.Text variant="title" asChild>
          <h2 className="sheet-title" id={titleId} ref={titleRef} tabIndex={-1}>
            {title}
          </h2>
        </Typography.Text>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-footer">{footer}</div> : null}
      </div>
    </div>,
    portalRoot(),
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  text?: ReactNode;
  ok: string;
  cancel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, text, ok, cancel, destructive = false, loading = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      role="alertdialog"
      footer={
        <>
          <Button size="large" stretched variant={destructive ? 'destructive' : 'primary'} loading={loading} onClick={onConfirm}>
            {ok}
          </Button>
          <Button size="large" stretched variant="secondary" disabled={loading} onClick={onCancel}>
            {cancel ?? t('common.cancel')}
          </Button>
        </>
      }
    >
      {text ? <p>{text}</p> : null}
    </Sheet>
  );
}
