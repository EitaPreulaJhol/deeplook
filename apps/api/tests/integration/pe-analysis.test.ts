import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import type { Prisma } from '../../src/generated/prisma/client';
import { hashPassword } from '../../src/lib/crypto';
import { parsePe, PE_REVISION, peChecksum, relationHashes } from '../../src/lib/pe-analysis';
import { backfillPeAnalysis } from '../../src/lib/pe-backfill';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import { analyzeBuffer } from '../../src/lib/static-analysis';

// Analise de PE (item 7.1) contra executaveis reais (mingw-w64, mcs, upx, osslsigncode) e o
// gabarito do pefile, do dnfile e do osslsigncode, gerados por tests/fixtures/pe/gen.sh.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const DIR = join(process.env.TEST_TMP!, 'pe');
const file = (name: string) => readFileSync(join(DIR, name));

type Ref = Record<string, any>;
const REF: Record<string, Ref> = JSON.parse(readFileSync(join(DIR, 'reference.json'), 'utf8'));

const RT: Record<number, string> = { 10: 'RCDATA', 16: 'VERSION', 24: 'MANIFEST' };

/** Onde estao cabecalho opcional, diretorios e secoes, para montar os casos hostis. */
function layout(buf: Buffer) {
  const pe = buf.readUInt32LE(0x3c);
  const opt = pe + 24;
  const is64 = buf.readUInt16LE(opt) === 0x20b;
  const dirs = opt + (is64 ? 112 : 96);
  const nSec = buf.readUInt16LE(pe + 6);
  const secTable = opt + buf.readUInt16LE(pe + 20);
  const sections = Array.from({ length: nSec }, (_, i) => {
    const s = secTable + i * 40;
    return {
      va: buf.readUInt32LE(s + 12),
      vsize: buf.readUInt32LE(s + 8),
      raw: buf.readUInt32LE(s + 20),
      rawSize: buf.readUInt32LE(s + 16),
    };
  });
  const off = (rva: number) => {
    const s = sections.find((x) => rva >= x.va && rva < x.va + Math.max(x.vsize, x.rawSize))!;
    return rva - s.va + s.raw;
  };
  const dir = (i: number) => ({ rva: buf.readUInt32LE(dirs + i * 8), at: dirs + i * 8 });
  const imageBase = is64 ? buf.readBigUInt64LE(opt + 24) : BigInt(buf.readUInt32LE(opt + 28));
  return { opt, is64, dir, off, sections, imageBase };
}

const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const t = Date.now();
  const value = fn();
  return { value, ms: Date.now() - t };
};

/** Porta literal do generate_checksum do pefile, passo a passo (para conferir o atalho). */
function checksumReference(d: Buffer, off: number): number {
  const skip = Math.floor(off / 4);
  const rem = d.length % 4;
  const words = (d.length + (rem ? 4 - rem : 0)) / 4;
  let c = 0n;
  for (let i = 0; i < words; i++) {
    if (i === skip) continue;
    let w: number;
    if (i + 1 === words && rem) {
      const b = Buffer.alloc(4);
      d.copy(b, 0, i * 4);
      w = b.readUInt32LE(0);
    } else w = d.readUInt32LE(i * 4);
    c += BigInt(w);
    if (c >= 2n ** 32n) c = (c & 0xffffffffn) + (c >> 32n);
  }
  c = (c & 0xffffn) + (c >> 16n);
  c = c + (c >> 16n);
  return Number(c & 0xffffn) + d.length;
}

