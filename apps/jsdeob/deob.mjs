// Desofusca um JavaScript (ou os scripts embutidos de um HTML/HTA) com o webcrack 2.16 (MIT;
// plans/analise-estatica-ampliada, item 20): string arrays do obfuscator.io, control-flow
// flattening, eval desembrulhado, minificacao e bundles do webpack e do browserify.
//
//   node --no-node-snapshot deob.mjs <arquivo>
//
// Escreve um JSON no stdout. Os decodificadores de strings rodam num isolate do V8 (isolated-vm),
// com memoria e tempo limitados pelo proprio webcrack: o codigo da amostra nunca roda no Node.
import { readFileSync } from 'node:fs';

import { webcrack } from 'webcrack';

const MAX_CODE = 2 * 1024 * 1024;
const MAX_MODULES = 300;

const raw = readFileSync(process.argv[2]);
let text = raw.toString('utf8').replace(/^﻿/, '');
let scripts = 0;
// HTML ou HTA: os scripts embutidos (sem src), um depois do outro.
if (/^\s*<|<script[\s>]/i.test(text.slice(0, 4096))) {
  const blocks = [...text.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].replace(/^\s*<!--|-->\s*$/g, ''))
    .filter((b) => b.trim());
  scripts = blocks.length;
  if (!scripts) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'o HTML não tem script embutido' }));
    process.exit(0);
  }
  text = blocks.join('\n;\n');
}

const squash = (s) => s.replace(/\s+/g, '');
let result;
try {
  result = await webcrack(text, { jsx: false, unpack: true, deobfuscate: true, unminify: true });
} catch (err) {
  const msg = String(err?.message ?? err).split('\n')[0].slice(0, 200);
  process.stdout.write(JSON.stringify({ ok: false, error: `o webcrack não leu o código: ${msg}` }));
  process.exit(0);
}

let bundle = null;
if (result.bundle) {
  const modules = [...result.bundle.modules.values()].slice(0, MAX_MODULES).map((m) => ({
    id: String(m.id).slice(0, 100),
    path: String(m.path ?? '').slice(0, 300),
    size: String(m.code ?? '').length,
  }));
  bundle = {
    type: result.bundle.type,
    entryId: String(result.bundle.entryId ?? '').slice(0, 100),
    modules,
    moduleCount: result.bundle.modules.size,
  };
}
const code = result.code;
process.stdout.write(
  JSON.stringify({
    ok: true,
    code: code.slice(0, MAX_CODE),
    truncated: code.length > MAX_CODE,
    changed: squash(code) !== squash(text),
    inputChars: text.length,
    scripts,
    bundle,
  }),
);
