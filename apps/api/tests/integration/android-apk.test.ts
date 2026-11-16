import { createHash } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { riskOf } from '../../src/lib/risk-score';
import { ensureBucket } from '../../src/lib/s3';
import {
  servicesIdle,
  serviceTiming,
  startServiceQueues,
  stopServiceQueues,
} from '../../src/lib/service-analysis';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const TOKEN = '0123456789abcdef01';

// ------------------------------------------------------------------ APK de teste, montado aqui

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const pad4 = (b: Buffer) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);

/**
 * AndroidManifest.xml binario (AXML), o formato que o aapt grava: pool de strings UTF-8, namespace
 * android e os elementos com os atributos como string, booleano ou inteiro. Sem mapa de recursos:
 * o androguard le o nome do atributo pela string.
 */
type Attr = [name: string, value: string | boolean | number];
type Node = { tag: string; attrs?: Attr[]; children?: Node[] };
function axml(root: Node): Buffer {
  const NS = 'http://schemas.android.com/apk/res/android';
  const strings: string[] = [];
  const idx = (s: string) => {
    const i = strings.indexOf(s);
    if (i >= 0) return i;
    strings.push(s);
    return strings.length - 1;
  };
  idx('android');
  idx(NS);
  const walk = (n: Node) => {
    idx(n.tag);
    for (const [k, v] of n.attrs ?? []) {
      idx(k);
      if (typeof v === 'string') idx(v);
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  const data = strings.map((s) => {
    const bytes = Buffer.from(s, 'utf8');
    return Buffer.concat([Buffer.from([s.length, bytes.length]), bytes, Buffer.from([0])]);
  });
  const offsets: number[] = [];
  let at = 0;
  for (const d of data) {
    offsets.push(at);
    at += d.length;
  }
  const poolData = pad4(Buffer.concat(data));
  const poolHeader = 28 + strings.length * 4;
  const pool = Buffer.concat([
    u16(0x0001),
    u16(28),
    u32(poolHeader + poolData.length),
    u32(strings.length),
    u32(0),
    u32(0x100), // UTF8_FLAG
    u32(poolHeader),
    u32(0),
    ...offsets.map(u32),
    poolData,
  ]);
  const node = (type: number, body: Buffer) =>
    Buffer.concat([u16(type), u16(16), u32(16 + body.length), u32(1), u32(0xffffffff), body]);
  const ns = idx(NS);
  const chunks: Buffer[] = [node(0x0100, Buffer.concat([u32(idx('android')), u32(ns)]))];
  const emit = (n: Node) => {
    const attrs = (n.attrs ?? []).map(([k, v]) => {
      const [raw, type, value] =
        typeof v === 'string'
          ? [idx(v), 0x03, idx(v)]
          : typeof v === 'boolean'
            ? [0xffffffff, 0x12, v ? 0xffffffff : 0]
            : [0xffffffff, 0x10, v];
      return Buffer.concat([
        u32(ns),
        u32(idx(k)),
        u32(raw),
        u16(8),
        Buffer.from([0, type]),
        u32(value),
      ]);
    });
    chunks.push(
      node(
        0x0102,
        Buffer.concat([
          u32(0xffffffff),
          u32(idx(n.tag)),
          u16(0x14),
          u16(0x14),
          u16(attrs.length),
          u16(0),
          u16(0),
          u16(0),
          ...attrs,
        ]),
      ),
    );
    for (const c of n.children ?? []) emit(c);
    chunks.push(node(0x0103, Buffer.concat([u32(0xffffffff), u32(idx(n.tag))])));
  };
  emit(root);
  chunks.push(node(0x0101, Buffer.concat([u32(idx('android')), u32(ns)])));
  const body = Buffer.concat([pool, ...chunks]);
  return Buffer.concat([u16(0x0003), u16(8), u32(8 + body.length), body]);
}

/** Adler-32 (o checksum do cabecalho do DEX). */
function adler32(data: Buffer): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** DEX minimo: o cabecalho, a tabela de strings e o map_list (sem classes). */
function dex(strings: string[]): Buffer {
  const sorted = [...strings].sort();
  const headerSize = 0x70;
  const idsOff = headerSize;
  const dataOff = idsOff + sorted.length * 4;
  const items = sorted.map((s) => {
    const bytes = Buffer.from(s, 'utf8');
    return Buffer.concat([Buffer.from([s.length]), bytes, Buffer.from([0])]);
  });
  const offsets: number[] = [];
  let at = dataOff;
  for (const it of items) {
    offsets.push(at);
    at += it.length;
  }
  const strData = Buffer.concat(items);
  const mapOff = dataOff + pad4(strData).length;
  const map = Buffer.concat([
    u32(4),
    ...[
      [0x0000, 1, 0],
      [0x0001, sorted.length, idsOff],
      [0x2002, sorted.length, dataOff],
      [0x1000, 1, mapOff],
    ].flatMap(([type, size, off]) => [u16(type), u16(0), u32(size), u32(off)]),
  ]);
  const size = mapOff + map.length;
  const header = Buffer.alloc(headerSize);
  header.write('dex\n035\0', 0, 'latin1');
  header.writeUInt32LE(size, 32);
  header.writeUInt32LE(headerSize, 36);
  header.writeUInt32LE(0x12345678, 40);
  header.writeUInt32LE(mapOff, 52);
  header.writeUInt32LE(sorted.length, 56);
  header.writeUInt32LE(idsOff, 60);
  header.writeUInt32LE(size - dataOff, 104);
  header.writeUInt32LE(dataOff, 108);
  const file = Buffer.concat([header, Buffer.concat(offsets.map(u32)), pad4(strData), map]);
  createHash('sha1').update(file.subarray(32)).digest().copy(file, 12);
  file.writeUInt32LE(adler32(file.subarray(12)) >>> 0, 8);
  return file;
}

/** ZIP minimo (deflate). */
function zip(files: [string, Buffer][]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const body = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc32(data) >>> 0, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    head.copy(cd, 10, 8, 30);
    cd.writeUInt32LE(offset, 42);
    local.push(head, nameBuf, body);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cdBuf, end]);
}

