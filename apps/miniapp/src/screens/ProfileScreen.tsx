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
import { Card, Chip, KeyValue, Muted, SectionTitle } from '../components/ui.tsx';
import { plural, roleName, t } from '../i18n.ts';
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
        <Card>
          <SectionTitle>{t('screen.S11.staff')}</SectionTitle>
          <p className="banner-title">{me.staff.uk.name}</p>
          {me.staff.isDemo ? <Chip tone="info">{t('role.demo')}</Chip> : null}
          <div>
            <Button size="medium" variant="secondary" onClick={() => void navigate('/uk')}>
              {t('screen.U01.title')}
            </Button>
          </div>
        </Card>
      ) : null}

      {residency ? (
        <Card>
          <KeyValue
            rows={[
              { key: t('screen.S11.house'), value: `${t('screen.S03.title', { house: residency.house.label })} · ${residency.house.address}` },
              { key: t('screen.S11.flat_role'), value: `${t('screen.S11.flat', { flat: residency.flatNo })} · ${roleName(residency.role)}` },
            ]}
          />
          {me.features.trustLevels ? (
            <div className="stack tight">
              <Chip tone={residency.trustLevel === 2 ? 'positive' : residency.trustLevel === 1 ? 'info' : 'neutral'} icon="shield">
                {t(`trust.${residency.trustLevel}`)}
              </Chip>
              <Muted>{t(`trust.${residency.trustLevel}.text`)}</Muted>
            </div>
          ) : null}
          <div>
            <Button size="medium" variant="secondary" onClick={() => void navigate('/onboarding/residence?next=/profile')}>
              {t('screen.S02.house.change')}
            </Button>
          </div>
        </Card>
      ) : null}

      {residency ? (
        <Card>
          <label className="radio-row plain-button">
            <span className="radio-text">
              <span>{t('screen.S11.notify')}</span>
              <span className="muted small">{t('screen.S11.notify.sub')}</span>
            </span>
            <Switch checked={me.settings.notifyDefault} disabled={busy === 'notify'} onChange={(e) => void setNotify(e.currentTarget.checked)} />
          </label>
        </Card>
      ) : null}

      {residency?.chat?.bound ? (
        <Card>
          <SectionTitle>{t('screen.S11.chat')}</SectionTitle>
          <p>{residency.chat.title ?? t('screen.S03.chat.title')}</p>
          {residency.chat.participantsCount !== null ? (
            <Muted>
              {residency.chat.participantsCount} {plural(residency.chat.participantsCount, 'members')}
            </Muted>
          ) : null}
          {residency.chat.inviteLink ? (
            <div>
              <Button size="medium" variant="secondary" onClick={() => openMaxLink(residency.chat!.inviteLink!)}>
                {t('screen.S03.chat.open')}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {me.demoMode && !me.staff ? (
        <Card>
          <SectionTitle>{t('screen.S11.uk')}</SectionTitle>
          <Muted>{t('screen.S11.uk.sub')}</Muted>
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
          <div>
            <Button size="medium" disabled={code.trim() === ''} loading={busy === 'code'} onClick={() => void enterCode()}>
              {t('screen.S11.code.cta')}
            </Button>
          </div>
        </Card>
      ) : null}

      {residency ? (
        <div>
          <Button size="medium" variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash-2" size={16} /> {t('screen.S11.delete')}
          </Button>
        </div>
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
