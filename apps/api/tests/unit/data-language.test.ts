import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { DATA_EN } from '../../src/lib/data-en';
import { localizeAlerts, localizeStaticInfo, localizeText } from '../../src/lib/data-language';
import { HISTORY_EN } from '../../src/lib/history-en';
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
  'macho-analysis',
  'lnk-analysis',
  'disk-image',
  'doc-analysis',
  'oletools',
  'unpack',
  'capa',
  'ghidra',
  'script-analysis',
  'script-deobfuscate',
  'delivery-formats',
  'dotnet',
  'jar',
  'file-type',
  'reputation',
  'yara-update',
  'ioc-import',
  'qr',
  'sandbox-artifacts',
  'sysmon',
  'network-capture',
  'suricata',
  'mikrotik',
  'sandbox-autorun',
  'emulation',
  'android',
  'config-extract',
  'service-analysis',
  'sandbox-memdump',
  // Motivo do trabalho cancelado no Monitoramento (plans/monitoramento).
  'job-control',
  // plans/analise-estatica-ampliada: debug do PE e criptografia (itens 1 e 7).
  'pe-debug',
  'crypto-scan',
  // Listas de abuso (item 4).
  'lol/index',
  'lol/lolbins',
  // Servicos novos (itens 15, 19 e 20): pydec, metadados e jsdeob.
  'pydec',
  'metadata',
  'jsdeob',
  // Formatos pequenos de entrega (item 12).
  'small-formats',
].map((name) => `src/lib/${name}.ts`);

/** Iguais nos dois idiomas: nomes tecnicos, de APIs e de ferramentas. */
const SAME = new Set([
  // Mach-O (macho-analysis.ts): nomes de plataforma e de entitlements da Apple, iguais nos dois idiomas.
  'ARM64 (32 bits)',
  'Mac Catalyst',
  'iOS Simulator',
  'tvOS Simulator',
  'watchOS Simulator',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.cs.allow-dyld-environment-variables',
  'com.apple.security.cs.disable-executable-page-protection',
  'com.apple.security.get-task-allow',
  'com.apple.security.cs.debugger',
  'com.apple.private.tcc.allow',
  'com.apple.rootless.install',
  // Comando do PowerShell da execucao automatica (sandbox-autorun.ts).
  'Start-Sleep -Seconds 2',
  'try {',
  'no-sysmon',
  "if (Get-WinEvent -ListLog {0} -ErrorAction SilentlyContinue) { 'SYSMON_OK' } else { 'SYSMON_AUSENTE' }",
  // Cabecalhos HTTP (plano pos-revisao, 5.4).
  'Bearer {0}',
  'Basic {0}',
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
  'Script Encoder (.vbe/.jse)',
  // C# e PowerShell do dump de memoria (sandbox-memdump.ts): codigo que roda na VM.
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  'using Microsoft.Win32.SafeHandles;',
  'public static class DeepLookDump {',
  'Remove-Item -LiteralPath {0} -ErrorAction SilentlyContinue',
  // Versao do Visual Studio no Rich header (pe-debug.ts) e constantes do ChaCha (crypto-scan.ts).
  '{0} build {1}',
  'expand 32-byte k',
  'expand 16-byte k',
  // Reputacao (item 5): nomes e rotulos iguais nos dois idiomas.
  'Shodan InternetDB',
  // Rotulos de regra de shell e Python (item 11): nomes de comando.
  'Shell (sh/bash)',
  'chmod +x',
  'subprocess/os.system',
  'pty.spawn/os.dup2',
  'ctypes VirtualAlloc',
  'b64decode + {0}',
  'ClamAV: {0}',
  'tags {0}',
  '{0} CVE(s)',
  // Padrao de linha de comando (lol/lolbins.ts), nao texto para gente.
  '\\bpython[23]?\\s+-c\\s+["\'][^"\'\\r\\n]{0,200}socket\\.socket{0}(?:pty\\.spawn|subprocess|os\\.dup2)',
  // PATHEXT do Windows (script-deobfuscate.ts): valor de variavel de ambiente.
  '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
]);

