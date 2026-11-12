import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { audit } from '../lib/audit';
import { requireAdmin, requireUser } from '../lib/auth';
import { verifyPassword } from '../lib/crypto';
import type { Db } from '../lib/prisma';
import { prisma } from '../lib/prisma';
import { attemptLimit, sessionKey } from '../lib/rate-limit';
import {
  decryptSecret,
  encryptSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  newRecoveryCodes,
  newSecret,
  otpauthUri,
  qrSvg,
  verifyTotp,
} from '../lib/two-factor';
import { sendValidationError } from '../lib/validation';

const CodeSchema = z.object({ code: z.string().trim().min(6).max(20) });
const SensitiveSchema = z.object({
  password: z.string().min(1),
  code: z.string().trim().min(6).max(20),
});

const fieldError = (field: string, message: string) => ({
  error: 'Dados inválidos.',
  details: { [field]: [message] },
});

/**
 * Confere o segundo fator: codigo do aplicativo (sem repetir um codigo ja
 * usado) ou um codigo de recuperacao ainda nao usado (que e gasto).
 */
export async function checkSecondFactor(
  db: Db,
  userId: string,
  code: string,
): Promise<
  { ok: false; broken?: boolean } | { ok: true; via: 'totp' | 'recovery'; remaining?: number }
> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorLastStep: true },
  });
  if (!user?.twoFactorSecret) return { ok: false };
  // Chave trocada sem recifrar (DATA_KEY, ou o SESSION_SECRET no modo antigo): o segredo nao
  // decifra mais; so os codigos de recuperacao valem.
  let secret: string | null;
  try {
    secret = decryptSecret(user.twoFactorSecret);
  } catch {
    secret = null;
  }
  const step = secret ? verifyTotp(secret, code, user.twoFactorLastStep) : null;
  if (step !== null) {
    // So um pedido simultaneo com o mesmo codigo avanca o passo; os outros sao recusados.
    const { count } = await db.user.updateMany({
      where: { id: userId, OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }] },
      data: { twoFactorLastStep: step },
    });
    return count ? { ok: true, via: 'totp' } : { ok: false };
  }
  const broken = secret === null;
  if (!looksLikeRecoveryCode(code)) return { ok: false, broken };
  const used = await db.twoFactorRecoveryCode.updateMany({
    where: { userId, codeHash: hashRecoveryCode(code), usedAt: null },
    data: { usedAt: new Date() },
  });
  if (used.count === 0) return { ok: false, broken };
  const remaining = await db.twoFactorRecoveryCode.count({ where: { userId, usedAt: null } });
  return { ok: true, via: 'recovery', remaining };
}

async function replaceRecoveryCodes(db: Db, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await db.twoFactorRecoveryCode.deleteMany({ where: { userId } });
  await db.twoFactorRecoveryCode.createMany({
    data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })),
  });
  return codes;
}

const disableData = {
  twoFactorSecret: null,
  twoFactorPendingSecret: null,
  twoFactorEnabledAt: null,
  twoFactorLastStep: null,
};

