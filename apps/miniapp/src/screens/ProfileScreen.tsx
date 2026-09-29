/** S11. Профиль: дом, квартира, роль и уровень доверия; уведомления; чат дома; демо-код УК; удаление данных. */
import { Button, Input, Switch } from '@maxhub/max-ui';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../api/client.ts';
import { api } from '../api/endpoints.ts';
import { openMaxLink } from '../bridge/webapp.ts';
import { Icon } from '../components/Icon.tsx';
import { Screen } from '../components/Screen.tsx';
import { ConfirmDialog } from '../components/Sheet.tsx';
import { useToast } from '../components/Toast.tsx';
import { Card, Chip, Muted } from '../components/ui.tsx';
import { lowerFirst, plural, roleName, t } from '../i18n.ts';
import { homePath, onboardingFor } from '../app/start.ts';
import { useSession } from '../app/session.tsx';
import { errorText } from './common.tsx';

export function ProfileScreen() {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const codeId = useId();
  const me = session.me;
  const residency = me.residencies[0] ?? null;
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const canEnterCode = me.demoMode && !me.staff;
  const chat = residency?.chat ?? null;
  const flatRole = residency ? `${t('screen.S11.flat', { flat: residency.flatNo })} · ${lowerFirst(roleName(residency.role))}` : '';

  const setNotify = async (value: boolean) => {
    setBusy('notify');
    try {
      const saved = await api.settings(value);
      session.setMe({ ...me, settings: saved });
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(null);
    }
  };

  const enterCode = async () => {
    setBusy('code');
    setCodeError(false);
    try {
      const updated = await api.demoUkRole(code.trim());
      session.setMe(updated);
      toast(t('screen.S11.code.done', { uk: updated.staff?.uk.name ?? '' }));
      void navigate('/uk');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 422)) setCodeError(true);
      else toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await api.deleteMe();
      const fresh = await session.refresh();
      setConfirmDelete(false);
      toast(t('screen.S11.deleted'));
      const home = homePath(fresh);
      void navigate(onboardingFor(fresh, home) ?? home, { replace: true });
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title={t('screen.S11.title')} back={session.home} model={residency?.house.isModel ?? me.staff?.uk.isModel ?? false}>
      {me.staff ? (
        <div className="list-card">
          <button type="button" className="list-row plain-button" onClick={() => void navigate('/uk')}>
            <span className="list-row-text">
              <span className="muted small">{t('screen.S11.staff')}</span>
              <span className="list-row-title">{me.staff.uk.name}</span>
            </span>
            <span className="row">
              {me.staff.isDemo ? <Chip tone="neutral">{t('role.demo')}</Chip> : null}
              <Icon name="chevron-right" size={16} className="muted" />
            </span>
          </button>
        </div>
      ) : null}

      {residency ? (
        <div className="list-card">
          {/* Дом жителя: сотруднику с демо-ролью — единственный путь из профиля к «Сообщить об аварии». */}
          <button type="button" className="list-row plain-button" onClick={() => void navigate(`/house/${residency.house.id}`)}>
            <span className="list-row-text">
              <span className="muted small">{t('screen.S11.house')}</span>
              <span className="list-row-title">{`${t('screen.S03.title', { house: residency.house.label })} · ${residency.house.address}`}</span>
            </span>
            <Icon name="chevron-right" size={16} className="muted" />
          </button>
          <button type="button" className="list-row plain-button" aria-label={`${t('screen.S11.flat_role')}: ${flatRole} — ${t('screen.S02.house.change')}`} onClick={() => void navigate('/onboarding/residence?next=/profile')}>
            <span className="list-row-text">
              <span className="muted small">{t('screen.S11.flat_role')}</span>
              <span className="list-row-title">{flatRole}</span>
            </span>
            <Icon name="chevron-right" size={16} className="muted" />
          </button>
        </div>
      ) : null}

      {residency && me.features.trustLevels ? (
        <Card>
          <Chip tone={residency.trustLevel === 2 ? 'positive' : residency.trustLevel === 1 ? 'info' : 'neutral'} icon="shield">
            {t(`trust.${residency.trustLevel}`)}
          </Chip>
          <Muted>{t(`trust.${residency.trustLevel}.text`)}</Muted>
        </Card>
      ) : null}

      {residency || canEnterCode ? (
        <div className="list-card">
          {residency ? (
            <label className="list-row">
              <span className="list-row-text">
                <span className="list-row-title">{t('screen.S11.notify')}</span>
                <span className="muted small">{t('screen.S11.notify.sub')}</span>
              </span>
              <Switch checked={me.settings.notifyDefault} disabled={busy === 'notify'} onChange={(e) => void setNotify(e.currentTarget.checked)} />
            </label>
          ) : null}
          {chat?.bound ? (
            <button type="button" className="list-row plain-button" disabled={!chat.inviteLink} onClick={() => chat.inviteLink && openMaxLink(chat.inviteLink)}>
              <span className="list-row-text">
                <span className="list-row-title">{t('screen.S11.chat')}</span>
                <span className="muted small">
                  {[chat.title, chat.participantsCount !== null ? `${chat.participantsCount} ${plural(chat.participantsCount, 'members')}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              {chat.inviteLink ? <Icon name="chevron-right" size={16} className="muted" /> : null}
            </button>
          ) : null}
          {canEnterCode ? (
            <button type="button" className="list-row plain-button" aria-expanded={codeOpen} onClick={() => setCodeOpen((v) => !v)}>
              <span className="list-row-text">
                <span className="list-row-title">{t('screen.S11.uk')}</span>
                <span className="muted small">{t('screen.S11.uk.sub')}</span>
              </span>
              <Icon name="chevron-right" size={16} className={codeOpen ? 'muted rotate-down' : 'muted'} />
            </button>
          ) : null}
        </div>
      ) : null}

      {canEnterCode && codeOpen ? (
        <Card>
          <div className="field">
            <label className="field-label" htmlFor={codeId}>
              {t('screen.S11.code.label')}
            </label>
            <Input
              id={codeId}
              size="large"
              mode="default"
              autoComplete="off"
              value={code}
              placeholder={t('screen.S11.code.placeholder')}
              aria-invalid={codeError}
              onChange={(e) => {
                setCode(e.currentTarget.value.slice(0, 64));
                setCodeError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.trim()) void enterCode();
              }}
            />
            {codeError ? (
              <p className="field-error" role="alert">
                <Icon name="circle-alert" size={16} />
                {t('screen.S11.code.error')}
              </p>
            ) : (
              <p className="field-hint">{t('screen.S11.code.hint')}</p>
            )}
          </div>
          <Button size="large" stretched disabled={code.trim() === ''} loading={busy === 'code'} onClick={() => void enterCode()}>
            {t('screen.S11.code.cta')}
          </Button>
        </Card>
      ) : null}

      {residency ? (
        <Button size="large" stretched variant="destructive" onClick={() => setConfirmDelete(true)}>
          {t('screen.S11.delete')}
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title={t('confirm.delete.title')}
        text={t('confirm.delete.text')}
        ok={t('confirm.delete.ok')}
        destructive
        loading={busy === 'delete'}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}