/** Titulo e descricao da amostra filha do unpack: as pessoas editam, ficam como foram gravados. */
/** Mensagens do log de alertas (plano pos-revisao, 5.2): so em portugues; o codigo e estavel. */
const ALERT_TEXT = new Set(['Atualização de regras YARA retida']);

const USER_TEXT = new Set([
  // Descricao da filha do Office decifrado (plans/analise-estatica-ampliada, item 9).
  'Documento "{0}" decifrado com a senha "{1}".',
  '{0} (desempacotado)',
  'Extraído de "{0}" pelo desempacotador {1}{2}.',
  // Titulo e descricao do PE achado na memoria do sandbox (plans/novas-analises, item 3).
  '{0} (memória, {1})',
  'PE achado na memória do processo {0} (PID {1}), região {2}, no sandbox de "{3}".',
]);

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
    (f) =>
      !known.has(f.text) && !SAME.has(f.text) && !USER_TEXT.has(f.text) && !ALERT_TEXT.has(f.text),
  );
  assert.deepEqual(
    missing.map((f) => `${f.file}:${f.line}  ${JSON.stringify(f.text)}`),
    [],
    'Texto de análise sem par em src/lib/data-en.ts (ou, se for igual em inglês, em SAME).',
  );
});

test('data-en.ts não tem pares que o código não usa mais', () => {
  const used = new Set(found.map((f) => f.text));
  // Motivos de falha que vem do leitor de QR code (apps/oletools/qr.py, em Python): a varredura e
  // so do TypeScript.
  const fromService = new Set([
    // Dos servicos novos (apps/emulate e apps/android, em Python; plans/novas-analises).
    'o Speakeasy não emulou o arquivo: {0}',
    'não foi possível ler o APK: {0}',
    'o arquivo não é um APK válido (sem AndroidManifest.xml)',
    // Do leitor de minidump (apps/extract/memdump.py; item 3).
    'dump acima de {0} MB',
    'não é um minidump legível: {0}',
    'imagem acima de {0} pixels',
    'não foi possível ler o arquivo: {0}',
    // Do Suricata (apps/suricata/server.py; plano pos-revisao, 5.4).
    'o Suricata falhou: {0}',
    'o arquivo não é um pcap',
    'suricata-update falhou: {0}',
    // Do servico unpack (apps/unpack/unpackers; plans/analise-estatica-ampliada, itens 17, 18 e 20).
    '{0} arquivo(s) embutido(s); chave: {1}',
    '{0} arquivo(s) no pacote; {1} sem código (imagens, estilos, traduções) ficam de fora',
    '{0} arquivo(s) no pacote',
    '{0} emulado',
    // Do servico jar (apps/jarcfr/analyze.py; descompilacao de Java).
    'o arquivo não é um JAR válido (ZIP corrompido)',
    'JAR com {0} entradas (limite {1})',
    'o conteúdo descompactado das classes passa do limite (possível bomba de descompressão)',
    'o JAR não tem nenhuma classe Java',
    'não é um JAR nem um .class',
    'o CFR não descompilou o arquivo: {0}',
    'o CFR não terminou em {0} s',
    // Do servico dotnet (apps/dotnet/analyze.py; plans/caca-e-formatos, item 3).
    'não é um assembly .NET (sem metadados do CLR)',
    'o ILSpy não descompilou o arquivo: {0}',
    'o ILSpy não terminou em {0} s',
    // Do Ghidra, sobre o pseudo-C completo (apps/ghidra/server.py; plans/ghidra-pseudo-c).
    'o pseudo-C completo não foi gerado',
    'pseudo-C completo acima de {0} MB',
  ]);
  assert.deepEqual(
    DATA_EN.map(([pt]) => pt).filter((pt) => !used.has(pt) && !fromService.has(pt)),
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