/** Minha Conta > 2FA (opcional) e o "Desativar 2FA" do admin. */
export async function twoFactorRoutes(app: FastifyInstance) {
  // Tentativas de codigo/senha nas acoes sensiveis: 5 a cada 5 min por sessao.
  const limit = attemptLimit(sessionKey('2fa'));

  app.get('/api/me/2fa', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const record = await prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabledAt: true },
    });
    const remaining = await prisma.twoFactorRecoveryCode.count({
      where: { userId: user.id, usedAt: null },
    });
    return reply.send({
      enabled: Boolean(record?.twoFactorEnabledAt),
      enabledAt: record?.twoFactorEnabledAt ?? null,
      recoveryRemaining: record?.twoFactorEnabledAt ? remaining : 0,
    });
  });

  // Passo 1: segredo novo (pendente ate confirmar com um codigo do aplicativo).
  app.post('/api/me/2fa/setup', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.twoFactorEnabled) return reply.code(409).send({ error: 'O 2FA já está ativo.' });
    const secret = newSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorPendingSecret: encryptSecret(secret) },
    });
    const uri = otpauthUri(user.email, secret);
    return reply.send({ secret, otpauthUri: uri, qrSvg: await qrSvg(uri) });
  });

  // Passo 2: confirma com o codigo; ativa e devolve os codigos de recuperacao (uma vez).
  app.post('/api/me/2fa/enable', { config: limit }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.twoFactorEnabled) return reply.code(409).send({ error: 'O 2FA já está ativo.' });
    const parsed = CodeSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const record = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, twoFactorPendingSecret: true },
    });
    if (!record?.twoFactorPendingSecret) {
      return reply.code(409).send({ error: 'Comece pela leitura do QR code (Ativar 2FA).' });
    }
    const step = verifyTotp(decryptSecret(record.twoFactorPendingSecret), parsed.data.code, null);
    if (step === null) {
      return reply
        .code(400)
        .send(
          fieldError('code', 'código inválido; confira a hora do celular e tente o código atual'),
        );
    }
    const codes = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          twoFactorSecret: record.twoFactorPendingSecret,
          twoFactorPendingSecret: null,
          twoFactorEnabledAt: new Date(),
          twoFactorLastStep: step,
        },
      });
      const created = await replaceRecoveryCodes(tx, user.id);
      await audit(tx, req, {
        action: 'TWO_FACTOR_ENABLED',
        actorId: user.id,
        targetUserId: user.id,
        targetLabel: record.email,
      });
      return created;
    });
    return reply.send({ recoveryCodes: codes });
  });

  /** Senha + segundo fator: base de "Desativar" e "Gerar novos codigos". */
  const confirmSensitive = async (userId: string, body: unknown) => {
    const parsed = SensitiveSchema.safeParse(body);
    if (!parsed.success) return { status: 400, body: null, parsed: null, zod: parsed.error };
    const record = await prisma.user.findUnique({ where: { id: userId } });
    if (!record || !(await verifyPassword(parsed.data.password, record.passwordHash))) {
      return { status: 400, body: fieldError('password', 'senha incorreta') };
    }
    const factor = await checkSecondFactor(prisma, userId, parsed.data.code);
    if (!factor.ok) return { status: 400, body: fieldError('code', 'código inválido') };
    return { status: 200, record, factor };
  };

  app.post('/api/me/2fa/disable', { config: limit }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!user.twoFactorEnabled) return reply.code(409).send({ error: 'O 2FA não está ativo.' });
    const check = await confirmSensitive(user.id, req.body);
    if ('zod' in check && check.zod) return sendValidationError(reply, check.zod);
    if (check.status !== 200) return reply.code(check.status).send(check.body);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: disableData });
      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } });
      await audit(tx, req, {
        action: 'TWO_FACTOR_DISABLED',
        actorId: user.id,
        targetUserId: user.id,
        targetLabel: user.email,
        detail: 'pela própria pessoa',
      });
    });
    return reply.send({ ok: true });
  });

  app.post('/api/me/2fa/recovery-codes', { config: limit }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!user.twoFactorEnabled) return reply.code(409).send({ error: 'O 2FA não está ativo.' });
    const check = await confirmSensitive(user.id, req.body);
    if ('zod' in check && check.zod) return sendValidationError(reply, check.zod);
    if (check.status !== 200) return reply.code(check.status).send(check.body);
    const codes = await prisma.$transaction(async (tx) => {
      const created = await replaceRecoveryCodes(tx, user.id);
      await audit(tx, req, {
        action: 'TWO_FACTOR_RECOVERY_CODES',
        actorId: user.id,
        targetUserId: user.id,
        targetLabel: user.email,
        detail: 'códigos anteriores invalidados',
      });
      return created;
    });
    return reply.send({ recoveryCodes: codes });
  });

  // Admin: quem perdeu o celular e os codigos de recuperacao.
  app.post('/api/admin/users/:id/disable-2fa', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const target = await prisma.user.findUnique({
      where: { id },
      select: { email: true, twoFactorEnabledAt: true },
    });
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado.' });
    if (!target.twoFactorEnabledAt) return reply.code(409).send({ error: 'O 2FA não está ativo.' });
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: disableData });
      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: id } });
      await audit(tx, req, {
        action: 'TWO_FACTOR_DISABLED',
        actorId: admin.id,
        targetUserId: id,
        targetLabel: target.email,
        detail: 'pelo admin',
      });
    });
    return reply.send({ ok: true });
  });
}