async function main() {
  // ------------------------------------------------------------ 1. contra o gabarito
  // O gabarito do ELF (telfhash) fica para a parte dos pivos.
  for (const [name, r] of Object.entries(REF).filter(([n]) => n !== 'linux.elf')) {
    const pe = parsePe(file(name), name)!;
    ok(`${name}: imphash igual ao do pefile`, pe.imphash === r.imphash, [pe.imphash, r.imphash]);
    ok(`${name}: Rich hash igual ao do pefile`, (pe.rich?.hash ?? null) === r.richHash, [
      pe.rich?.hash,
      r.richHash,
    ]);
    ok(
      `${name}: imports na ordem do arquivo`,
      same(
        pe.imports.map((i) => [i.dll, i.names]),
        r.imports.map((i: Ref) => [i.dll.toLowerCase(), i.functions]),
      ),
    );
    ok(
      `${name}: exports`,
      same(
        pe.exports?.symbols ?? null,
        r.exports?.symbols.map((x: Ref) => ({
          ordinal: x.ordinal,
          name: x.name,
          forwarder: x.forwarder,
        })) ?? null,
      ) && (pe.exports?.dll ?? null) === (r.exports?.name ?? null),
      [pe.exports, r.exports],
    );
    ok(`${name}: TLS callbacks`, pe.tlsCallbacks === (r.tlsCallbacks?.length ?? 0));
    ok(
      `${name}: checksum declarado e calculado`,
      pe.checksum?.declared === r.checksum.declared &&
        pe.checksum?.computed === r.checksum.computed,
      [pe.checksum, r.checksum],
    );
    ok(`${name}: ponto de entrada`, pe.entryPoint?.rva === r.entryPoint);
    ok(
      `${name}: recursos (tipo, nome, idioma, tamanho)`,
      same(
        pe.resources!.map((x) => [x.type, x.name, x.lang, x.size]),
        r.resources.map((x: Ref) => [
          typeof x.type === 'number' ? (RT[x.type] ?? `#${x.type}`) : x.type,
          String(x.name),
          x.lang,
          x.size,
        ]),
      ),
      pe.resources,
    );
    ok(`${name}: informações de versão`, same(pe.version ?? {}, r.version), pe.version);
    // A tabela da assinatura nao e overlay (o pefile a conta).
    const refOverlay =
      r.overlay && !(r.certTable && same(r.overlay, r.certTable)) ? r.overlay : null;
    ok(
      `${name}: overlay`,
      same(pe.overlay ? { offset: pe.overlay.offset, size: pe.overlay.size } : null, refOverlay),
      [pe.overlay, r.overlay],
    );
    if (r.rich) {
      ok(
        `${name}: entradas do Rich header`,
        same(
          pe.rich!.entries.map((e) => ({ compId: e.product * 65536 + e.build, count: e.count })),
          r.rich.entries,
        ),
      );
    }
    if (r.signature) {
      ok(
        `${name}: hash Authenticode confere como no osslsigncode`,
        pe.signature?.digestMatches === r.signature.digestMatches,
        [pe.signature, r.signature],
      );
    }
    if (r.dotnet) {
      const d = pe.dotnet!;
      ok(
        `${name}: .NET igual ao dnfile (runtime, assembly, módulo, referências, P/Invoke)`,
        d.runtime === r.dotnet.runtime &&
          same(d.assembly, r.dotnet.assembly) &&
          d.module === r.dotnet.module &&
          same(d.assemblyRefs, r.dotnet.assemblyRefs) &&
          same(d.pinvoke, r.dotnet.pinvoke),
        [d, r.dotnet],
      );
    }
  }

  // ------------------------------------------------------------ 2. o que cada achado quer dizer
  const alerts = (name: string, filename = name) =>
    (parsePe(file(name), filename)!.alerts ?? []).map((a) => `${a.level}:${a.text}`);
  const has = (list: string[], level: string, text: string) =>
    list.some((a) => a.startsWith(`${level}:`) && a.includes(text));

  const prog = parsePe(file('prog64.exe'), 'fatura.exe')!;
  ok(
    'ordinais do ws2_32 viram nome (socket, WSAStartup), como no imphash do pefile',
    same(prog.imports.find((i) => i.dll === 'ws2_32.dll')?.names, ['WSAStartup', 'socket']),
  );
  ok(
    'imports suspeitos',
    [
      'CreateRemoteThread',
      'InternetOpenA',
      'OpenProcess',
      'VirtualAllocEx',
      'WriteProcessMemory',
    ].every((f) => prog.suspiciousImports.includes(f)),
    prog.suspiciousImports,
  );
  const progAlerts = alerts('prog64.exe', 'fatura.exe');
  ok(
    'executável dentro do recurso RCDATA/101',
    has(progAlerts, 'high', 'RCDATA/101 contém outro executável'),
    progAlerts,
  );
  ok(
    'manifesto pede administrador',
    prog.manifest?.executionLevel === 'requireAdministrator' &&
      has(progAlerts, 'medium', 'administrador'),
  );
  ok(
    'diz ser da Microsoft sem assinatura',
    has(progAlerts, 'medium', 'Microsoft Corporation, mas não tem assinatura'),
  );
  ok('nome original diferente do enviado', has(progAlerts, 'info', 'svchost.exe'));
  ok(
    'nome original igual ao enviado não gera aviso',
    !alerts('prog64.exe', 'svchost.exe').some((a) => a.includes('nome original')),
  );
  ok('TLS do CRT do MinGW é só informação', has(progAlerts, 'info', 'TLS callback'));
  ok('seções com permissões', prog.sections[0].flags === 'R-X', prog.sections[0]);

  const dll = parsePe(file('teste.dll'), 'teste.dll')!;
  ok(
    'DLL: export encaminhado e export só por ordinal',
    dll.isDll &&
      dll.exports?.symbols.some((s) => s.name === 'Dormir' && s.forwarder === 'kernel32.Sleep') &&
      dll.exports.symbols.some((s) => s.ordinal === 7 && s.name === null),
    dll.exports,
  );

  for (const name of ['upx64.exe', 'upx32.exe', 'upx-dll.dll']) {
    const p = parsePe(file(name), name)!;
    ok(`${name}: UPX reconhecido`, p.packer === 'UPX' && p.sections[0].flags === 'RWX', p.packer);
  }
  const disguised = file('upx-disfarcado.exe');
  const dp = parsePe(disguised, 'x.exe')!;
  ok(
    'UPX com seções renomeadas e sem a marca UPX! é reconhecido pelo código de entrada',
    dp.packer === 'UPX' &&
      !dp.sections.some((s) => /upx/i.test(s.name)) &&
      !disguised.subarray(0, 0x1000).includes('UPX!'),
    { packer: dp.packer, sections: dp.sections.map((s) => s.name) },
  );
  const upxAlerts = alerts('upx64.exe');
  ok(
    'UPX: um alerta só para as seções W+X e sem o de poucas importações',
    upxAlerts.filter((a) => a.includes('gravá')).length === 1 &&
      !upxAlerts.some((a) => a.includes('funções importadas')),
    upxAlerts,
  );

  const rich = parsePe(file('rich.exe'), 'rich.exe')!;
  ok('Rich header íntegro', rich.rich?.checksumValid === true && rich.rich.entries.length === 5);
  const forged = parsePe(file('rich-forjado.exe'), 'x.exe')!;
  ok(
    'Rich header editado é apontado',
    forged.rich?.checksumValid === false &&
      has(alerts('rich-forjado.exe'), 'medium', 'Rich header não confere'),
  );
  ok('sem Rich header no MinGW', prog.rich === null);
  // Ferramenta e versao de cada entrada (plans/analise-estatica-ampliada, item 1): o build 30795
  // nao esta no richprint, entao vale a familia do produto.
  const richLinker = rich.rich!.entries.find((e) => e.product === 0x102)!;
  ok(
    'Rich header: ferramenta e versão do Visual Studio por entrada',
    richLinker.tool === 'LNK' &&
      richLinker.version === 'VS2015+ (14.0+) build 30795' &&
      rich.rich!.entries.find((e) => e.product === 0x105)?.tool === 'C++' &&
      rich.rich!.entries.find((e) => e.product === 1)?.tool === 'IMP' &&
      rich.rich!.linker === 'VS2015+ (14.0+) build 30795',
    rich.rich,
  );

  // Diretorio de debug (item 1): o CodeView que o ld grava, conferido contra o pefile.
  const pdbRef = REF['pdb.exe'].debug.find((e: Ref) => e.type === 2);
  const pdb = parsePe(file('pdb.exe'), 'pdb.exe')!;
  ok(
    'debug: caminho, GUID e age do PDB iguais aos do pefile',
    pdb.debug?.pdbFormat === 'RSDS' &&
      pdb.debug.pdbPath === pdbRef.path &&
      pdb.debug.pdbGuid === pdbRef.guid &&
      pdb.debug.pdbAge === pdbRef.age &&
      pdb.debug.pdbId ===
        `${pdbRef.guid.replace(/-/g, '')}${pdbRef.age.toString(16).toUpperCase()}`,
    { ours: pdb.debug, ref: pdbRef },
  );
  ok(
    'debug: usuário e projeto tirados do caminho',
    pdb.debug?.user === 'joao' && pdb.debug.project === 'Ladrao' && !pdb.debug.debugBuild,
    pdb.debug,
  );
  ok(
    'debug: datas coerentes não geram alerta',
    pdb.timestamps?.header === 1700000000 &&
      pdb.timestamps.debug === 1700000000 &&
      !alerts('pdb.exe').some((a) => a.includes('não bate')),
    pdb.timestamps,
  );
  ok(
    'debug: data do cabeçalho trocada é apontada (timestomping)',
    has(alerts('pdb-timestomp.exe'), 'medium', 'não bate com a do diretório de debug'),
    alerts('pdb-timestomp.exe'),
  );
  const repro = parsePe(file('pdb-repro.exe'), 'x.exe')!;
  ok(
    'debug: REPRO não tem data, e o "hash" no cabeçalho não vira data no futuro',
    repro.debug?.repro === true &&
      repro.compiledAt === null &&
      !alerts('pdb-repro.exe').some((a) => a.includes('futuro') || a.includes('não bate')),
    { debug: repro.debug, alerts: alerts('pdb-repro.exe') },
  );
  ok('sem diretório de debug no binário com strip', prog.debug === null, prog.debug);

  // Pivos novos (plans/analise-estatica-ampliada, item 2), contra as referencias de mercado.
  const signedPe = parsePe(file('assinado.exe'), 'x.exe')!;
  ok(
    'authentihash = o digest que o osslsigncode grava na assinatura',
    signedPe.authentihash === REF['assinado.exe'].signature.digest,
    { ours: signedPe.authentihash, ref: REF['assinado.exe'].signature },
  );
  ok(
    'authentihash não muda com a assinatura e muda com um byte do código',
    prog.authentihash === signedPe.authentihash &&
      parsePe(file('adulterado.exe'), 'x.exe')!.authentihash !== signedPe.authentihash,
  );
  ok(
    'exphash igual ao get_exphash do pefile',
    dll.exphash === REF['teste.dll'].exphash && prog.exphash === null,
    { ours: dll.exphash, ref: REF['teste.dll'].exphash },
  );
  const iconPe = parsePe(file('icone.exe'), 'x.exe')!;
  ok(
    'hash do ícone principal: a maior imagem do primeiro grupo (o PNG de 32x32)',
    /^[0-9a-f]{16}$/.test(iconPe.icon?.hash ?? '') &&
      iconPe.icon!.width === 32 &&
      prog.icon === null,
    iconPe.icon,
  );
  const elfInfo = analyzeBuffer(file('linux.elf'), 'true').elf!;
  ok(
    'telfhash igual ao do telfhash oficial (pyelftools + py-tlsh)',
    elfInfo.telfhash === REF['linux.elf'].telfhash,
    { ours: elfInfo.telfhash, ref: REF['linux.elf'].telfhash },
  );

  const overlay = parsePe(file('overlay.exe'), 'x.exe')!;
  ok(
    'overlay: ZIP anexado com tamanho e tipo',
    overlay.overlay?.size === 964 && overlay.overlay.type === 'Arquivo ZIP',
    overlay.overlay,
  );
  ok('checksum errado é só informação', has(alerts('checksum-errado.exe'), 'info', 'checksum'));
  ok(
    'checksum certo não gera aviso',
    !alerts('checksum-ok.exe').some((a) => a.includes('checksum')),
  );

  const signed = parsePe(file('assinado.exe'), 'x.exe')!.signature!;
  ok(
    'assinado: hash e assinatura conferem, com quem assinou e a cadeia',
    signed.digestMatches === true &&
      signed.signatureValid &&
      signed.digestAlgorithm === 'sha256' &&
      signed.signer?.subject === 'Fornecedor Teste Ltda' &&
      same(
        signed.chain.map((c) => c.subject),
        ['Fornecedor Teste Ltda', 'DeepLook Teste AC'],
      ) &&
      !signed.selfSigned,
    signed,
  );
  ok(
    'assinado: carimbo de tempo, nome e endereço do programa',
    signed.timestamp === '2026-01-01T00:00:00.000Z' &&
      signed.programName === 'Teste DeepLook' &&
      signed.programUrl === 'https://deeplook.test',
    signed,
  );
  ok('assinado: impressão digital SHA-1 em hexa', /^[0-9a-f]{40}$/.test(signed.signer?.sha1 ?? ''));
  ok(
    'assinado: sem alerta de assinatura',
    !alerts('assinado.exe').some((a) => a.includes('assinatura')),
  );
  const tampered = parsePe(file('adulterado.exe'), 'x.exe')!.signature!;
  ok(
    'adulterado: hash não confere (a assinatura em si continua íntegra)',
    tampered.digestMatches === false && tampered.signatureValid,
  );
  ok(
    'adulterado: alerta alto',
    has(alerts('adulterado.exe'), 'high', 'alterado depois de assinado'),
  );
  const self = parsePe(file('autoassinado.exe'), 'x.exe')!.signature!;
  ok(
    'autoassinado (ECDSA P-256): confere e é marcado como autoassinado',
    self.signatureValid && self.digestMatches === true && self.selfSigned,
    self,
  );
  ok('autoassinado: alerta', has(alerts('autoassinado.exe'), 'medium', 'autoassinado'));

  const net = parsePe(file('dotnet.exe'), 'x.exe')!;
  ok(
    '.NET: IL only, chamadas sensíveis e P/Invoke',
    same(net.dotnet?.flags, ['IL only']) &&
      net.dotnet?.suspicious.includes('Assembly.Load (carrega código da memória)') &&
      net.dotnet.suspicious.includes('Convert.FromBase64String'),
    net.dotnet,
  );
  const netAlerts = alerts('dotnet.exe');
  ok(
    '.NET: alertas de P/Invoke e Assembly.Load',
    has(netAlerts, 'medium', 'P/Invoke: VirtualAlloc, CreateThread, GetAsyncKeyState') &&
      has(netAlerts, 'medium', 'Assembly.Load'),
    netAlerts,
  );

  ok(
    'imphash só liga amostras com tabela própria (não .NET nem empacotado)',
    relationHashes(prog).imphash === prog.imphash &&
      relationHashes(net).imphash === null &&
      relationHashes(parsePe(file('upx64.exe'))).imphash === null,
  );
  ok('Rich hash liga amostras', relationHashes(rich).richHash === rich.rich!.hash);
  ok(
    'análise completa do arquivo inclui o PE novo',
    analyzeBuffer(file('assinado.exe'), 'x.exe').pe?.signature?.signer?.subject ===
      'Fornecedor Teste Ltda',
  );

  // ------------------------------------------------------------ 3. checksum
  const cases = [
    Buffer.alloc(4096),
    Buffer.alloc(4097, 0xff),
    Buffer.alloc(8 * 1024 * 1024 + 3, 0xff),
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]),
    Buffer.from([1, 2, 3]),
    ...Array.from({ length: 60 }, (_, i) => randomBytes(1 + ((i * 7919) % 20000))),
  ];
  let diverge = 0;
  for (const c of cases) {
    for (const off of [0x40, 0xd8, 0x101, c.length - 4]) {
      if (off >= 0 && peChecksum(c, off) !== checksumReference(c, off)) diverge++;
    }
  }
  ok(
    'checksum em blocos igual ao passo a passo do pefile (inclui soma múltipla de 2^32-1)',
    diverge === 0,
    diverge,
  );

  // ------------------------------------------------------------ 4. arquivos hostis
  const progBuf = file('prog64.exe');
  {
    // As 65535 entradas da raiz apontam para a propria raiz: sem os tetos, 65535^3 visitas.
    const l = layout(progBuf);
    const root = l.off(l.dir(2).rva);
    const b = Buffer.concat([progBuf, Buffer.alloc(65535 * 8 + 16)]);
    b.writeUInt16LE(0, root + 12);
    b.writeUInt16LE(0xffff, root + 14);
    for (let i = 0; i < 0xffff; i++) {
      b.writeUInt32LE(10 + (i % 1000), root + 16 + i * 8);
      b.writeUInt32LE(0x80000000, root + 20 + i * 8);
    }
    const { value, ms } = timed(() => parsePe(b, 'x.exe'));
    ok(`recursos em laço e 65535 entradas: ${ms} ms`, value !== null && ms < 1000, ms);
  }
  {
    const b = Buffer.from(file('teste.dll'));
    const l = layout(b);
    const ed = l.off(l.dir(0).rva);
    b.writeUInt32LE(0xffffffff, ed + 20);
    b.writeUInt32LE(0xffffffff, ed + 24);
    const { value, ms } = timed(() => parsePe(b, 'x.dll'));
    ok(
      `exports com 4 bilhões de funções e nomes: ${ms} ms`,
      value !== null && ms < 1000 && (value.exports?.symbols.length ?? 0) <= 300,
      ms,
    );
  }
  {
    const b = Buffer.from(progBuf);
    const l = layout(b);
    const tls = l.off(l.dir(9).rva);
    // Callbacks apontando para o codigo: nunca termina num ponteiro nulo.
    b.writeBigUInt64LE(l.imageBase + BigInt(l.sections[0].va), tls + 24);
    const { value, ms } = timed(() => parsePe(b, 'x.exe'));
    ok(
      `TLS sem fim de lista para em 64: ${ms} ms`,
      value?.tlsCallbacks === 64,
      value?.tlsCallbacks,
    );
  }
  {
    const base = file('assinado.exe');
    const l = layout(base);
    const big = Buffer.from(base);
    big.writeUInt32LE(0x7fffffff, l.dir(4).at + 4);
    const sigBig = parsePe(big, 'x.exe')?.signature;
    ok('tabela de assinatura gigante é recusada', Boolean(sigBig?.error), sigBig);
    const certAt = base.readUInt32LE(l.dir(4).at);
    const lie = Buffer.from(base);
    // Primeiro SEQUENCE do PKCS#7 dizendo ter 2 GB.
    lie[certAt + 8 + 1] = 0x84;
    lie.writeUInt32BE(0x7fffffff, certAt + 8 + 2);
    const sigLie = parsePe(lie, 'x.exe')?.signature;
    ok('DER com tamanho mentiroso vira erro, sem exceção', Boolean(sigLie?.error), sigLie);
    const noise = Buffer.from(base);
    randomBytes(base.length - certAt - 8).copy(noise, certAt + 8);
    const sigNoise = parsePe(noise, 'x.exe')?.signature;
    ok('assinatura de lixo vira erro, sem exceção', Boolean(sigNoise?.error), sigNoise);
  }
  {
    const b = Buffer.from(file('dotnet.exe'));
    const md = b.indexOf('BSJB');
    const tables = b.indexOf('#~\0', md);
    const offset = b.readUInt32LE(tables - 8);
    const t = md + offset;
    for (let o = t + 24; o < t + 24 + 4 * 20; o += 4) b.writeUInt32LE(0xffffffff, o);
    const { value, ms } = timed(() => parsePe(b, 'x.exe'));
    ok(
      `.NET com 4 bilhões de linhas por tabela: ${ms} ms`,
      value?.dotnet !== undefined && ms < 1000,
      ms,
    );
  }
  {
    // Fuzz: mutacoes e cortes deterministas dos executaveis reais.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
    let thrown = 0;
    let worst = 0;
    let runs = 0;
    for (const name of Object.keys(REF)) {
      const orig = file(name);
      for (let k = 0; k < 150; k++) {
        const b = Buffer.from(orig);
        if (k % 3 === 0) {
          for (let i = 0; i < 1 + rnd() * 20; i++)
            b[Math.floor(rnd() * Math.min(b.length, 4096))] = Math.floor(rnd() * 256);
        } else if (k % 3 === 1) {
          for (let i = 0; i < 1 + rnd() * 20; i++) {
            b.writeUInt32LE(Math.floor(rnd() * 2 ** 32), Math.floor(rnd() * (b.length - 4)) & ~3);
          }
        }
        const input = k % 3 === 2 ? b.subarray(0, Math.floor(rnd() * b.length)) : b;
        const t = Date.now();
        try {
          parsePe(input, name);
        } catch {
          thrown++;
        }
        worst = Math.max(worst, Date.now() - t);
        runs++;
      }
    }
    ok(`fuzz: ${runs} variações sem exceção (pior caso ${worst} ms)`, thrown === 0 && worst < 500, {
      thrown,
      worst,
    });
  }
  {
    const big = Buffer.concat([progBuf, randomBytes(120 * 1024 * 1024)]);
    const { value, ms } = timed(() => analyzeBuffer(big, 'x.exe'));
    ok(
      `PE de 120 MB (checksum, overlay e entropia): ${ms} ms`,
      value.pe?.overlay?.size === 120 * 1024 * 1024 && ms < 4000,
      ms,
    );
  }

  // ------------------------------------------------------------ 5. pela API
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  await ensureBucket();
  const app = await buildApp();
  await app.ready();
  await prisma.user.create({
    data: {
      email: 'ana@x.io',
      displayName: 'ana',
      role: 'ANALYST',
      passwordHash: await hashPassword('senha-123!'),
    },
  });
  const c = String(
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
      headers: { cookie: c, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    return r.json().entry.id;
  };
  const related = async (id: string) =>
    (
      await app.inject({ method: 'GET', url: `/api/entries/${id}/related`, headers: { cookie: c } })
    ).json().items as { entry: { id: string }; reasons: { kind: string; detail?: unknown }[] }[];
  const reasonsFor = (items: Awaited<ReturnType<typeof related>>, id: string) =>
    items.find((i) => i.entry.id === id)?.reasons.map((r) => r.kind) ?? [];

  const a = await upload('fatura.exe', progBuf);
  // O mingw ja grava o checksum certo: checksum-ok.exe e identico ao prog64.exe. O overlay muda o
  // arquivo e mantem as importacoes.
  const b = await upload('instalador.exe', file('overlay.exe'));
  const richA = await upload('rich.exe', file('rich.exe'));
  const richCopy = Buffer.from(file('rich.exe'));
  // Outro arquivo (byte do enchimento do fim), mesmo Rich header e mesmas importacoes.
  richCopy[richCopy.length - 1] ^= 0x01;
  const richB = await upload('rich2.exe', richCopy);
  const net1 = await upload('carregador.exe', file('dotnet.exe'));
  const netCopy = Buffer.from(file('dotnet.exe'));
  netCopy[netCopy.length - 1] ^= 0x01;
  const net2 = await upload('carregador2.exe', netCopy);

  const rowA = await prisma.entry.findUnique({ where: { id: a } });
  ok(
    'envio grava imphash na coluna e a análise nova na ficha',
    rowA?.imphash === REF['prog64.exe'].imphash &&
      rowA?.richHash === null &&
      (rowA.staticInfo as any)?.pe?.resources?.length === 4,
    { imphash: rowA?.imphash },
  );
  ok('Relacionadas: mesmo imphash', reasonsFor(await related(a), b).includes('SAME_IMPHASH'));
  const richRel = reasonsFor(await related(richA), richB);
  ok(
    'Relacionadas: mesmo Rich header e mesmo imphash',
    richRel.includes('SAME_RICH') && richRel.includes('SAME_IMPHASH'),
    richRel,
  );
  ok(
    'Relacionadas: .NET não se liga pelo imphash genérico (_CorExeMain)',
    !reasonsFor(await related(net1), net2).includes('SAME_IMPHASH') &&
      (await prisma.entry.findUnique({ where: { id: net2 } }))?.imphash === null,
  );

  // Amostra "antiga": PE sem os campos novos e sem as colunas.
  const oldShape = (info: any) => {
    const {
      machine,
      is64,
      isDll,
      subsystem,
      compiledAt,
      sections,
      imports,
      suspiciousImports,
      packer,
    } = info.pe;
    return {
      ...info,
      pe: {
        machine,
        is64,
        isDll,
        subsystem,
        compiledAt,
        sections: sections.map(({ flags: _f, ...s }: any) => s),
        imports: imports.map(({ names: _n, ...i }: any) => i),
        suspiciousImports,
        packer,
      },
    } as Prisma.InputJsonValue;
  };
  const makeOld = async (id: string) => {
    const row = await prisma.entry.findUnique({ where: { id } });
    await prisma.entry.update({
      where: { id },
      data: { staticInfo: oldShape(row!.staticInfo), imphash: null, richHash: null },
    });
  };
  await makeOld(b);
  const reanalyzed = await app.inject({
    method: 'POST',
    url: `/api/entries/${b}/static-analysis`,
    headers: { cookie: c },
    payload: {},
  });
  const rowB = await prisma.entry.findUnique({ where: { id: b } });
  ok(
    'reanálise devolve as colunas e a análise nova',
    reanalyzed.statusCode === 200 && rowB?.imphash === REF['overlay.exe'].imphash,
    reanalyzed.statusCode,
  );

  await makeOld(richA);
  await makeOld(a);
  await prisma.entry.update({ where: { id: a }, data: { filePurgedAt: new Date() } });
  const log = { info: () => undefined, error: () => undefined };
  const first = await backfillPeAnalysis(log);
  const rowRich = await prisma.entry.findUnique({ where: { id: richA } });
  const rowPurged = await prisma.entry.findUnique({ where: { id: a } });
  ok(
    'executáveis antigos: reanalisados em segundo plano, com as colunas',
    first === 2 &&
      rowRich?.richHash === REF['rich.exe'].richHash &&
      rowRich?.imphash === REF['rich.exe'].imphash &&
      (rowRich?.staticInfo as any)?.pe?.rich?.checksumValid === true,
    { first, richHash: rowRich?.richHash },
  );
  ok(
    'expurgado ganha só a marca e não volta para a fila',
    (rowPurged?.staticInfo as any)?.pe &&
      'imphash' in (rowPurged!.staticInfo as any).pe &&
      (rowPurged!.staticInfo as any).pe.imphash === null &&
      (await backfillPeAnalysis(log)) === 0,
  );

  // Pivos do PDB (plans/analise-estatica-ampliada, item 1): o pdb.exe e o pdb-timestomp.exe sao a
  // mesma compilacao (so a data do cabecalho mudou) e ligam pelo caminho e pelo GUID do PDB.
  const pdbA = await upload('pdb.exe', file('pdb.exe'));
  const pdbB = await upload('outro.exe', file('pdb-timestomp.exe'));
  const pivotsA = await prisma.entryPivot.findMany({
    where: { entryId: pdbA, kind: { startsWith: 'PDB_' } },
    orderBy: { kind: 'asc' },
  });
  ok(
    'envio grava os pivôs do PDB (caminho normalizado e GUID + age)',
    pivotsA.length === 2 &&
      pivotsA[0].kind === 'PDB_ID' &&
      pivotsA[0].value === parsePe(file('pdb.exe'))!.debug!.pdbId &&
      pivotsA[1].kind === 'PDB_PATH' &&
      pivotsA[1].value.endsWith('\\users\\joao\\source\\repos\\ladrao\\obj\\release\\ladrao.pdb') &&
      pivotsA.every((p) => p.source === 'static'),
    pivotsA,
  );
  // O mesmo programa assinado e sem assinatura: o authentihash liga os dois.
  const signedId = await upload('assinado.exe', file('assinado.exe'));
  const signedRel = (await related(signedId)).find((i) => i.entry.id === a);
  ok(
    'Relacionadas: mesmo código (authentihash) entre o assinado e o original',
    (signedRel?.reasons ?? []).some(
      (r) => r.kind === 'SAME_PIVOT' && (r.detail as { pivot: string }).pivot === 'AUTHENTIHASH',
    ),
    signedRel?.reasons,
  );
  // O mesmo icone em outro executavel (o icone.exe com outro byte no fim): icone parecido, 0 bits.
  const iconA = await upload('icone.exe', file('icone.exe'));
  const iconCopy = Buffer.from(file('icone.exe'));
  iconCopy[iconCopy.length - 1] ^= 0x01;
  const iconB = await upload('icone2.exe', iconCopy);
  const iconRel = (await related(iconA)).find((i) => i.entry.id === iconB);
  ok(
    'Relacionadas: ícone parecido (distância 0)',
    (iconRel?.reasons ?? []).some(
      (r) =>
        r.kind === 'SAME_PIVOT' &&
        (r.detail as { pivot: string; distance?: number }).pivot === 'ICON_DHASH' &&
        (r.detail as { distance?: number }).distance === 0,
    ),
    iconRel?.reasons,
  );
  // Item 2: o admin marca o icone como "de documento"; as copias ja na base e as novas ganham o
  // alerta de isca, e tirar da lista tira o alerta.
  await prisma.user.create({
    data: {
      email: 'adm@x.io',
      displayName: 'adm',
      role: 'ADMIN',
      passwordHash: await hashPassword('senha-123!'),
    },
  });
  const adm = String(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'adm@x.io', password: 'senha-123!' },
      })
    ).headers['set-cookie'],
  ).split(';')[0];
  const lure = (id: string) =>
    prisma.entry
      .findUnique({ where: { id }, select: { staticInfo: true } })
      .then((e) =>
        ((e?.staticInfo as any)?.pe?.alerts ?? []).some((x: { text: string }) =>
          x.text.startsWith('Ícone de documento (Fatura falsa)'),
        ),
      );
  const byAnalyst = await app.inject({
    method: 'POST',
    url: '/api/document-icons',
    headers: { cookie: c },
    payload: { entryId: iconA, label: 'Fatura falsa' },
  });
  const marked = await app.inject({
    method: 'POST',
    url: '/api/document-icons',
    headers: { cookie: adm },
    payload: { entryId: iconA, label: 'Fatura falsa' },
  });
  const fresh = await upload('icone3.exe', Buffer.concat([file('icone.exe'), Buffer.from([1, 2])]));
  ok(
    'ícone de documento: só o admin marca; as fichas que já estavam e as novas ganham o alerta',
    byAnalyst.statusCode === 403 &&
      marked.statusCode === 201 &&
      marked.json().changed >= 2 &&
      (await lure(iconA)) &&
      (await lure(iconB)) &&
      (await lure(fresh)),
    { analyst: byAnalyst.statusCode, marked: marked.json() },
  );
  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/document-icons/${marked.json().hash}`,
    headers: { cookie: adm },
  });
  ok(
    'ícone de documento: removido da lista, o alerta sai das fichas',
    removed.statusCode === 200 && !(await lure(iconA)) && !(await lure(fresh)),
    removed.json(),
  );

  const pdbRel = (await related(pdbA)).find((i) => i.entry.id === pdbB);
  const pivotKinds = (pdbRel?.reasons ?? [])
    .filter((r) => r.kind === 'SAME_PIVOT')
    .map((r) => (r.detail as { pivot: string }).pivot)
    .sort();
  ok('Relacionadas: mesmo PDB (caminho e compilação)', same(pivotKinds, ['PDB_ID', 'PDB_PATH']), {
    pdbRel,
  });
  const graph = await app.inject({
    method: 'GET',
    url: `/api/entries/${pdbA}/graph`,
    headers: { cookie: c },
  });
  ok(
    'mapa: ligação pelo PDB',
    graph.statusCode === 200 && graph.body.includes('mesma compilação (GUID do PDB)'),
    graph.body.slice(0, 300),
  );
  // Analise antiga: o backfill refaz e regrava os pivos; a reanalise manual tambem.
  await makeOld(pdbB);
  await prisma.entryPivot.deleteMany({ where: { entryId: pdbB } });
  await backfillPeAnalysis(log);
  const rowPdbB = await prisma.entry.findUnique({ where: { id: pdbB } });
  ok(
    'backfill: análise da versão anterior ganha o debug, a revisão e os pivôs',
    (rowPdbB?.staticInfo as any)?.pe?.rev === PE_REVISION &&
      (rowPdbB?.staticInfo as any)?.pe?.debug?.pdbPath &&
      (await prisma.entryPivot.count({ where: { entryId: pdbB } })) === 3,
  );
  await prisma.entryPivot.deleteMany({ where: { entryId: pdbB } });
  await app.inject({
    method: 'POST',
    url: `/api/entries/${pdbB}/static-analysis`,
    headers: { cookie: c },
    payload: {},
  });
  ok(
    'reanálise manual regrava os pivôs',
    (await prisma.entryPivot.count({ where: { entryId: pdbB } })) === 3,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
