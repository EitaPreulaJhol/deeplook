import { Checkbox } from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { NotificationType } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { t as tr } from '../i18n/account';
import { HpsmField, HpsmForm, HpsmSection } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconSettings } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { NOTIFICATION_TYPE_LABELS } from './notifications';
import { useSaveShortcut } from './shortcuts';
import { useUnsavedChanges } from './useUnsavedChanges';

interface TypeOption {
  type: NotificationType;
  locked: boolean;
}

/**
 * Minha Conta > Notificações (item 164): que avisos chegam à Caixa de entrada. A API
 * diz quais a pessoa pode receber pelo papel e quais não se silenciam (pedem ação).
 */
export function NotificationsTab() {
  const { preferences, updatePreferences } = useAuth();
  const [muted, setMuted] = useState(() => new Set(preferences.mutedNotifications));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const query = useQuery({
    queryKey: ['me', 'notification-types'],
    queryFn: () => api.get<{ types: TypeOption[] }>('/me/notification-types'),
  });

  const saved = new Set(preferences.mutedNotifications);
  useUnsavedChanges(muted.size !== saved.size || [...muted].some((t) => !saved.has(t)));

  const toggle = (type: NotificationType, receive: boolean) => {
    setMuted((current) => {
      const next = new Set(current);
      if (receive) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const save = async () => {
    setResult(null);
    setSaving(true);
    try {
      await updatePreferences({ mutedNotifications: [...muted] });
      setResult({ kind: 'success', text: tr('notifSaved') });
    } catch (err) {
      setResult({ kind: 'error', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  useSaveShortcut(save, !saving);

  return (
    <HpsmSection title={tr('inboxNotices')} className="dl-form-col">
      <HpsmToolbar label={tr('notifActions')}>
        <HpsmToolbarButton
          label={saving ? tr('saving') : tr('saveNotifs')}
          title={tr('saveHint')}
          icon={IconSettings}
          disabled={saving || !query.data}
          onClick={save}
        />
      </HpsmToolbar>
      {result && <HpsmMessage kind={result.kind}>{result.text}</HpsmMessage>}
      <p className="dl-static-empty">{tr('notifHint')}</p>
      {query.isPending && <HpsmLoading text={tr('loadingTypes')} />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {query.data && (
        <HpsmForm>
          <HpsmField label={tr('receive')} top help={tr('receiveHelp')}>
            {query.data.types.map(({ type, locked }) => (
              <Checkbox
                key={type}
                id={`notif-${type}`}
                labelText={`${NOTIFICATION_TYPE_LABELS[type]}${locked ? ` ${tr('alwaysArrives')}` : ''}`}
                checked={locked || !muted.has(type)}
                disabled={locked}
                onChange={(_, { checked }) => toggle(type, checked)}
              />
            ))}
          </HpsmField>
        </HpsmForm>
      )}
    </HpsmSection>
  );
}
