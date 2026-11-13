import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { DATA_EN } from '../../src/lib/data-en';
import { HISTORY_EN } from '../../src/lib/history-en';
import { localizeAlerts, localizeStaticInfo, localizeText } from '../../src/lib/data-language';
import { MESSAGES_EN } from '../../src/lib/messages-en';
import { scanTexts } from './source-texts';

/**
 * Textos das analises em ingles (plano pos-revisao, item 1.4, parte 2). Le os modulos que gravam
 * alertas, motivos e rotulos e reprova frase sem par em DATA_EN: o que tem cara de portugues e,
 * como o detector deixa passar frase sem acento nem preposicao ("nome forte"), tambem todo texto
 * com espaco ou acento que pareca frase. E o contrario: par que o codigo nao usa mais.
 */

const ROOT = join(__dirname, '..', '..');
const FILES = [
  'pe-analysis',
  'pe-dotnet',
  'pe-authenticode',
  'elf-analysis',
  'lnk-analysis',
  'disk-image',
  'doc-analysis',
  'oletools',
  'unpack',
  'capa',
  'ghidra',
  'script-analysis',
  'file-type',
  'reputation',
  'yara-update',
  'ioc-import',
].map((name) => `src/lib/${name}.ts`);

/** Iguais nos dois idiomas: nomes tecnicos, de APIs e de ferramentas. */
const SAME = new Set([
  'HTTP {0}',
  '{0} (commit {1})',
  // Extensao .com (o detector a toma pela preposicao).
  'com',
  'ARM Thumb-2',
  'Windows CE',
  'IL only',
  'WMI (ManagementObjectSearcher)',
  'Crypto Obfuscator',
  'PowerPC 64',
  'SPARC v9',
  'core dump',
  'NO NAME',
  'NTFS    ',
  'Kill ',
  'Lib "kernel32"',
  'Invoke-Expression (IEX)',
  'BITS (bitsadmin)',
  'certutil -urlcache/-decode',
  'powershell -EncodedCommand',
  'PowerShell -EncodedCommand',
  'attrib +h',
  'Chr() & Chr() ...',
  'Chr() & Chr()',
  'Base64 + {0}',
  'atob (Base64)',
  'unescape (%xx)',
]);

/** Titulo e descricao da amostra filha do unpack: as pessoas editam, ficam como foram gravados. */
const USER_TEXT = new Set(['{0} (desempacotado)', 'Extraído de "{0}" pelo desempacotador {1}{2}.']);

