import { prisma } from './prisma';

const OWN_SAMPLES_ONLY = 'ownSamplesOnly';

export async function readSetting(key: string): Promise<unknown> {
  return (await prisma.systemSetting.findUnique({ where: { key } }))?.value ?? null;
}

export async function writeSetting(key: string, value: object | boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  });
}

/**
 * Usuario comum so ve o que ele mesmo enviou (item 140). Lido a cada uso: e uma
 * linha, e desligar ou ligar precisa valer na hora.
 */
export async function ownSamplesOnly(): Promise<boolean> {
  return (await readSetting(OWN_SAMPLES_ONLY)) === true;
}

export async function setOwnSamplesOnly(value: boolean): Promise<void> {
  await writeSetting(OWN_SAMPLES_ONLY, value);
}
