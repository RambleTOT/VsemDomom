/** S12 по адресу /error/:kind — например, неизвестный payload или «Привязать чат может только сотрудник УК». */
import { useParams } from 'react-router';
import { SystemScreen, type ErrorKind } from '../components/errors.tsx';
import { useErrorAction } from './common.tsx';

const KINDS: readonly ErrorKind[] = ['outside', 'session', 'network', 'server', 'forbidden', 'notfound', 'merged', 'expired', 'feature_off', 'slow'];

export function SystemRoute() {
  const { kind } = useParams();
  const action = useErrorAction();
  const k: ErrorKind = KINDS.includes(kind as ErrorKind) ? (kind as ErrorKind) : 'notfound';
  return <SystemScreen kind={k} onAction={action(k)} />;
}
