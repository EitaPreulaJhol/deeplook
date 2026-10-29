import { createHash } from 'node:crypto';
import { gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';

/**
 * Scripts (item 83): PowerShell, JScript/JavaScript, VBScript, lote (BAT/CMD) e
 * HTA. So le e decodifica texto: nada e executado. Mostra chamadas suspeitas
 * (com o porque) e desfaz as camadas comuns de ofuscacao (-EncodedCommand,
 * Base64 + GZip, fromCharCode, unescape, Chr(...)), ate um limite.
 */

export type ScriptLanguage = 'powershell' | 'javascript' | 'vbscript' | 'batch' | 'hta';

export interface ScriptFinding {
  /** Chamada/trecho achado (ex.: "DownloadString"). */
  name: string;
  /** Por que importa ("baixa conteúdo da internet"). */
  why: string;
  /** Peso no risco: executar e baixar valem mais. */
  kind: 'download' | 'execute' | 'evasion' | 'persistence' | 'obfuscation' | 'other';
  /** Em que camada apareceu (0 = o arquivo). */
  layer: number;
}

export interface ScriptLayer {
  /** Como foi decodificada ("PowerShell -EncodedCommand", "Base64 + GZip"...). */
  method: string;
  /** Camada de onde saiu (0 = o arquivo). */
  from: number;
  /** Texto decodificado (cortado em MAX_LAYER_TEXT). */
  text: string;
  truncated: boolean;
}

export interface ScriptInfo {
  language: ScriptLanguage;
  lines: number;
  risk: 'high' | 'medium' | 'low';
  findings: ScriptFinding[];
  layers: ScriptLayer[];
  /** URLs achadas no arquivo e nas camadas (texto; nunca link). */
  urls: string[];
  /** Codificado com o Script Encoder (#@~^): nao decodificado. */
  encoded: boolean;
}

const MAX_TEXT = 2 * 1024 * 1024;
const MAX_LAYERS = 12;
const MAX_DEPTH = 5;
const MAX_LAYER_TEXT = 20_000;

const EXT: Record<string, ScriptLanguage> = {
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  js: 'javascript',
  jse: 'javascript',
  mjs: 'javascript',
  wsf: 'javascript',
  vbs: 'vbscript',
  vbe: 'vbscript',
  vba: 'vbscript',
  bat: 'batch',
  cmd: 'batch',
  hta: 'hta',
};

const LABEL: Record<ScriptLanguage, string> = {
  powershell: 'PowerShell',
  javascript: 'JScript/JavaScript',
  vbscript: 'VBScript',
  batch: 'Lote (BAT/CMD)',
  hta: 'HTA (aplicativo HTML)',
};
export const scriptLabel = (l: ScriptLanguage) => LABEL[l];

type Rule = { re: RegExp; name: string; why: string; kind: ScriptFinding['kind'] };

/** Chamadas suspeitas (valem em qualquer linguagem: as camadas misturam). */
const RULES: Rule[] = [
  {
    re: /\b(?:iex|invoke-expression)\b/i,
    name: 'Invoke-Expression (IEX)',
    why: 'executa texto como código',
    kind: 'execute',
  },
  {
    re: /\bdownload(?:string|file|data)\b/i,
    name: 'DownloadString/DownloadFile',
    why: 'baixa conteúdo da internet',
    kind: 'download',
  },
  {
    re: /\b(?:invoke-webrequest|invoke-restmethod|iwr|irm)\b/i,
    name: 'Invoke-WebRequest',
    why: 'baixa conteúdo da internet',
    kind: 'download',
  },
  {
    re: /net\.webclient/i,
    name: 'Net.WebClient',
    why: 'cliente HTTP usado para baixar',
    kind: 'download',
  },
  {
    re: /start-bitstransfer|bitsadmin\b/i,
    name: 'BITS (bitsadmin)',
    why: 'baixa arquivos em segundo plano',
    kind: 'download',
  },
  {
    re: /certutil(?:\.exe)?\s+[^\n]*-(?:urlcache|decode)/i,
    name: 'certutil -urlcache/-decode',
    why: 'baixa ou decodifica arquivo com ferramenta do Windows',
    kind: 'download',
  },
  {
    re: /msxml2\.(?:server)?xmlhttp|winhttp\.winhttprequest/i,
    name: 'XMLHTTP/WinHTTP',
    why: 'faz requisição HTTP',
    kind: 'download',
  },
  {
    re: /adodb\.stream/i,
    name: 'ADODB.Stream',
    why: 'grava o que foi baixado em arquivo',
    kind: 'download',
  },
  {
    re: /\bstart-process\b/i,
    name: 'Start-Process',
    why: 'inicia outro programa',
    kind: 'execute',
  },
  {
    re: /wscript\.shell|shell\.application/i,
    name: 'WScript.Shell',
    why: 'executa comandos do sistema',
    kind: 'execute',
  },
  {
    re: /\.(?:run|exec|shellexecute)\s*\(/i,
    name: '.Run()/.Exec()/ShellExecute',
    why: 'executa comandos do sistema',
    kind: 'execute',
  },
  { re: /\beval\s*\(/i, name: 'eval()', why: 'executa texto como código', kind: 'execute' },
  {
    re: /new\s+activexobject/i,
    name: 'ActiveXObject',
    why: 'cria objeto COM (acesso ao sistema)',
    kind: 'execute',
  },
  {
    re: /\bcreateobject\s*\(/i,
    name: 'CreateObject',
    why: 'cria objeto COM (acesso ao sistema)',
    kind: 'execute',
  },
  {
    re: /\b(?:mshta|rundll32|regsvr32|wmic\s+process\s+call\s+create)\b/i,
    name: 'mshta/rundll32/regsvr32/wmic',
    why: 'executa código por binário confiável do Windows',
    kind: 'execute',
  },
  {
    re: /powershell(?:\.exe)?\b[^\n]*-(?:e|en|enc|enco|encodedcommand)\s/i,
    name: 'powershell -EncodedCommand',
    why: 'esconde o comando em Base64',
    kind: 'obfuscation',
  },
  {
    re: /-(?:w|win|window|windowstyle)\s+h(?:idden)?\b/i,
    name: '-WindowStyle Hidden',
    why: 'roda com a janela oculta',
    kind: 'evasion',
  },
  {
    re: /-(?:ep|exec|executionpolicy)\s+bypass/i,
    name: '-ExecutionPolicy Bypass',
    why: 'ignora a política de execução',
    kind: 'evasion',
  },
  {
    re: /add-mppreference[^\n]*-exclusion|set-mppreference[^\n]*-disable/i,
    name: 'Exclusão/desligar o Defender',
    why: 'tenta escapar do antivírus',
    kind: 'evasion',
  },
  {
    re: /amsiutils|amsiinitfailed/i,
    name: 'Desvio do AMSI',
    why: 'desliga a inspeção de scripts do Windows',
    kind: 'evasion',
  },
  {
    re: /vssadmin[^\n]*delete|wbadmin[^\n]*delete|bcdedit[^\n]*recoveryenabled/i,
    name: 'Apagar cópias de sombra',
    why: 'típico de ransomware',
    kind: 'evasion',
  },
  {
    re: /\\currentversion\\run\b|schtasks(?:\.exe)?\s+\/create|new-scheduledtask|startup\\/i,
    name: 'Run/Tarefa agendada/Inicializar',
    why: 'fica ativo depois de reiniciar (persistência)',
    kind: 'persistence',
  },
  { re: /\battrib\s+\+h|\+s\s+\+h/i, name: 'attrib +h', why: 'esconde arquivos', kind: 'evasion' },
  {
    re: /\[(?:system\.)?convert\]::frombase64string/i,
    name: 'FromBase64String',
    why: 'decodifica conteúdo escondido',
    kind: 'obfuscation',
  },
  {
    re: /string\.fromcharcode/i,
    name: 'String.fromCharCode',
    why: 'monta texto a partir de códigos (ofuscação)',
    kind: 'obfuscation',
  },
  {
    re: /\b(?:unescape|atob)\s*\(/i,
    name: 'unescape()/atob()',
    why: 'decodifica texto escondido',
    kind: 'obfuscation',
  },
  {
    re: /(?:chrw?\s*\(\s*\d+\s*\)\s*&\s*){5}/i,
    name: 'Chr() & Chr() ...',
    why: 'monta texto caractere a caractere (ofuscação)',
    kind: 'obfuscation',
  },
];

/** Texto legivel? (proporcao de caracteres imprimiveis) */
function readable(text: string): boolean {
  if (!text) return false;
  let ok = 0;
  const n = Math.min(text.length, 4000);
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 160) ok++;
  }
  return ok / n > 0.85;
}

/** Bytes -> texto: UTF-16LE (com zeros alternados) ou UTF-8. */
function bytesToText(bytes: Buffer): string {
  let zeros = 0;
  const n = Math.min(bytes.length, 400);
  for (let i = 1; i < n; i += 2) if (bytes[i] === 0) zeros++;
  return zeros > n / 4 ? bytes.toString('utf16le') : bytes.toString('utf8');
}

/** Descompacta se for gzip/zlib/deflate; senao devolve null. */
function inflate(bytes: Buffer): { data: Buffer; method: string } | null {
  const tries: [string, () => Buffer][] = [
    ['GZip', () => gunzipSync(bytes, { maxOutputLength: MAX_TEXT })],
    ['Deflate', () => inflateRawSync(bytes, { maxOutputLength: MAX_TEXT })],
    ['zlib', () => inflateSync(bytes, { maxOutputLength: MAX_TEXT })],
  ];
  for (const [method, fn] of tries) {
    try {
      const data = fn();
      if (data.length) return { data, method };
    } catch {
      /* proximo */
    }
  }
  return null;
}

/** Candidatos a camada num texto: [metodo, texto decodificado]. */
function decodeCandidates(text: string): [string, string][] {
  const out: [string, string][] = [];
  const b64 = (value: string) => Buffer.from(value.replace(/\s+/g, ''), 'base64');

  // PowerShell -EncodedCommand <base64 UTF-16LE>.
  for (const m of text.matchAll(
    /-(?:e|en|enc|enco|encodedcommand)\s+["']?([A-Za-z0-9+/=]{16,})/gi,
  )) {
    const decoded = b64(m[1]).toString('utf16le');
    if (readable(decoded)) out.push(['PowerShell -EncodedCommand', decoded]);
  }
  // FromBase64String('...') (talvez com GZip/Deflate).
  for (const m of text.matchAll(/frombase64string\s*\(\s*["']([A-Za-z0-9+/=\s]{16,})["']/gi)) {
    const bytes = b64(m[1]);
    const packed = inflate(bytes);
    if (packed) {
      const decoded = bytesToText(packed.data);
      if (readable(decoded)) out.push([`Base64 + ${packed.method}`, decoded]);
    } else {
      const decoded = bytesToText(bytes);
      if (readable(decoded)) out.push(['Base64', decoded]);
    }
  }
  // atob('...').
  for (const m of text.matchAll(/atob\s*\(\s*["']([A-Za-z0-9+/=]{16,})["']\s*\)/gi)) {
    const decoded = b64(m[1]).toString('utf8');
    if (readable(decoded)) out.push(['atob (Base64)', decoded]);
  }
  // String.fromCharCode(72, 101, ...).
  for (const m of text.matchAll(/fromcharcode\s*\(\s*((?:\d{1,5}\s*,\s*){3,}\d{1,5})\s*\)/gi)) {
    const decoded = String.fromCharCode(...m[1].split(',').map((n) => Number(n.trim())));
    if (readable(decoded)) out.push(['String.fromCharCode', decoded]);
  }
  // unescape('%68%74...') / decodeURIComponent.
  for (const m of text.matchAll(
    /(?:unescape|decodeuricomponent)\s*\(\s*["']((?:%[0-9a-f]{2}|%u[0-9a-f]{4}|[^"'%]){12,})["']/gi,
  )) {
    try {
      const decoded = unescape(m[1]);
      if (readable(decoded)) out.push(['unescape (%xx)', decoded]);
    } catch {
      /* ignora */
    }
  }
  // VBScript: Chr(72) & Chr(101) & ...
  for (const m of text.matchAll(
    /((?:chrw?\s*\(\s*\d{1,5}\s*\)\s*&\s*){5,}chrw?\s*\(\s*\d{1,5}\s*\))/gi,
  )) {
    const decoded = [...m[1].matchAll(/\d{1,5}/g)]
      .map((n) => String.fromCharCode(Number(n[0])))
      .join('');
    if (readable(decoded)) out.push(['Chr() & Chr()', decoded]);
  }
  // Bloco Base64 solto e longo (payload embutido).
  for (const m of text.matchAll(/["']([A-Za-z0-9+/]{120,}={0,2})["']/g)) {
    const bytes = b64(m[1]);
    const packed = inflate(bytes);
    const decoded = bytesToText(packed ? packed.data : bytes);
    if (readable(decoded))
      out.push([packed ? `Base64 + ${packed.method}` : 'Base64 (bloco)', decoded]);
  }
  return out;
}

/** Linguagem pelo nome ou, sem extensao conhecida, pelo conteudo. */
function detectLanguage(text: string, filename?: string | null): ScriptLanguage | null {
  const ext = filename?.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1];
  if (ext && EXT[ext]) return EXT[ext];
  const head = text.slice(0, 4000).toLowerCase();
  if (/<hta:application/.test(head)) return 'hta';
  if (/^\s*@?echo\s+off/m.test(head)) return 'batch';
  if (/^\s*(?:\$[a-z_]+\s*=|function\s+[a-z]+-[a-z]+|param\s*\(|\[cmdletbinding)/m.test(head))
    return 'powershell';
  if (/\b(?:dim|set)\s+\w+\s*=\s*createobject/.test(head) || /^\s*on error resume next/m.test(head))
    return 'vbscript';
  if (/new\s+activexobject|wscript\.createobject|\bvar\s+\w+\s*=\s*new\s+activex/.test(head))
    return 'javascript';
  return null;
}

/** Texto do arquivo, se for texto (UTF-8/latin1 ou UTF-16 com BOM). */
function asText(buf: Buffer): string | null {
  if (buf.length < 8) return null;
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2, MAX_TEXT).toString('utf16le');
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) return null;
  const text = buf.subarray(0, MAX_TEXT).toString('utf8');
  return readable(text) ? text : null;
}

const URL_RE = /\bh(?:tt|xx)ps?:\/\/[^\s"'<>`)]{4,300}/gi;

/** Analisa o arquivo como script; null se nao for um script reconhecido. */
export function analyzeScript(buf: Buffer, filename?: string | null): ScriptInfo | null {
  const text = asText(buf);
  if (!text) return null;
  const language = detectLanguage(text, filename);
  if (!language) return null;

  const layers: ScriptLayer[] = [];
  const findings = new Map<string, ScriptFinding>();
  const urls = new Set<string>();
  const seen = new Set<string>();

  const scan = (source: string, layer: number, depth: number) => {
    for (const rule of RULES) {
      if (!findings.has(rule.name) && rule.re.test(source)) {
        findings.set(rule.name, { name: rule.name, why: rule.why, kind: rule.kind, layer });
      }
    }
    for (const m of source.matchAll(URL_RE))
      if (urls.size < 50) urls.add(m[0].replace(/[.,;]+$/, ''));
    if (depth >= MAX_DEPTH) return;
    for (const [method, decoded] of decodeCandidates(source)) {
      if (layers.length >= MAX_LAYERS) return;
      // Hash do texto inteiro: camadas aninhadas comecam iguais ("powershell -enc ...").
      const key = createHash('sha1').update(decoded).digest('hex');
      if (seen.has(key)) continue;
      seen.add(key);
      layers.push({
        method,
        from: layer,
        text: decoded.slice(0, MAX_LAYER_TEXT),
        truncated: decoded.length > MAX_LAYER_TEXT,
      });
      scan(decoded, layers.length, depth + 1);
    }
  };
  scan(text, 0, 0);

  const list = [...findings.values()];
  const has = (kind: ScriptFinding['kind']) => list.some((f) => f.kind === kind);
  const risk =
    (has('download') && has('execute')) ||
    has('evasion') ||
    (layers.length > 0 && (has('download') || has('execute')))
      ? 'high'
      : has('download') || has('execute') || has('obfuscation') || has('persistence')
        ? 'medium'
        : 'low';
  return {
    language,
    lines: text.split('\n').length,
    risk,
    findings: list,
    layers,
    urls: [...urls],
    encoded: /#@~\^/.test(text.slice(0, 200)),
  };
}
