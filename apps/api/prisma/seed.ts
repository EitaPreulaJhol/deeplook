import bcrypt from 'bcryptjs';

import { Role } from '../src/generated/prisma/client';
import { createPrismaClient } from '../src/lib/prisma';

const prisma = createPrismaClient();

/** Senhas publicas (compose e .env.example): quem ainda as usa troca ao entrar. */
const DEFAULT_PASSWORDS = ['admin12345', 'change-me-admin-password'];

async function main() {
  const email = (process.env.ADMIN_EMAIL || 'admin@deeplook.local').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin12345';
  const name = process.env.ADMIN_NAME || 'Administrator';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    for (const known of DEFAULT_PASSWORDS) {
      if (await bcrypt.compare(known, existing.passwordHash)) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { mustChangePassword: true },
        });
        console.log(`[seed] Admin ${email} ainda usa a senha padrao: troca no proximo acesso.`);
        return;
      }
    }
    console.log(`[seed] Admin ${email} ja existe, nada a fazer.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: name,
      role: Role.ADMIN,
      status: 'ACTIVE',
      // A senha veio do .env (ou e a padrao): a definitiva e so da pessoa.
      mustChangePassword: true,
    },
  });

  console.log(`[seed] Admin criado: ${email}`);
}

main()
  .catch((e) => {
    console.error('[seed] Erro:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
