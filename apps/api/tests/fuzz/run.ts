// Fuzzing dos parsers (revisao de novembro, item 2.2).
//
//   npm run test:fuzz                              rodada curta (a do CI): 300 casos por alvo
//   npm run test:fuzz -- --iterations 20000        rodada longa
//   npm run test:fuzz -- --target zip --seed 7     um alvo so, com outra semente
//   npm run test:fuzz -- --replay                  so repassa o corpus de regressao
//
// Mutacao a partir de sementes: os executaveis e imagens de disco que os testes de integracao
// geram em tests/.tmp (se existirem) e sementes minimas montadas aqui. O gerador e deterministico:
// a mesma semente refaz a mesma rodada. Tres invariantes por caso: so erro esperado, tempo dentro
// do teto e resultado de tamanho razoavel. O que quebrar e gravado em tests/fuzz/crashes/ (fora do
// git) com o comando para repetir; corrigido o defeito, o arquivo vai para tests/fuzz/corpus/, que
// e repassado a cada rodada.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { crc32, deflateRawSync } from 'node:zlib';

import { TARGETS } from './targets';

const HERE = __dirname;
const TMP = join(HERE, '..', '.tmp');
const CORPUS = join(HERE, 'corpus');
const CRASHES = join(HERE, 'crashes');
/** Teto por caso. O mais lento dos parsers leva dezenas de ms nas sementes; isto e folga de sobra. */
const TIMEOUT_MS = Number(process.env.FUZZ_TIMEOUT_MS || 15_000);
/** Sementes maiores sao cortadas: o que se procura esta nos cabecalhos e nas tabelas. */
const MAX_SEED = 512 * 1024;

const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const ITERATIONS = Number(arg('iterations', '300'));
const SEED = Number(arg('seed', '1'));
const ONLY = arg('target', '');
const REPLAY = process.argv.includes('--replay');

/** mulberry32: pequeno, rapido e reprodutivel. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const le32 = (...values: number[]) => {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeUInt32LE(v >>> 0, i * 4));
  return buf;
};

/** ZIP valido (com ou sem deflate), montado aqui para nao depender de ferramenta externa. */
function makeZip(files: [name: string, data: Buffer, deflate: boolean][]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data, deflate] of files) {
    const body = deflate ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(deflate ? 8 : 0, 8);
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
  const cdBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cdBytes, end]);
}

