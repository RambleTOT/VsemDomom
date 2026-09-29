/**
 * S09. Акт без исполнителя (флаг actTemplate): проверки нет в срок после повторного сообщения в АДС —
 * сколько соседей готовы подписать, знакомство по согласию, образец акта. Числа — из справочника норм.
 */
import { Button, Switch } from '@maxhub/max-ui';
import type { ActInfo, IncidentDetail } from '@vsemdomom/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { api } from '../api/endpoints.ts';
import { openMaxLink } from '../bridge/webapp.ts';
import { SystemScreen } from '../components/errors.tsx';
import { NormBasisLink } from '../components/norm.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCopy } from '../components/useCopy.ts';
import { Banner, Card, Chip, KeyValue, Muted } from '../components/ui.tsx';
import { dayMonthIn, whenIn } from '../format.ts';
import { plural, serviceName, t } from '../i18n.ts';
import { useSession } from '../app/session.tsx';
import { actTemplateText } from '../documents.ts';
import { errorText, Loaded, useErrorAction } from './common.tsx';

const REFRESH_MS = 30_000;

function ActBody({ incident, act }: { incident: IncidentDetail; act: ActInfo }) {
  const session = useSession();
  const toast = useToast();
  const copy = useCopy();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [botBlocked, setBotBlocked] = useState(false);
  const tz = incident.house.timezone;
  const template = actTemplateText(incident, act);
  const persons = `${act.requiredConsumers} ${plural(act.requiredConsumers, 'neighbours')}`;

  const save = async (key: string, body: { ready: boolean; introOptIn?: boolean }, done: (info: ActInfo) => string) => {
    setBusy(key);
    try {
      const info = await api.actReady(incident.id, body);
      client.setQueryData<IncidentDetail>(['incident', incident.id], (old) => (old ? { ...old, act: info } : old));
      toast(done(info));
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy('dm');
    try {
      await api.sendToDm(incident.id, template);
      setBotBlocked(false);
      toast(t('screen.S09.sent'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'dialog_not_started') setBotBlocked(true);
      else toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(null);
    }
  };

  const copyTemplate = () => void copy(template, t('screen.S09.copied'));

  return (
    <Screen
      title={t('screen.S09.title')}
      sub={`${serviceName(incident.service)} · ${t('screen.S03.title', { house: incident.house.label })} · ${dayMonthIn(incident.startedAt, incident.house.timezone)}`}
      model={incident.isModel}
      back={`/incident/${incident.id}`}
      actions={
        act.myReady ? (
          <>
            <Button size="large" stretched loading={busy === 'dm'} onClick={() => void send()}>
              {t('screen.S09.send')}
            </Button>
            <Button size="large" stretched variant="secondary" onClick={copyTemplate}>
              {t('common.copy')}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="large"
              stretched
              loading={busy === 'ready'}
              onClick={() => void save('ready', { ready: true }, (info) => t('screen.S09.signed', { count: info.readyCount, neighbors: plural(info.readyCount, 'neighbours') }))}
            >
              {t('screen.S09.cta')}
            </Button>
            <Button size="large" stretched variant="secondary" onClick={copyTemplate}>
              {t('common.copy')}
            </Button>
          </>
        )
      }
    >
      <Card>
        <p>{act.checkDueAt ? t('screen.S09.lead.at', { time: whenIn(act.checkDueAt, tz) }) : t('screen.S09.lead.plain')}</p>
        <Muted>{t('screen.S09.need.n', { persons })}</Muted>
        <NormBasisLink norm={act.norm} />
      </Card>

      <Card>
        <p className="muted small">{t('screen.S09.ready')}</p>
        <p className="big-number">{t('screen.S09.ready.value', { count: act.readyCount, neighbors: plural(act.readyCount, 'neighbours') })}</p>
        <KeyValue rows={[{ key: t('screen.S09.row.consumers'), value: t('screen.S09.row.value', { n: Math.min(act.readyCount, act.requiredConsumers), need: act.requiredConsumers }) }]} />
        {act.myReady ? (
          <label className="radio-row plain-button">
            <span className="radio-text">
              <span>{t('screen.S09.intro')}</span>
              <span className="muted small">{t('screen.S09.intro.sub')}</span>
            </span>
            <Switch
              checked={act.introOptIn}
              disabled={busy === 'intro'}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                void save('intro', { ready: true, introOptIn: on }, () => (on ? t('screen.S09.intro.sub') : t('screen.S09.intro.off')));
              }}
            />
          </label>
        ) : null}
      </Card>

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
          {t('screen.S09.bot_blocked.text')}
        </Banner>
      ) : null}

      <div className="row between">
        <p className="field-label">{t('screen.S09.template.title')}</p>
        <Chip tone="warning" icon="file-text">
          {t('screen.S09.sample')}
        </Chip>
      </div>
      <div className="document">{template}</div>
      <Muted>{t('screen.S09.template.note')}</Muted>
    </Screen>
  );
}

export function ActScreen() {
  const { id = '' } = useParams();
  const session = useSession();
  const action = useErrorAction();
  const query = useQuery({ queryKey: ['incident', id], queryFn: () => api.incident(id), refetchInterval: REFRESH_MS });
  if (!session.me.features.actTemplate) return <SystemScreen kind="feature_off" onAction={action('feature_off')} />;
  return (
    <Loaded query={query}>
      {(incident) =>
        incident.act?.available ? (
          <ActBody incident={incident} act={incident.act} />
        ) : (
          <Screen title={t('screen.S09.title')} model={incident.isModel} back={`/incident/${incident.id}`}>
            {incident.act?.checkDueAt ? (
              // Проверку ещё ждём: когда акт понадобится и на каком основании.
              <Card>
                <p>{t('screen.S09.wait', { time: whenIn(incident.act.checkDueAt, incident.house.timezone) })}</p>
                <NormBasisLink norm={incident.act.norm} />
              </Card>
            ) : (
              <Muted>{t('screen.S09.not_available')}</Muted>
            )}
          </Screen>
        )
      }
    </Loaded>
  );
}
