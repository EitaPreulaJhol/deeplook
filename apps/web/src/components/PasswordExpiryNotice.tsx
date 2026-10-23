import { Link } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { daysUntil } from '../auth/passwordPolicy';
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
        ? 'Sua senha expira hoje.'
        : `Sua senha expira em ${days} dia${days === 1 ? '' : 's'}.`}{' '}
      <Link className="dl-link" to="/user?tab=senha">
        Alterar senha
      </Link>
    </HpsmMessage>
  );
}