const phrase = (text: string) =>
  /^[A-Za-zÀ-ú0-9{(][^\\^$|[\]]*$/.test(text) &&
  (/\s/.test(text) || /[à-ú]/i.test(text) || /\.\.\.$/.test(text));
const found = FILES.flatMap((file) =>
  scanTexts(
    join(ROOT, file),
    // URLs ficam de fora (o ".com" engana o detector de portugues).
    (_node, item) => !/^https?:/.test(item.text) && (item.portuguese || phrase(item.text)),
    {
      nested: true,
    },
  ).map((f) => ({ ...f, file })),
);
// O historico (eventos da atualizacao do YARA) tem o dicionario dele, que o tradutor tambem usa.
const known = new Set([...DATA_EN, ...HISTORY_EN, ...MESSAGES_EN].map(([pt]) => pt));

test('todo texto das análises tem tradução em data-en.ts', () => {
  const missing = found.filter(
    (f) => !known.has(f.text) && !SAME.has(f.text) && !USER_TEXT.has(f.text),
  );
  assert.deepEqual(
    missing.map((f) => `${f.file}:${f.line}  ${JSON.stringify(f.text)}`),
    [],
    'Texto de análise sem par em src/lib/data-en.ts (ou, se for igual em inglês, em SAME).',
  );
});

test('data-en.ts não tem pares que o código não usa mais', () => {
  const used = new Set(found.map((f) => f.text));
  assert.deepEqual(
    DATA_EN.map(([pt]) => pt).filter((pt) => !used.has(pt)),
    [],
  );
});

test('data-en.ts: chaves únicas e o inglês só com trechos que o português tem', () => {
  const keys = DATA_EN.map(([pt]) => pt);
  assert.equal(new Set(keys).size, keys.length);
  for (const [pt, en] of DATA_EN) {
    const slots = new Set(pt.match(/\{\d+\}/g) ?? []);
    for (const slot of en.match(/\{\d+\}/g) ?? []) assert.ok(slots.has(slot), `${pt} -> ${en}`);
  }
});

test('análise estática em inglês: só os textos para gente, com os aninhados', () => {
  const info = {
    detectedType: { id: 'pe', label: 'Executável do Windows (PE)' },
    strings: { urls: ['http://exemplo.com/sem nome'] },
    pe: {
      machine: 'x64 (64 bits)',
      subsystem: 'Janelas (GUI)',
      imports: [{ dll: 'kernel32.dll', name: 'sem nome' }],
      sections: [{ name: 'sem nome', flags: ['executável'] }],
      alerts: [
        { level: 'high', text: 'Empacotado com UPX: o código real só aparece ao executar.' },
        {
          level: 'medium',
          text: 'Seção gravável e executável: .text. O código pode se reescrever na memória.',
        },
        { level: 'medium', text: 'Assinatura presente, mas não conferida: Assinatura malformada.' },
      ],
      dotnet: { flags: ['IL only', 'nome forte'], suspicious: ['WebClient (baixa da internet)'] },
    },
    script: {
      findings: [{ name: 'Desvio do AMSI', why: 'desliga a inspeção de scripts do Windows' }],
      layers: [{ method: 'Base64 (bloco)', text: 'sem nome' }],
    },
    lnk: { alerts: ['Argumentos longos (300 caracteres): comando escondido.'] },
  };
  assert.equal(localizeStaticInfo(info, 'pt-BR'), info, 'em português, o mesmo objeto');
  const en = localizeStaticInfo(info, 'en');
  assert.equal(en.detectedType.label, 'Windows executable (PE)');
  assert.equal(en.pe.machine, 'x64 (64-bit)');
  assert.equal(en.pe.subsystem, 'Windows (GUI)');
  assert.deepEqual(
    en.pe.alerts.map((a) => a.text),
    [
      'Packed with UPX: the real code only shows up when it runs.',
      'Writable and executable section: .text. The code can rewrite itself in memory.',
      'Signature present, but not checked: Malformed signature.',
    ],
  );
  assert.deepEqual(en.pe.dotnet.flags, ['IL only', 'strong name']);
  assert.deepEqual(en.pe.dotnet.suspicious, ['WebClient (downloads from the internet)']);
  assert.deepEqual(en.script.findings[0], {
    name: 'AMSI bypass',
    why: "turns off Windows's script inspection",
  });
  assert.equal(en.script.layers[0].method, 'Base64 (block)');
  assert.deepEqual(en.lnk.alerts, ['Long arguments (300 characters): hidden command.']);
  // Dado nao e traduzido, mesmo quando coincide com um texto do dicionario.
  assert.deepEqual(en.strings.urls, info.strings.urls);
  assert.equal(en.pe.imports[0].name, 'sem nome');
  assert.equal(en.pe.sections[0].name, 'sem nome');
  // O texto de um script decodificado (layers[].text) e conteudo da amostra.
  assert.equal(en.script.layers[0].text, 'sem nome');
});

test('alertas do oletools e textos soltos', () => {
  const alerts = [{ level: 'high', text: 'Contém macros VBA (2 módulo(s)).' }];
  assert.deepEqual(localizeAlerts(alerts, 'en'), [
    { level: 'high', text: 'Contains VBA macros (2 module(s)).' },
  ]);
  assert.equal(localizeAlerts(alerts, 'pt-BR'), alerts);
  assert.equal(localizeText('falha interna na análise', 'en'), 'internal analysis failure');
  assert.equal(localizeText(null, 'en'), null);
  assert.equal(localizeText('texto qualquer', 'en'), 'texto qualquer');
});