/** Um "banker" de mentira: acessibilidade, SMS, DexClassLoader, um payload em assets e um C2. */
function bankerApk(): Buffer {
  const perm = (p: string): Node => ({
    tag: 'uses-permission',
    attrs: [['name', `android.permission.${p}`]],
  });
  const manifest = axml({
    tag: 'manifest',
    attrs: [
      ['package', 'br.deeplook.teste.banker'],
      ['versionCode', 7],
      ['versionName', '1.0.7'],
    ],
    children: [
      {
        tag: 'uses-sdk',
        attrs: [
          ['minSdkVersion', 21],
          ['targetSdkVersion', 30],
        ],
      },
      perm('RECEIVE_SMS'),
      perm('READ_SMS'),
      perm('SEND_SMS'),
      perm('SYSTEM_ALERT_WINDOW'),
      perm('INTERNET'),
      {
        tag: 'application',
        attrs: [['label', 'Banco Teste']],
        children: [
          {
            tag: 'activity',
            attrs: [['name', 'br.deeplook.teste.banker.Main']],
            children: [
              {
                tag: 'intent-filter',
                children: [
                  { tag: 'action', attrs: [['name', 'android.intent.action.MAIN']] },
                  { tag: 'category', attrs: [['name', 'android.intent.category.LAUNCHER']] },
                ],
              },
            ],
          },
          {
            tag: 'service',
            attrs: [
              ['name', 'br.deeplook.teste.banker.Leitor'],
              ['permission', 'android.permission.BIND_ACCESSIBILITY_SERVICE'],
              ['exported', true],
            ],
            children: [
              {
                tag: 'intent-filter',
                children: [
                  {
                    tag: 'action',
                    attrs: [['name', 'android.accessibilityservice.AccessibilityService']],
                  },
                ],
              },
            ],
          },
          {
            tag: 'receiver',
            attrs: [
              ['name', 'br.deeplook.teste.banker.Sms'],
              ['exported', false],
            ],
          },
        ],
      },
    ],
  });
  const classes = dex([
    'Landroid/accessibilityservice/AccessibilityService;',
    'Landroid/telephony/SmsManager;',
    'sendTextMessage',
    'Ldalvik/system/DexClassLoader;',
    'http://deeplook-banker.top/gate.php',
    'Lbr/deeplook/teste/banker/Main;',
  ]);
  return zip([
    ['AndroidManifest.xml', manifest],
    ['classes.dex', classes],
    ['assets/payload.dex', Buffer.from('dex\n035\0 escondido')],
    ['resources.arsc', Buffer.alloc(0)],
  ]);
}

