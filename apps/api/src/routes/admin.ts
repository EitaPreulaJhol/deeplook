import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { checkAuditChain } from '../lib/audit-check';
import { AUDIT_LABELS } from '../lib/audit-labels';
import { requireAdmin } from '../lib/auth';
import { generateActivationCode, generateTemporaryPassword, hashPassword } from '../lib/crypto';
import { csvSeparator, toCsv } from '../lib/csv';
import { requestLang } from '../lib/error-language';
import { localizeAudit } from '../lib/history-language';
import { passwordState } from '../lib/password-policy';
import { prisma } from '../lib/prisma';
import { closeSessionsOf } from '../lib/sandbox';
import { localizeStatus, systemStatus } from '../lib/status';
import { sendValidationError } from '../lib/validation';

const CreateKeySchema = z.object({
  role: z.enum(['USER', 'ANALYST', 'ADMIN']).default('USER'),
  maxUses: z.coerce.number().int().min(1).max(1000).default(1),
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
});

const PatchUserSchema = z.object({
  role: z.enum(['USER', 'ANALYST', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  /** Acesso por API (tokens pessoais); retirar revoga todos os tokens ativos. */
  apiAccess: z.boolean().optional(),
});

const AuditQuery = z.object({
  action: z
    .enum([
      'USER_REGISTERED',
      'USER_ROLE_CHANGED',
      'USER_SUSPENDED',
      'USER_REACTIVATED',
      'USER_LDAP_RELINKED',
      'USER_PASSWORD_RESET',
      'USER_PASSWORD_CHANGED',
      'KEY_CREATED',
      'KEY_REVOKED',
      'TEMPLATE_CREATED',
      'TEMPLATE_UPDATED',
      'TEMPLATE_DELETED',
      'LOGIN_FAILED',
      'LOGIN_LOCKED',
      'API_ACCESS_GRANTED',
      'API_ACCESS_REVOKED',
      'API_TOKEN_CREATED',
      'API_TOKEN_REVOKED',
      'SESSION_REVOKED',
      'TWO_FACTOR_ENABLED',
      'TWO_FACTOR_DISABLED',
      'TWO_FACTOR_RECOVERY_CODES',
      'TWO_FACTOR_RECOVERY_USED',
      'ENTRY_TRASHED',
      'ENTRY_RESTORED',
      'ENTRY_DELETED',
      'ENTRY_DOWNLOADED',
      'ENTRY_INTEGRITY_FAILED',
      'ENTRY_INTEGRITY_RESTORED',
      'YARA_RULE_CREATED',
      'YARA_RULE_UPDATED',
      'YARA_RULE_DELETED',
      'SIGMA_RULE_CREATED',
      'SIGMA_RULE_UPDATED',
      'SIGMA_RULE_DELETED',
      'ALLOWLIST_ADDED',
      'ALLOWLIST_REMOVED',
      'ALLOWLIST_IMPORTED',
      'BACKUP_CREATED',
      'BACKUP_DOWNLOADED',
      'BACKUP_DELETED',
      'COMPANY_DOMAIN_ADDED',
      'COMPANY_DOMAIN_REMOVED',
      'TRIAGE_RULE_CHANGED',
      'SETTING_CHANGED',
      'YARA_PACK_UPDATED',
      'ASSIGNMENT_CHANGED',
      'BROADCAST_PUBLISHED',
      'BROADCAST_ENDED',
      'SANDBOX_STOPPED',
      'WORKER_PAUSED',
      'WORKER_RESUMED',
      'JOB_CANCELLED',
      'JOB_RETRIED',
    ])
    .optional(),
  q: z.string().trim().max(100).optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function adminRoutes(app: FastifyInstance) {
  // Status do sistema: API, banco, MinIO, Proxmox e filas (cada um com tempo-limite).
  app.get('/api/admin/status', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    return reply.send(localizeStatus(await systemStatus(), requestLang(req)));
  });

  // ---- Usuarios ----
  // Auditoria: filtros por acao, periodo e texto (quem, alvo, detalhe, IP).
  const auditWhere = (q: z.infer<typeof AuditQuery>): Prisma.AuditEventWhereInput => {
    const where: Prisma.AuditEventWhereInput = {};
    if (q.action) where.action = q.action;
    if (q.days) where.createdAt = { gte: new Date(Date.now() - q.days * 86400000) };
    if (q.q) {
      const text = { contains: q.q, mode: 'insensitive' as const };
      where.OR = [
        { targetLabel: text },
        { detail: text },
        { ip: text },
        { actor: { displayName: text } },
        { actor: { email: text } },
      ];
    }
    return where;
  };
  const auditInclude = {
    actor: { select: { id: true, displayName: true, email: true } },
    targetUser: { select: { id: true, displayName: true, email: true } },
  } satisfies Prisma.AuditEventInclude;

  app.get('/api/admin/audit', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = AuditQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const where = auditWhere(parsed.data);
    const [total, items] = await Promise.all([
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: parsed.data.offset,
        take: parsed.data.limit,
        include: auditInclude,
      }),
    ]);
    // Detalhe e alvo no idioma de quem pede (plano pos-revisao, item 1.4).
    return reply.send({ total, items: localizeAudit(items, requestLang(req)) });
  });

  // Cadeia da auditoria (revisao de novembro, 1.3): confere agora e devolve a ponta.
  app.get('/api/admin/audit/verify', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return reply.send(await checkAuditChain());
  });

  app.get('/api/admin/audit/export.csv', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = AuditQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const lang = requestLang(req);
    const en = lang === 'en';
    const items = localizeAudit(
      await prisma.auditEvent.findMany({
        where: auditWhere(parsed.data),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10000,
        include: auditInclude,
      }),
      lang,
    );
    // No idioma de quem baixa (plano pos-revisao, item 1.4): cabecalho, acao, detalhe e alvo.
    const csv = toCsv(
      en
        ? ['Date', 'Who', 'Action', 'Target', 'Detail', 'IP', 'Sequence', 'Hash']
        : ['Data', 'Quem', 'Ação', 'Alvo', 'Detalhe', 'IP', 'Sequência', 'Hash'],
      items.map((e) => [
        e.createdAt,
        e.actor ? `${e.actor.displayName} <${e.actor.email}>` : en ? '(anonymous)' : '(anônimo)',
        AUDIT_LABELS[e.action][en ? 1 : 0],
        e.targetLabel ?? e.targetUser?.email ?? '',
        e.detail ?? '',
        e.ip ?? '',
        e.seq ?? '',
        e.hash ?? '',
      ]),
      csvSeparator(lang),
    );
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="deeplook-auditoria-${day}.csv"`)
      .send(csv);
  });

  app.get('/api/admin/users', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        createdAt: true,
        apiAccess: true,
        mustChangePassword: true,
        passwordChangedAt: true,
        twoFactorEnabledAt: true,
        authSource: true,
        _count: {
          select: {
            entries: true,
            apiTokens: { where: { revokedAt: null, expiresAt: { gt: new Date() } } },
          },
        },
      },
    });
    // Senha vencida pela politica (calculada; admins nao expiram).
    return reply.send({
      users: users.map(({ passwordChangedAt, ...u }) => ({
        ...u,
        passwordExpired:
          passwordState({ ...u, passwordChangedAt }).passwordChangeReason === 'expired',
      })),
    });
  });

  app.patch('/api/admin/users/:id', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const parsed = PatchUserSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos.' });

    if (id === user.id && parsed.data.status === 'SUSPENDED') {
      return reply.code(400).send({ error: 'Você não pode suspender a própria conta.' });
    }

    const before = await prisma.user.findUnique({
      where: { id },
      select: { email: true, role: true, status: true, apiAccess: true, authSource: true },
    });
    if (!before) return reply.code(404).send({ error: 'Usuário não encontrado.' });
    // O papel de conta do AD vem dos grupos: o proximo login desfaria (item 107).
    if (
      before.authSource === 'LDAP' &&
      parsed.data.role !== undefined &&
      parsed.data.role !== before.role
    ) {
      return reply.code(409).send({ error: 'Conta do AD: o papel vem dos grupos do AD.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id },
        data: parsed.data,
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          status: true,
          createdAt: true,
          apiAccess: true,
        },
      });
      const target = { actorId: user.id, targetUserId: id, targetLabel: before.email };
      // Suspender encerra o acesso de vez: reativar nao devolve sessao nem token antigos.
      let revoked: string | undefined;
      if (parsed.data.status === 'SUSPENDED' && before.status !== 'SUSPENDED') {
        const sessions = await tx.session.deleteMany({ where: { userId: id } });
        const tokens = await tx.apiToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        revoked = `${sessions.count} sessão(ões) e ${tokens.count} token(s) revogados`;
      }
      if (parsed.data.apiAccess !== undefined && parsed.data.apiAccess !== before.apiAccess) {
        let detail: string | undefined;
        if (!parsed.data.apiAccess) {
          const { count } = await tx.apiToken.updateMany({
            where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
            data: { revokedAt: new Date() },
          });
          detail = `${count} token(s) revogado(s)`;
        }
        await audit(tx, req, {
          ...target,
          action: parsed.data.apiAccess ? 'API_ACCESS_GRANTED' : 'API_ACCESS_REVOKED',
          detail,
        });
      }
      if (parsed.data.role && parsed.data.role !== before.role) {
        await audit(tx, req, {
          ...target,
          action: 'USER_ROLE_CHANGED',
          detail: `${before.role} → ${parsed.data.role}`,
        });
      }
      if (parsed.data.status && parsed.data.status !== before.status) {
        await audit(tx, req, {
          ...target,
          action: parsed.data.status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
          detail: revoked,
        });
      }
      return result;
    });
    // Sem o papel de analista (ou suspensa), o ambiente aberto nao fica para tras.
    const suspended = parsed.data.status === 'SUSPENDED' && before.status !== 'SUSPENDED';
    const demoted = parsed.data.role === 'USER' && before.role !== 'USER';
    if (suspended || demoted) closeSessionsOf(id, req.log);
    return reply.send({ user: updated });
  });

  // Redefine a senha de um usuario: gera uma senha temporaria (devolvida uma
  // unica vez, para o admin repassar) e encerra todas as sessoes dele.
  app.post('/api/admin/users/:id/reset-password', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const { id } = req.params as { id: string };
    if (id === admin.id) {
      return reply
        .code(400)
        .send({ error: 'Para trocar a própria senha, use Minha conta > Alterar senha.' });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, authSource: true },
    });
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado.' });
    if (target.authSource === 'LDAP') {
      return reply.code(409).send({ error: 'Conta do AD: a senha é redefinida no AD.' });
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await prisma.$transaction(async (tx) => {
      // Troca obrigatoria no proximo login: a temporaria foi vista pelo admin.
      await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
      await tx.session.deleteMany({ where: { userId: id } });
      // Quem redefine suspeita da conta: os tokens tambem caem (item 108).
      await tx.apiToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // A senha temporaria NAO vai para a auditoria.
      await audit(tx, req, {
        action: 'USER_PASSWORD_RESET',
        actorId: admin.id,
        targetUserId: id,
        targetLabel: target.email,
        detail: 'sessões encerradas · troca obrigatória no próximo login',
      });
    });

    return reply.send({ temporaryPassword });
  });

  // ---- Chaves de ativacao ----
  app.get('/api/admin/activation-keys', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;

    const keys = await prisma.activationKey.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, displayName: true } },
        usedBy: { select: { id: true, displayName: true, email: true } },
      },
    });
    return reply.send({ keys });
  });

  app.post('/api/admin/activation-keys', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;

    const parsed = CreateKeySchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { role, maxUses, expiresInDays } = parsed.data;

    let code = generateActivationCode();
    for (let i = 0; i < 5; i++) {
      const exists = await prisma.activationKey.findUnique({ where: { code } });
      if (!exists) break;
      code = generateActivationCode();
    }

    const key = await prisma.$transaction(async (tx) => {
      const created = await tx.activationKey.create({
        data: {
          code,
          role,
          maxUses,
          expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null,
          createdById: user.id,
        },
        include: { createdBy: { select: { id: true, displayName: true } } },
      });
      await audit(tx, req, {
        action: 'KEY_CREATED',
        actorId: user.id,
        targetLabel: code,
        detail: `papel ${role} · ${maxUses} uso(s) · ${expiresInDays ? `${expiresInDays} dia(s)` : 'sem prazo'}`,
      });
      return created;
    });
    return reply.code(201).send({ key });
  });

  app.delete('/api/admin/activation-keys/:id', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const key = await prisma.activationKey.findUnique({ where: { id } });
    if (!key) return reply.code(404).send({ error: 'Chave não encontrada.' });

    await prisma.$transaction(async (tx) => {
      await tx.activationKey.update({ where: { id }, data: { revoked: true } });
      await audit(tx, req, { action: 'KEY_REVOKED', actorId: user.id, targetLabel: key.code });
    });
    return reply.send({ ok: true });
  });
}