/** Sementes minimas: bastam para cada parser passar da assinatura e entrar nas tabelas. */
function syntheticSeeds(): Record<string, Buffer[]> {
  const pe = Buffer.alloc(1024);
  pe.write('MZ');
  pe.writeUInt32LE(0x80, 0x3c);
  pe.write('PE\0\0', 0x80, 'latin1');
  pe.writeUInt16LE(0x14c, 0x84); // i386
  pe.writeUInt16LE(1, 0x86); // uma secao
  pe.writeUInt16LE(0xe0, 0x94); // cabecalho opcional
  pe.writeUInt16LE(0x10b, 0x98); // PE32
  pe.writeUInt32LE(16, 0x98 + 92); // diretorios
  pe.write('.text', 0x98 + 0xe0, 'latin1');
  const elf = Buffer.alloc(512);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(elf);
  elf.writeUInt16LE(2, 16);
  elf.writeUInt16LE(0x3e, 18);
  elf.writeUInt16LE(64, 52);
  elf.writeUInt16LE(56, 54);
  elf.writeUInt16LE(64, 58);
  const lnk = Buffer.alloc(256);
  le32(0x4c, 0x00021401, 0, 0xc0, 0x46000000).copy(lnk);
  lnk.writeUInt32LE(0xff, 0x14);
  const ole = Buffer.alloc(1536);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(ole);
  ole.writeUInt16LE(0x3e, 24);
  ole.writeUInt16LE(3, 26);
  ole.writeUInt16LE(0xfffe, 28);
  ole.writeUInt16LE(9, 30);
  ole.writeUInt16LE(6, 32);
  ole.writeUInt32LE(1, 44);
  const pdf = Buffer.from(
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\n' +
      '2 0 obj\n<< /Length 12 /Filter /FlateDecode >>\nstream\nx\x9c+I-.\x01\x00\x04]\x01\xc1\nendstream\nendobj\n' +
      '3 0 obj\n<< /S /URI /URI (http://exemplo.top/a) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    'latin1',
  );
  const rtf = Buffer.from(
    '{\\rtf1\\ansi{\\object\\objemb{\\*\\objdata 0105000002000000}}{\\field{\\*\\fldinst HYPERLINK "http://exemplo.top"}}}',
  );
  const script = Buffer.from(
    'powershell -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkA\n' +
      "var a = eval(atob('YWxlcnQoMSk=')); WScript.Shell; http://exemplo.top/x.exe\n",
  );
  const zip = makeZip([
    ['a.txt', Buffer.from('hello'), false],
    ['pasta/b.bin', Buffer.alloc(4096, 0x41), true],
    ['c.js', Buffer.from('eval(atob("YWxlcnQoMSk="))'), true],
  ]);
  const eml = Buffer.from(
    'From: "Banco" <aviso@exemplo.top>\r\nTo: vitima@empresa.com\r\nSubject: =?UTF-8?B?QXZpc28=?=\r\n' +
      'Received: from mail.exemplo.top (mail.exemplo.top [203.0.113.9]) by mx.empresa.com; Mon, 1 Jan 2026 00:00:00 +0000\r\n' +
      'Authentication-Results: mx.empresa.com; spf=fail; dkim=none; dmarc=fail\r\n' +
      'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n' +
      '--b1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<a href="http://exemplo.top/login">clique</a>\r\n' +
      '--b1\r\nContent-Type: application/octet-stream; name="fatura.exe"\r\nContent-Transfer-Encoding: base64\r\n' +
      'Content-Disposition: attachment; filename="fatura.exe"\r\n\r\nTVqQAAMAAAAEAAAA\r\n--b1--\r\n',
  );
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex'),
    Buffer.from('0000000a49444154789c6300010000050001', 'hex'),
    Buffer.from('0d0a2db4', 'hex'),
    Buffer.from('0000000049454e44ae426082', 'hex'),
  ]);
  const jpeg = Buffer.concat([
    Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'),
    Buffer.from('ffe1000a4578696600004d4d', 'hex'),
    Buffer.from('ffc0000b080001000101011100', 'hex'),
    Buffer.from('ffda0008010100003f00d2cf20ffd9', 'hex'),
  ]);
  const webp = Buffer.concat([
    Buffer.from('RIFF'),
    le32(26),
    Buffer.from('WEBPVP8 '),
    le32(14),
    Buffer.from('3001009d012a0100010002003425', 'hex'),
  ]);
  const csv = Buffer.from(
    'tipo;valor\ndominio;exemplo.top\nip;203.0.113.9\nhxxp://exemplo[.]top/a\nsha256;' +
      'ab'.repeat(32) +
      '\n2001:db8::1\n',
  );
  const stix = Buffer.from(
    JSON.stringify({
      type: 'bundle',
      id: 'bundle--1',
      objects: [
        {
          type: 'indicator',
          id: 'indicator--1',
          pattern: "[domain-name:value = 'exemplo.top']",
          pattern_type: 'stix',
        },
        {
          type: 'indicator',
          id: 'indicator--2',
          pattern: "[ipv4-addr:value = '203.0.113.9'] OR [url:value = 'http://exemplo.top/a']",
        },
      ],
    }),
  );
  const iso = Buffer.alloc(40 * 2048);
  iso.writeUInt8(1, 16 * 2048);
  iso.write('CD001', 16 * 2048 + 1, 'latin1');
  iso.writeUInt8(1, 16 * 2048 + 6);
  iso.writeUInt8(255, 17 * 2048);
  iso.write('CD001', 17 * 2048 + 1, 'latin1');
  return {
    static: [pe, elf, lnk, ole, pdf, rtf, script, zip, iso],
    zip: [zip],
    disk: [iso],
    eml: [eml],
    // Formatos de entrega (plans/caca-e-formatos, item 4): o OLE (o leitor de MSI), um OneNote e
    // uma pagina com Base64 e lista de bytes.
    delivery: [
      ole,
      Buffer.concat([
        Buffer.from('e4525c7b8cd8a74daeb15378d02996d3', 'hex'),
        Buffer.from('e716e3bd65261145a4c48d4d0b7a9eac', 'hex'),
        Buffer.from([16, 0, 0, 0, 0, 0, 0, 0]),
        Buffer.alloc(12),
        Buffer.from('MZ' + 'A'.repeat(14)),
      ]),
      Buffer.from(
        `<html><script>atob("${Buffer.alloc(1100, 77).toString('base64')}"); new Blob([1]);` +
          `[${Array.from({ length: 300 }, (_, i) => i % 256).join(',')}]</script></html>`,
      ),
    ],
    // Desofuscacao (plans/novas-analises, item 5): um trecho de cada sabor.
    deobfuscate: [
      script,
      Buffer.from(
        "$a='Do'+'wn'; I`E`X (\"{1}{0}\" -f 'load',$a); [char[]](72,105) -join ''; 'gnirtS'[-1..-6]",
      ),
      Buffer.from('@echo off\r\nset a=pow\r\n%a%er^s^hell %COMSPEC:~-7,3% %a:o=0%\r\n'),
      Buffer.from('x = StrReverse("abc") & Chr(65) & Replace("aXb","X","y")'),
      Buffer.from("var s='\\x41'+'b'.split('').reverse().join('')+'c'.replace(/c/g,'d')"),
    ],
    image: [png, jpeg, webp],
    iocs: [csv, stix],
    // O TLSH pede 512 bytes e alguma variacao: as sementes pequenas, repetidas com um contador.
    tlsh: [pdf, script].map((seed) =>
      Buffer.concat(
        Array.from({ length: 16 }, (_, i) => Buffer.concat([seed, Buffer.from(String(i * 7919))])),
      ),
    ),
  };
}

