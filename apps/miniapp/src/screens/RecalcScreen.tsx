/**
 * S08. Перерасчёт и заявление: сумма из квитанции → расчёт по нормам → кто плательщик →
 * заявление (ФИО и телефон только на экране, на сервер не уходят) или ссылка собственнику.
 */
import { Button, Input, Radio } from '@maxhub/max-ui';
import { encodeStartApp } from '@vsemdomom/shared/browser';
import type { HouseDetail, IncidentDetail, RecalculationResponse, Result } from '@vsemdomom/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { api } from '../api/endpoints.ts';
import { copyText, openMaxLink, requestContact, setClosingConfirmation, shareMaxContent } from '../bridge/webapp.ts';
import { Icon } from '../components/Icon.tsx';
import { NormBasisLink } from '../components/norm.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/Toast.tsx';
import { Banner, Card, KeyValue, Muted } from '../components/ui.tsx';
import { minutesText, monthOfKey, percent, rubles } from '../format.ts';
import { lowerFirst, serviceKey, serviceNo, t } from '../i18n.ts';
import { useSession } from '../app/session.tsx';
import { errorText, Loaded } from './common.tsx';
import { Progress, StepQuestion } from './ReportScreen.tsx';
import { parseCharge, serviceAcc, statementText } from '../documents.ts';

const STEPS = 3;

/** Схема квитанции: где искать строку услуги (без реальных данных). */
function ReceiptScheme({ line }: { line: string }) {
  return (
    <figure className="receipt" aria-label={t('screen.S08.receipt.caption')}>
      <div className="receipt-row receipt-head">
        <span>{t('screen.S08.receipt.service')}</span>
        <span>{t('screen.S08.receipt.sum')}</span>
      </div>
      <div className="receipt-row">
        <span className="receipt-bar" />
        <span className="receipt-bar short" />
      </div>
      <div className="receipt-row is-target">
        <span>{line}</span>
        <span className="receipt-sum">
          <Icon name="chevron-right" size={16} className="flip" />
        </span>
      </div>
      <div className="receipt-row">
        <span className="receipt-bar" />
        <span className="receipt-bar short" />
      </div>
      <figcaption className="muted small">{t('screen.S08.receipt.caption')}</figcaption>
    </figure>
  );
}

function MoneyBreakdown({ calc, service }: { calc: RecalculationResponse; service: Result['service'] }) {
  if (calc.limitMinutes === null || !calc.norm) {
    return (
      <Card>
        <p className="muted">{t('money.no_norm')}</p>
      </Card>
    );
  }
  if (calc.withinNorm || calc.amount === 0) {
    return (
      <>
        <Card className="tone-positive">
          <p className="card-title">{t('money.none', { limit: minutesText(calc.limitMinutes) })}</p>
        </Card>
        <NormBasisLink norm={calc.norm} />
      </>
    );
  }
  return (
    <>
      <Card>
        <p className="card-title">{t('screen.S08.calc')}</p>
        <KeyValue
          rows={[
            { key: t('money.row.excess'), value: t('money.row.excess.value', { excess: minutesText(calc.excessMinutes), hours: String(calc.excessHours).replace('.', ',') }) },
            { key: t('money.row.rate'), value: percent(calc.ratePercent) },
            { key: t('money.row.fee', { service_acc: serviceAcc(service) }), value: rubles(calc.monthlyCharge) },
            { key: t('money.row.formula'), value: calc.formula },
          ]}
        />
        <div className="money-total">
          <p className="muted small">{t('money.total', { month: monthOfKey(calc.month) })}</p>
          <p className="big-number">{rubles(calc.amount)}</p>
          {calc.round === 'ceil' ? <p className="muted small">{t('money.round')}</p> : null}
        </div>
      </Card>
      <p className="muted small">{calc.disclaimer}</p>
      <NormBasisLink norm={calc.norm} />
    </>
  );
}

