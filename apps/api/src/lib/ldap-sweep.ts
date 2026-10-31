import { audit } from './audit';
import { ldapAccountsGone, ldapConfig } from './ldap';
import { prisma } from './prisma';

const HOUR_MS = 60 * 60 * 1000;

export interface SweepResult {
  checked: number;
  suspended: string[];
  /** Por que nao suspendeu ninguem nesta rodada. */
  skipped?: string;
}

/**
 * Quem saiu do AD perde o acesso (item 108): conta que nao existe mais ou esta
 * desativada e suspensa, com as sessoes e os tokens revogados. AD fora do ar nao
 * muda nada. Se a maioria parece ter sumido, o provavel e erro de configuracao
 * (base errada, conta de servico sem permissao): nao suspende ninguem. Reativar e
 * com o admin; a conta que continuar fora e suspensa de novo na rodada seguinte.
 */
export async function sweepLdapAccounts(): Promise<SweepResult> {
  if (!ldapConfig()) return { checked: 0, suspended: [], skipped: 'AD desligado' };
  const accounts = await prisma.user.findMany({
    where: { authSource: 'LDAP', status: 'ACTIVE', ldapDn: { not: null } },
    select: { id: true, email: true, ldapDn: true },
  });
  if (!accounts.length) return { checked: 0, suspended: [] };
  const gone = await ldapAccountsGone(accounts.map((a) => a.ldapDn!));
  const lost = accounts.filter((a) => gone.has(a.ldapDn!));
  if (lost.length > 1 && lost.length * 2 > accounts.length) {
    return {
      checked: accounts.length,
      suspended: [],
      skipped: `${lost.length} de ${accounts.length} contas não encontradas: confira a configuração do AD`,
    };
  }
  const now = new Date();
  for (const account of lost) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: account.id }, data: { status: 'SUSPENDED' } });
      await tx.session.deleteMany({ where: { userId: account.id } });
      await tx.apiToken.updateMany({
        where: { userId: account.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await audit(tx, null, {
        action: 'USER_SUSPENDED',
        actorId: null,
        targetUserId: account.id,
        targetLabel: account.email,
        detail: 'conta removida ou desativada no AD',
      });
    });
  }
  return { checked: accounts.length, suspended: lost.map((a) => a.email) };
}

/** De hora em hora, com o AD ligado. */
export function startLdapSweep(log: {
  warn: (msg: string) => void;
  error: (obj: object, msg: string) => void;
}) {
  if (!ldapConfig()) return;
  const run = () =>
    sweepLdapAccounts()
      .then((r) => {
        if (r.skipped) log.warn(`[ldap] varredura sem efeito: ${r.skipped}`);
      })
      .catch((err: unknown) => log.error({ err }, '[ldap] AD indisponível na varredura'));
  setInterval(() => void run(), HOUR_MS).unref();
}