/** Arquivos que os testes de integracao geram (tests/.tmp), se ja rodaram nesta maquina. */
function generatedSeeds(): Record<string, Buffer[]> {
  const read = (dir: string, keep: (name: string) => boolean) => {
    const folder = join(TMP, dir);
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter((name) => keep(name) && statSync(join(folder, name)).isFile())
      .sort()
      .map((name) => readFileSync(join(folder, name)).subarray(0, MAX_SEED));
  };
  const pe = read('pe', (n) => /\.(exe|dll|elf|bin)$/.test(n));
  const disk = read('disk', (n) => /\.(iso|img|vhd|raw|lnk)$/.test(n));
  return { static: [...pe, ...disk], disk, tlsh: pe.slice(0, 3) };
}

const INTERESTING = [
  0, 1, 0x7f, 0x80, 0xff, 0xffff, 0x7fffffff, 0x80000000, 0xffffffff, 0xfffffffe,
];

function mutate(seeds: Buffer[], random: () => number): Buffer {
  const pick = (n: number) => Math.floor(random() * n);
  let buf: Buffer = Buffer.from(seeds[pick(seeds.length)]);
  const rounds = 1 + pick(6);
  for (let r = 0; r < rounds && buf.length; r++) {
    const at = pick(buf.length);
    switch (pick(9)) {
      case 0: // um bit
        buf[at] ^= 1 << pick(8);
        break;
      case 1: // um byte "interessante"
        buf[at] = INTERESTING[pick(5)];
        break;
      case 2: // campo de 16 bits
        if (at + 2 <= buf.length) buf.writeUInt16LE(INTERESTING[pick(6)] & 0xffff, at);
        break;
      case 3: {
        // campo de 32 bits: valores de borda ou o tamanho do arquivo (deslocamentos e contagens)
        if (at + 4 > buf.length) break;
        const near = [buf.length - 1, buf.length, buf.length + 1, buf.length * 2];
        const value =
          random() < 0.5 ? INTERESTING[pick(INTERESTING.length)] : near[pick(near.length)];
        if (random() < 0.5) buf.writeUInt32LE(value >>> 0, at);
        else buf.writeUInt32BE(value >>> 0, at);
        break;
      }
      case 4: // corta
        buf = buf.subarray(0, at);
        break;
      case 5: {
        // repete um trecho (tabelas mais longas, aninhamento)
        const length = 1 + pick(Math.min(4096, buf.length - at));
        const times = 1 + pick(8);
        buf = Buffer.concat([
          buf.subarray(0, at),
          ...Array(times).fill(buf.subarray(at, at + length)),
          buf.subarray(at),
        ]);
        break;
      }
      case 6: {
        // enxerta um trecho de outra semente
        const other = seeds[pick(seeds.length)];
        const from = pick(other.length || 1);
        const piece = other.subarray(from, from + 1 + pick(2048));
        buf = Buffer.concat([buf.subarray(0, at), piece, buf.subarray(at)]);
        break;
      }
      case 7: {
        // bytes aleatorios por cima
        const length = 1 + pick(Math.min(64, buf.length - at));
        for (let i = 0; i < length; i++) buf[at + i] = pick(256);
        break;
      }
      default: // remove um trecho
        buf = Buffer.concat([buf.subarray(0, at), buf.subarray(at + 1 + pick(256))]);
    }
    if (buf.length > 2 * MAX_SEED) buf = buf.subarray(0, 2 * MAX_SEED);
  }
  return buf;
}

type Outcome = { finding?: string; stack?: string };

