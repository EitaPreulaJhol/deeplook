import bcrypt from 'bcryptjs';

import { Role } from './generated/prisma/client';
import { createPrismaClient } from './lib/prisma';
import { PUBLIC_ADMIN_PASSWORDS } from './lib/public-defaults';
import { loadSecretFiles } from './secret-files';

// Segredos por arquivo (ADMIN_PASSWORD_FILE, RESTORE_PASSWORD_FILE...; plano pos-revisao 5.1).
loadSecretFiles();

const prisma = createPrismaClient();

const PUBLIC_HINT =
  'Em producao o login com ela fica bloqueado: defina ADMIN_PASSWORD no .env e reinicie.';

async function main() {
  const email = (process.env.ADMIN_EMAIL || 'admin@deeplook.local').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin12345';
  const name = process.env.ADMIN_NAME || 'Administrator';

  const envIsPublic = PUBLIC_ADMIN_PASSWORDS.includes(password);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    for (const known of PUBLIC_ADMIN_PASSWORDS) {
      if (!(await bcrypt.compare(known, existing.passwordHash))) continue;
      if (envIsPublic) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { mustChangePassword: true },
        });
        console.log(
          `[seed] Admin ${email} ainda usa a senha padrao, que e publica. ${PUBLIC_HINT}`,
        );
        return;
      }
      // O .env ja tem uma senha propria: ela substitui a publica (e ainda e trocada ao entrar).
      await prisma.$transaction([
        prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: await bcrypt.hash(password, 12),
            mustChangePassword: true,
            passwordChangedAt: new Date(),
          },
        }),
        prisma.session.deleteMany({ where: { userId: existing.id } }),
      ]);
      console.log(
        `[seed] Admin ${email} usava a senha padrao: agora entra com a do ADMIN_PASSWORD.`,
      );
      return;
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
  if (envIsPublic)
    console.log(`[seed] ADMIN_PASSWORD e a senha padrao, que e publica. ${PUBLIC_HINT}`);
}

main()
  .catch((e) => {
    console.error('[seed] Erro:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