function RecalcBody({ result, incident, house }: { result: Result; incident: IncidentDetail; house: HouseDetail }) {
  const navigate = useNavigate();
  const session = useSession();
  const toast = useToast();
  const amountId = useId();
  const fioId = useId();
  const phoneId = useId();
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState(false);
  const [calc, setCalc] = useState<RecalculationResponse | null>(null);
  const [account, setAccount] = useState<'yes' | 'no' | null>(null);
  const [fio, setFio] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [botBlocked, setBotBlocked] = useState(false);
  const [share, setShare] = useState<{ link: string; text: string } | null>(null);
  const [shareFailed, setShareFailed] = useState(false);
  const [finished, setFinished] = useState(false);
  const back = `/incident/${result.incidentId}/result`;

  useEffect(() => {
    setClosingConfirmation(!finished && (amount !== '' || step > 1));
    return () => setClosingConfirmation(false);
  }, [finished, amount, step]);

  const statement = statementText({ result, incident, ukName: house.uk.name, fio, phone });
  if (!result.my || !result.month) {
    return (
      <Screen title={t('screen.S08.title')} model={result.house.isModel} back={back}>
        <Muted>{result.month ? t('screen.S08.not_resident') : t('money.no_norm')}</Muted>
      </Screen>
    );
  }

  const calculate = async () => {
    const charge = parseCharge(amount);
    if (charge === null) {
      setAmountError(true);
      return;
    }
    setBusy('calc');
    try {
      setCalc(await api.recalculate(result.incidentId, charge));
      setStep(2);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'monthly_charge_invalid') setAmountError(true);
      else toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(null);
    }
  };

  const chooseAccount = async (value: 'yes' | 'no') => {
    setAccount(value);
    if (value !== 'no' || share) return;
    // Ссылку готовим заранее: «Переслать» должно сработать сразу по нажатию (жест пользователя).
    const my = result.my;
    if (session.me.features.trustLevels) {
      try {
        const invite = await api.createOwnerInvite(result.incidentId);
        setShare({ link: invite.link, text: invite.shareText });
      } catch (err) {
        toast(errorText(err, t('error.network.title')), 'error');
      }
    } else {
      const link = `${session.me.botLink}?startapp=${encodeStartApp('r', result.incidentId)}`;
      setShare({ link, text: t('owner.share.result', { flat: my?.flatNo ?? '', address: result.house.address, service_no_lower: lowerFirst(serviceNo(result.service)) }) });
    }
  };

  const sendToDm = async () => {
    setBusy('dm');
    try {
      await api.sendToDm(result.incidentId, statement);
      setBotBlocked(false);
      setFinished(true);
      toast(t('screen.S08.sent'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'dialog_not_started') setBotBlocked(true);
      else toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(null);
    }
  };

  const copyStatement = async () => {
    if (await copyText(statement)) {
      setFinished(true);
      toast(t('screen.S08.copied'));
    }
  };

  const shareToOwner = async () => {
    if (!share) return;
    const ok = await shareMaxContent(share.text, share.link);
    if (ok) setFinished(true);
    else setShareFailed(true);
  };

  const copyLink = async () => {
    if (share && (await copyText(share.link))) {
      setFinished(true);
      toast(t('screen.S08.share.copied'));
    }
  };

  const fillPhone = async () => {
    const value = await requestContact();
    if (value) setPhone(value);
    else toast(t('screen.S08.phone.unavailable'), 'info');
  };

  if (step === 1) {
    return (
      <Screen
        title={t('screen.S08.title')}
        model={result.house.isModel}
        back={back}
        actions={
          <Button size="large" stretched disabled={amount.trim() === ''} loading={busy === 'calc'} onClick={() => void calculate()}>
            {t('screen.S08.calc.cta')}
          </Button>
        }
        actionsReason={amount.trim() === '' ? t('screen.S08.amount.error') : undefined}
      >
        <Progress step={1} of={STEPS} label={t('screen.S08.progress', { n: 1 })} />
        <StepQuestion>
          <label htmlFor={amountId}>{t('screen.S08.amount.title', { service_acc: serviceAcc(result.service) })}</label>
        </StepQuestion>
        <div className="field">
          <Input
            id={amountId}
            size="large"
            mode="contrast"
            inputMode="decimal"
            iconAfter={<span className="muted">{t('money.currency')}</span>}
            value={amount}
            placeholder={t('screen.S08.amount.placeholder')}
            aria-invalid={amountError}
            onChange={(e) => {
              setAmount(e.currentTarget.value.replace(/[^\d\s,.]/g, '').slice(0, 12));
              setAmountError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void calculate();
            }}
          />
          {amountError ? (
            <p className="field-error" role="alert">
              <Icon name="circle-alert" size={16} />
              {t('screen.S08.amount.error')}
            </p>
          ) : null}
          <p className="field-hint">{t('screen.S08.amount.hint', { receipt_line: t(`receipt_line.${serviceKey(result.service)}`) })}</p>
        </div>
        <ReceiptScheme line={t(`receipt_line.${serviceKey(result.service)}`)} />
      </Screen>
    );
  }

  if (step === 2 && calc) {
    const nothing = calc.withinNorm || calc.amount === 0 || calc.limitMinutes === null;
    return (
      <Screen
        title={t('screen.S08.title')}
        model={result.house.isModel}
        back={back}
        actions={
          nothing ? (
            <Button
              size="large"
              stretched
              onClick={() => {
                setFinished(true);
                void navigate(back);
              }}
            >
              {t('common.done')}
            </Button>
          ) : (
            <Button size="large" stretched onClick={() => setStep(3)}>
              {t('common.continue')}
            </Button>
          )
        }
      >
        <Progress step={2} of={STEPS} label={t('screen.S08.progress', { n: 2 })} />
        {calc.preliminary ? <Banner tone="info" title={t('screen.S08.preliminary')} /> : null}
        <MoneyBreakdown calc={calc} service={result.service} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('screen.S08.title')}
      model={result.house.isModel}
      back={back}
      width="normal"
      actionsReason={account === null ? t('screen.S08.account.disabled') : undefined}
      actions={
        account === 'no' ? (
          <>
            <Button size="large" stretched disabled={!share} onClick={() => void shareToOwner()}>
              {t('screen.S08.share.cta')}
            </Button>
            {shareFailed ? (
              <Button size="large" stretched variant="secondary" onClick={() => void copyLink()}>
                {t('screen.S08.share.copy')}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button size="large" stretched disabled={account !== 'yes' || fio.trim() === ''} loading={busy === 'dm'} onClick={() => void sendToDm()}>
              {t('screen.S08.send_self')}
            </Button>
            <Button size="large" stretched variant="secondary" disabled={account !== 'yes' || fio.trim() === ''} onClick={() => void copyStatement()}>
              {t('common.copy')}
            </Button>
          </>
        )
      }
    >
      <Progress step={3} of={STEPS} label={t('screen.S08.progress', { n: 3 })} />
      <StepQuestion>{t('screen.S08.account.title')}</StepQuestion>
      <div className="radio-list" role="radiogroup" aria-label={t('screen.S08.account.title')}>
        {(['yes', 'no'] as const).map((v) => (
          <label className="radio-row" key={v}>
            <span className="radio-text">{t(`screen.S08.account.${v}`)}</span>
            <Radio name="account" value={v} checked={account === v} onChange={() => void chooseAccount(v)} />
          </label>
        ))}
      </div>

      {account === 'yes' ? (
        <>
          <div className="field">
            <label className="field-label" htmlFor={fioId}>
              {t('screen.S08.fio')}
            </label>
            <Input id={fioId} size="large" mode="contrast" autoComplete="name" value={fio} onChange={(e) => setFio(e.currentTarget.value.slice(0, 120))} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={phoneId}>
              {t('screen.S08.phone')}
            </label>
            <Input id={phoneId} size="large" mode="contrast" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.currentTarget.value.replace(/[^\d+()\s-]/g, '').slice(0, 20))} />
            <div>
              <Button size="small" variant="secondary" onClick={() => void fillPhone()}>
                {t('screen.S08.phone.from_max')}
              </Button>
            </div>
          </div>
          <p className="muted small">
            <Icon name="lock" size={16} /> {t('pdn.not_stored')}
          </p>
          {botBlocked ? (
            <Banner
              tone="warning"
              title={t('screen.S08.bot_blocked.title')}
              actions={
                <Button size="small" variant="secondary" onClick={() => openMaxLink(session.me.botLink)}>
                  {t('screen.S08.bot_blocked.cta')}
                </Button>
              }
            >
              {t('screen.S08.bot_blocked.text')}
            </Banner>
          ) : null}
          <div className="field">
            <p className="field-label">{t('screen.S08.doc')}</p>
            <div className="document" aria-live="polite">
              {statement}
            </div>
          </div>
        </>
      ) : null}

      {account === 'no' ? (
        <Banner tone="info" title={t('screen.S08.share.title')}>
          {t('screen.S08.share.text')}
        </Banner>
      ) : null}
    </Screen>
  );
}

export function RecalcScreen() {
  const { id = '' } = useParams();
  const result = useQuery({ queryKey: ['result', id], queryFn: () => api.result(id) });
  const incident = useQuery({ queryKey: ['incident', id], queryFn: () => api.incident(id) });
  const houseId = result.data?.house.id;
  const house = useQuery({ queryKey: ['house', houseId], queryFn: () => api.house(houseId ?? ''), enabled: Boolean(houseId) });
  return (
    <Loaded query={result}>
      {(r) => (
        <Loaded query={incident}>
          {(inc) => <Loaded query={house}>{(h) => <RecalcBody result={r} incident={inc} house={h} />}</Loaded>}
        </Loaded>
      )}
    </Loaded>
  );
}
