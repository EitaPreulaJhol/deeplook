import { Link } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { daysUntil } from '../auth/passwordPolicy';
import { t } from '../i18n/shell';
import { HpsmMessage } from './messages';

/** A partir de quantos dias antes da validade o aviso aparece. */
const WARN_DAYS = 7;

/**
 * Aviso de senha perto de vencer (politica de senha, item 51): enquanto nao ha
 * e-mail, e ele que avisa. Fica na barra de mensagens do shell em todas as telas.
 */
export function PasswordExpiryNotice() {
  const { user } = useAuth();
  const days = daysUntil(user?.passwordExpiresAt);
  if (days === null || days > WARN_DAYS) return null;
  return (
    <HpsmMessage kind="warning">
      {days === 0
        ? t('expiresToday')
        : t(days === 1 ? 'expiresInOne' : 'expiresInMany', { n: days })}{' '}
      <Link className="dl-link" to="/user?tab=senha">
        {t('changePassword')}
      </Link>
    </HpsmMessage>
  );
}
