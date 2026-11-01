import { prisma } from './prisma';

const OWN_SAMPLES_ONLY = 'ownSamplesOnly';

/**
 * Usuario comum so ve o que ele mesmo enviou (item 140). Lido a cada uso: e uma
 * linha, e desligar ou ligar precisa valer na hora.
 */
export async function ownSamplesOnly(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: OWN_SAMPLES_ONLY } });
  return row?.value === true;
}

export async function setOwnSamplesOnly(value: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: OWN_SAMPLES_ONLY },
    create: { key: OWN_SAMPLES_ONLY, value },
    update: { value },
  });
}
