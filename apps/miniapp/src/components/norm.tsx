/** Основание числа: ссылка под сроком или процентом и шторка с формулировкой и первоисточником (S06). */
import { Button } from '@maxhub/max-ui';
import type { NormBasis } from '@vsemdomom/shared';
import { useState } from 'react';
import { openLink } from '../bridge/webapp.ts';
import { t } from '../i18n.ts';
import { Sheet } from './Sheet.tsx';

const isoDateRu = (iso: string | null): string | null => (iso ? iso.split('-').reverse().join('.') : null);

export function NormBasisLink({ norm }: { norm: NormBasis }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="norm-link" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {t('norm.basis', { doc: norm.doc, point: norm.point })}
      </button>
      <NormSheet norm={norm} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function NormSheet({ norm, open, onClose }: { norm: NormBasis; open: boolean; onClose: () => void }) {
  const edition = isoDateRu(norm.edition);
  const checked = isoDateRu(norm.checkedAt);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${norm.doc}, ${norm.point}`}
      footer={
        <>
          <Button size="large" stretched variant="secondary" onClick={() => openLink(norm.sourceUrl)}>
            {t('norm.sheet.open_source')}
          </Button>
          <Button size="large" stretched variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <p className="muted">{t('norm.sheet.label')}</p>
      <p className="norm-title">{norm.title}</p>
      <p>{norm.textPlain}</p>
      {norm.quote ? <blockquote className="norm-quote">{norm.quote}</blockquote> : null}
      <dl className="kv">
        <div className="kv-row">
          <dt>{t('norm.sheet.doc')}</dt>
          <dd>
            {norm.doc}, {norm.point}
          </dd>
        </div>
        {edition ? (
          <div className="kv-row">
            <dt>{t('norm.sheet.edition')}</dt>
            <dd>{edition}</dd>
          </div>
        ) : null}
        {checked ? (
          <div className="kv-row">
            <dt>{t('norm.sheet.checked')}</dt>
            <dd>{checked}</dd>
          </div>
        ) : null}
      </dl>
    </Sheet>
  );
}
