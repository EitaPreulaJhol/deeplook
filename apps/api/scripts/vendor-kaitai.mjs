// Gera os leitores do Kaitai Struct (plans/analise-estatica-ampliada, item 27) em apps/api/kaitai:
// PE, ELF, ZIP e LNK (com as dependencias), dos .ksy do kaitai_struct_formats (CC0-1.0) num commit
// fixo, pelo kaitai-struct-compiler 0.11 (conferido pelo SHA-256), com --read-pos: cada campo
// guarda onde comeca e onde termina, para o hex mostrar a estrutura.
//
//   node scripts/vendor-kaitai.mjs        (precisa do Docker)
/* global console, process */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(API, 'kaitai');
const KSC =
  'https://github.com/kaitai-io/kaitai_struct_compiler/releases/download/0.11/kaitai-struct-compiler-0.11.zip';
const KSC_SHA256 = 'ff89389d9dc9e770d78a24af328763cb1f8e7b31ce7766c9edf10669a060f2a2';
const FORMATS_COMMIT = '8d8353c5059e6cff0d9500313d6650000aab92c2';
const KSY = [
  'executable/microsoft_pe.ksy',
  'executable/elf.ksy',
  'archive/zip.ksy',
  'windows/windows_lnk_file.ksy',
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const script = [
  'set -e',
  'apt-get update -qq >/dev/null && apt-get install -y -qq git unzip curl >/dev/null',
  `cd /tmp && curl -sSLf -o ksc.zip ${KSC}`,
  `echo "${KSC_SHA256}  ksc.zip" | sha256sum -c --quiet`,
  'unzip -q ksc.zip',
  'git clone -q --filter=blob:none https://github.com/kaitai-io/kaitai_struct_formats.git f',
  `cd f && git checkout -q ${FORMATS_COMMIT}`,
  `/tmp/kaitai-struct-compiler-0.11/bin/kaitai-struct-compiler -t javascript --read-pos --no-auto-read -I /tmp/f --outdir /out ${KSY.join(' ')}`,
  `chown -R ${process.getuid()}:${process.getgid()} /out`,
].join(' && ');
execFileSync(
  'docker',
  ['run', '--rm', '-v', `${OUT}:/out`, 'eclipse-temurin:21-jre', 'sh', '-c', script],
  {
    stdio: ['ignore', 'ignore', 'inherit'],
  },
);
writeFileSync(
  join(OUT, 'README.md'),
  [
    '# Leitores do Kaitai Struct',
    '',
    'Gerados por `scripts/vendor-kaitai.mjs` (não edite à mão): kaitai-struct-compiler 0.11 com',
    `\`--read-pos --no-auto-read\`, a partir do [kaitai_struct_formats](https://github.com/kaitai-io/kaitai_struct_formats) no commit \`${FORMATS_COMMIT}\`.`,
    'Os `.ksy` de origem são CC0-1.0; o runtime (`kaitai-struct`, npm) é Apache-2.0.',
    '',
    ...readdirSync(OUT)
      .filter((f) => f.endsWith('.js'))
      .sort()
      .map((f) => `- ${f}`),
    '',
  ].join('\n'),
);
console.log(
  `kaitai: ${readdirSync(OUT).filter((f) => f.endsWith('.js')).length} leitores em kaitai/`,
);