class Runner {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending: { id: number; resolve: (o: Outcome) => void } | null = null;

  private start(): Worker {
    const worker = new Worker(join(HERE, `worker${__filename.slice(-3)}`), {
      resourceLimits: { maxOldGenerationSizeMb: 1024 },
    });
    worker.on('message', (m: Outcome & { id: number }) => {
      if (this.pending?.id === m.id) this.settle({ finding: m.finding, stack: m.stack });
    });
    worker.on('error', (err) => {
      this.worker = null;
      this.settle({ finding: `a thread caiu: ${(err as Error).message}` });
    });
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = null;
      this.settle({ finding: 'a thread terminou (memória?)' });
    });
    return worker;
  }

  private settle(outcome: Outcome) {
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(outcome);
  }

  run(target: string, input: Buffer): Promise<Outcome> {
    return new Promise((resolve) => {
      const id = ++this.nextId;
      this.worker ??= this.start();
      const current = this.worker;
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.worker = null;
        void current.terminate();
        this.settle({ finding: `passou de ${TIMEOUT_MS} ms` });
      }, TIMEOUT_MS);
      this.pending = {
        id,
        resolve: (outcome) => {
          clearTimeout(timer);
          resolve(outcome);
        },
      };
      const content = new Uint8Array(input);
      current.postMessage({ id, target, content }, [content.buffer]);
    });
  }

  async close() {
    const worker = this.worker;
    this.worker = null;
    await worker?.terminate();
  }
}

async function main() {
  const synthetic = syntheticSeeds();
  const generated = generatedSeeds();
  const names = Object.keys(TARGETS).filter((name) => !ONLY || name === ONLY);
  if (!names.length) throw new Error(`alvo desconhecido: ${ONLY}`);
  const runner = new Runner();
  let findings = 0;
  const report = (target: string, input: Buffer, outcome: Outcome, origin: string) => {
    findings += 1;
    mkdirSync(CRASHES, { recursive: true });
    const name = `${target}-${createHash('sha256').update(input).digest('hex').slice(0, 16)}.bin`;
    writeFileSync(join(CRASHES, name), input);
    console.log(`FALHA ${target} (${origin}): ${outcome.finding}`);
    if (outcome.stack) console.log(outcome.stack.split('\n').slice(0, 6).join('\n'));
    console.log(`      entrada (${input.length} bytes) em tests/fuzz/crashes/${name}`);
  };

  // 1. Corpus de regressao: entradas que ja quebraram alguma coisa; nome = alvo-hash.bin.
  const corpus = existsSync(CORPUS)
    ? readdirSync(CORPUS)
        .filter((f) => f.endsWith('.bin'))
        .sort()
    : [];
  let replayed = 0;
  for (const file of corpus) {
    const target = file.split('-')[0];
    if (!names.includes(target)) continue;
    const input = readFileSync(join(CORPUS, file));
    const outcome = await runner.run(target, input);
    replayed += 1;
    if (outcome.finding) report(target, input, outcome, `corpus ${file}`);
  }
  console.log(`corpus de regressão: ${replayed} entrada(s)`);

  // 2. Mutacao.
  if (!REPLAY) {
    for (const target of names) {
      const seeds = [...(synthetic[target] ?? []), ...(generated[target] ?? [])];
      const random = rng(SEED * 1000 + names.indexOf(target));
      const started = Date.now();
      let bad = 0;
      // As proprias sementes primeiro: um alvo que falha na semente esta mal montado.
      for (const [i, seed] of seeds.entries()) {
        const outcome = await runner.run(target, seed);
        if (outcome.finding) {
          bad += 1;
          report(target, seed, outcome, `semente ${i}`);
        }
      }
      for (let i = 0; i < ITERATIONS; i++) {
        const input = mutate(seeds, random);
        const outcome = await runner.run(target, input);
        if (!outcome.finding) continue;
        bad += 1;
        report(target, input, outcome, `--seed ${SEED} --target ${target}, caso ${i}`);
        // Um defeito costuma repetir em centenas de casos: os primeiros bastam.
        if (bad >= 5) {
          console.log(`      ${target}: interrompido depois de ${bad} achados`);
          break;
        }
      }
      console.log(
        `${bad ? 'FALHA' : 'ok   '} ${target}: ${ITERATIONS} caso(s), ${seeds.length} semente(s), ` +
          `${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
    }
  }
  await runner.close();
  console.log(findings ? `\n${findings} achado(s)` : '\nfuzzing: tudo ok');
  process.exit(findings ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