// APK/Android (plans/novas-analises, item 6): o servico android de verdade (androguard) com um APK
// montado aqui, os alertas, os IOCs, a pontuacao de risco e o que nao e APK.
async function main() {
  await ensureBucket(3, 500);
  env.ANDROID_URL = 'http://localhost:53700';
  env.ANDROID_TOKEN = TOKEN;
  env.EMULATE_URL = '';
  env.EXTRACT_URL = '';
  Object.assign(serviceTiming, { serviceWaitMs: 30_000, retryEveryMs: 300, retryAfterMs: 0 });
  const app = await buildApp();
  await app.ready();
  const log = { info: () => undefined, error: (o: object, m: string) => console.log('LOG', m, o) };
  await startServiceQueues(log);
  stopServiceQueues();

  const passwordHash = await hashPassword('senha-123!');
  await prisma.user.create({
    data: { email: 'ana@x.io', displayName: 'Ana', role: 'ANALYST', passwordHash },
  });
  const cAna = String(
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
      headers: { cookie: cAna, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    return r.json().entry.id;
  };
  const get = async (id: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/entries/${id}/analyses/android`,
        headers: { cookie: cAna },
      })
    ).json();

  // ---- 1. O APK vai sozinho para a fila.
  const apk = await upload('banco.apk', bankerApk());
  await servicesIdle();
  const a = await get(apk);
  const r = a.analysis?.result;
  ok('APK vai sozinho e conclui', a.enabled && a.auto && a.analysis?.status === 'DONE', a.analysis);
  ok('versão do androguard', /^androguard /.test(a.analysis?.version ?? ''), a.analysis?.version);
  ok(
    'manifesto: pacote, versão e SDK',
    r?.package === 'br.deeplook.teste.banker' &&
      r.versionName === '1.0.7' &&
      r.versionCode === '7' &&
      r.minSdk === '21' &&
      r.targetSdk === '30',
    r,
  );
  ok(
    'permissões perigosas marcadas',
    r?.permissions?.some(
      (p: { short: string; dangerous: boolean }) => p.short === 'SEND_SMS' && p.dangerous,
    ) &&
      r.permissions.some(
        (p: { short: string; dangerous: boolean }) => p.short === 'INTERNET' && !p.dangerous,
      ),
    r?.permissions,
  );
  ok(
    'componentes exportados: a atividade principal e o serviço de acessibilidade, não o receiver',
    r?.exported?.length === 2 &&
      r.exported.some(
        (c: { kind: string; permission: string | null }) =>
          c.kind === 'service' && c.permission === 'android.permission.BIND_ACCESSIBILITY_SERVICE',
      ),
    r?.exported,
  );
  ok(
    'APIs sensíveis pela tabela de strings do DEX',
    ['accessibility', 'sms_send', 'dex_loader'].every((x) => r?.apis?.includes(x)),
    r?.apis,
  );
  ok(
    'carga escondida em assets',
    r?.hiddenPayloads?.includes('assets/payload.dex'),
    r?.hiddenPayloads,
  );
  ok('sem assinatura', r?.signed?.v1 === false && r.signed.v2 === false, r?.signed);
  const texts = (a.analysis?.alerts ?? []).map(
    (x: { level: string; text: string }) => `${x.level}:${x.text}`,
  );
  ok(
    'alerta alto: acessibilidade com SMS',
    texts.some((t: string) => t.startsWith('high:Acessibilidade com SMS')),
    texts,
  );
  ok(
    'alerta alto: código carregado em execução',
    texts.some((t: string) => t.startsWith('high:Carrega código')),
    texts,
  );
  ok(
    'alerta: não assinado',
    texts.some((t: string) => t.includes('não está assinado')),
    texts,
  );
  ok(
    'IOC: a URL do C2',
    a.analysis?.iocs?.includes('http://deeplook-banker.top/gate.php'),
    a.analysis?.iocs,
  );
  const risk = await riskOf(apk);
  ok(
    'pontuação de risco soma o APK',
    risk?.reasons.some((x) => x.source === 'Android' && x.weight >= 30),
    risk?.reasons,
  );

  // ---- 2. ZIP comum: nao vai sozinho; pedido a mao, o servico diz que nao e APK.
  const plain = await upload('fotos.zip', zip([['a.txt', Buffer.from('oi')]]));
  await servicesIdle();
  ok('ZIP não vai sozinho', (await get(plain)).analysis === null);
  const req = await app.inject({
    method: 'POST',
    url: `/api/entries/${plain}/analyses/android`,
    payload: {},
    headers: { cookie: cAna },
  });
  ok('pedido a mão aceito', req.statusCode === 202, req.body);
  await servicesIdle();
  const z = await get(plain);
  ok(
    'não é APK: falha legível',
    z.analysis?.status === 'FAILED' && /APK válido/.test(z.analysis.error ?? ''),
    z.analysis,
  );
  ok(
    'opção recusada no APK',
    (
      await app.inject({
        method: 'POST',
        url: `/api/entries/${apk}/analyses/android`,
        payload: { kind: 'shellcode' },
        headers: { cookie: cAna },
      })
    ).statusCode === 400,
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
