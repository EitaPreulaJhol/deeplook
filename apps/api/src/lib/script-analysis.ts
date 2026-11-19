import { createHash } from 'node:crypto';
import { gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';

import {
  decodeScriptEncoder,
  flavorOf,
  normalizeScript,
  singleByteXor,
} from './script-deobfuscate';

/**
 * Scripts (item 83): PowerShell, JScript/JavaScript, VBScript, lote (BAT/CMD) e
 * HTA. So le e decodifica texto: nada e executado. Mostra chamadas suspeitas
 * (com o porque) e desfaz as camadas comuns de ofuscacao (-EncodedCommand,
 * Base64 + GZip, fromCharCode, unescape, Chr(...)), ate um limite.
 *
 * Desofuscacao mais funda (plans/novas-analises, item 5): antes das regras, cada texto passa pela
 * normalizacao de script-deobfuscate.ts (concatenacao, -f, crases, variaveis do lote...), que vira
 * uma camada propria quando muda o texto; o Script Encoder (.vbe/.jse) e decodificado; e blocos
 * Base64 ou listas de bytes que nao sao texto tentam XOR de um byte.
 *
 * AutoIt (plans/caca-e-formatos, item 5): o script que o desempacotador tira do executavel
 * compilado (script.au3). As regras proprias do AutoIt (Run, InetGet, DllCall...) so valem nele: em
 * outra linguagem, "Run(" e um nome qualquer. O binario 0x... longo (o PE ou o shellcode que o
 * script grava ou poe na memoria) vira camada quando e texto e achado quando e PE.
 */

export type ScriptLanguage =
  | 'powershell'
  | 'javascript'
  | 'vbscript'
  | 'batch'
  | 'hta'
  | 'autoit'
  // plans/analise-estatica-ampliada, item 11.
  | 'shell'
  | 'python';

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
  /** Codificado com o Script Encoder (#@~^); o texto decodificado vira a primeira camada. */
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
  au3: 'autoit',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ksh: 'shell',
  py: 'python',
  pyw: 'python',
};

const LABEL: Record<ScriptLanguage, string> = {
  powershell: 'PowerShell',
  javascript: 'JScript/JavaScript',
  vbscript: 'VBScript',
  batch: 'Lote (BAT/CMD)',
  hta: 'HTA (aplicativo HTML)',
  autoit: 'AutoIt',
  shell: 'Shell (sh/bash)',
  python: 'Python',
};
export const scriptLabel = (l: ScriptLanguage) => LABEL[l];

/**
 * Nas regras "palavra ... outra palavra" na mesma linha, o `{0,1000}` limita a busca:
 * com `[^\n]*`, uma linha longa de palavras repetidas custa o quadrado do tamanho.
 */
type Rule = { re: RegExp; name: string; why: string; kind: ScriptFinding['kind'] };

/** So no shell do Linux (plans/analise-estatica-ampliada, item 11): droppers e botnets de IoT. */
const SHELL_RULES: Rule[] = [
  {
    re: /(?<![\w-])(?:curl|wget|tftp|ftpget|busybox\s+(?:wget|tftp))\s/i,
    name: 'curl/wget',
    why: 'baixa conteúdo da internet',
    kind: 'download',
  },
  {
    re: /\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b|\b(?:ba)?sh\s+-c\s|(?<![\w-])eval\s+["'`$(]/i,
    name: '| sh / eval',
    why: 'executa o que acabou de receber ou decodificar',
    kind: 'execute',
  },
  {
    re: /\bchmod\s+(?:[ugoa]*\+x|0?[0-7]?[157][0-7]{2})\s/i,
    name: 'chmod +x',
    why: 'torna o arquivo baixado executável',
    kind: 'execute',
  },
  {
    re: /\/dev\/(?:tcp|udp)\/[\w.-]+\/\d+/i,
    name: '/dev/tcp',
    why: 'abre uma conexão direto do shell (shell reversa)',
    kind: 'execute',
  },
  {
    re: /\bcrontab\b|\/etc\/cron|systemctl\s+enable|\/etc\/systemd\/system\/|\/etc\/rc\.local|\/etc\/init\.d\/|\.bashrc|\.profile\b|authorized_keys/i,
    name: 'cron/systemd/rc.local',
    why: 'fica ativo depois de reiniciar (persistência)',
    kind: 'persistence',
  },
  {
    re: /history\s+-c|unset\s+HISTFILE|HISTFILE=\/dev\/null|rm\s+-rf?\s+\/var\/log|iptables\s+-F|setenforce\s+0|ufw\s+disable|chattr\s+[+-]i\b/i,
    name: 'apaga rastros / desliga defesas',
    why: 'apaga o histórico ou os logs, ou desliga o firewall',
    kind: 'evasion',
  },
  {
    re: /\b(?:mips|mpsl|arm[4-7]?|x86|m68k|sh4|ppc|spc)\b[^\n]{0,300}\b(?:mips|mpsl|arm[4-7]?|m68k|sh4|ppc|spc)\b/i,
    name: 'binário por arquitetura',
    why: 'baixa um binário para cada arquitetura (botnet de IoT, como o Mirai)',
    kind: 'other',
  },
  {
    re: /base64\s+(?:-d|--decode)|\bxxd\s+-r|\$'(?:\\x[0-9a-f]{2}){4}/i,
    name: "base64 -d / $'\\x..'",
    why: 'decodifica texto escondido',
    kind: 'obfuscation',
  },
  {
    re: /\bxmrig\b|stratum\+(?:tcp|ssl):\/\//i,
    name: 'minerador',
    why: 'roda um minerador de criptomoeda',
    kind: 'other',
  },
];

/** So no Python (item 11). */
const PYTHON_RULES: Rule[] = [
  {
    re: /\b(?:exec|eval)\s*\([^\n]{0,1000}\b(?:b64decode|b32decode|decompress|loads|fromhex|decode)\b/i,
    name: 'exec(b64decode(...))',
    why: 'executa código que só existe depois de decodificado',
    kind: 'execute',
  },
  {
    re: /\bmarshal\.loads\b/,
    name: 'marshal.loads',
    why: 'carrega bytecode escondido',
    kind: 'obfuscation',
  },
  {
    re: /\bsubprocess\.(?:Popen|call|run|check_output)\b|\bos\.(?:system|popen)\s*\(/,
    name: 'subprocess/os.system',
    why: 'inicia outro programa ou comando do sistema',
    kind: 'execute',
  },
  {
    re: /\burllib\.request\.(?:urlopen|urlretrieve)\b|\brequests\.(?:get|post)\s*\(|\burlretrieve\s*\(/,
    name: 'urllib/requests',
    why: 'baixa ou envia conteúdo pela internet',
    kind: 'download',
  },
  {
    re: /\bpty\.spawn\s*\(|\bos\.dup2\s*\(/,
    name: 'pty.spawn/os.dup2',
    why: 'abre conexão de rede e entrega um shell (shell reversa)',
    kind: 'execute',
  },
  {
    re: /\b(?:VirtualAlloc|CreateThread|RtlMoveMemory|WriteProcessMemory)\b/,
    name: 'ctypes VirtualAlloc',
    why: 'põe código na memória e o executa (shellcode)',
    kind: 'execute',
  },
  {
    re: /__pyarmor__|\bpytransform\b/,
    name: 'PyArmor',
    why: 'código protegido pelo PyArmor (não dá para ler o original)',
    kind: 'obfuscation',
  },
  {
    re: /Login Data|Local State|cookies\.sqlite|wallet\.dat|Exodus|Electrum/,
    name: 'dados de navegador ou carteira',
    why: 'lê senhas, cookies ou carteiras (ladrão de dados)',
    kind: 'other',
  },
  {
    re: /CurrentVersion\\+Run|\bcrontab\b|Start Menu\\+Programs\\+Startup|\.bashrc/,
    name: 'persistência',
    why: 'fica ativo depois de reiniciar (persistência)',
    kind: 'persistence',
  },
];

/** So no AutoIt (o script.au3 do executavel compilado). */
const AUTOIT_RULES: Rule[] = [
  {
    re: /(?<![\w.$])(?:run|runwait|shellexecute|shellexecutewait)\s*\(/i,
    name: 'Run/ShellExecute',
    why: 'inicia outro programa',
    kind: 'execute',
  },
  {
    re: /(?<![\w.$])(?:inetget|inetread)\s*\(/i,
    name: 'InetGet/InetRead',
    why: 'baixa conteúdo da internet',
    kind: 'download',
  },
  {
    re: /(?<![\w.$])dllcall\s*\([^\n]{0,1000}\b(?:virtualalloc(?:ex)?|virtualprotect(?:ex)?|callwindowproc|createthread|createremotethread|writeprocessmemory|rtlmovememory)\b/i,
    name: 'DllCall de memória executável',
    why: 'põe código na memória e o executa (shellcode ou PE carregado à mão)',
    kind: 'execute',
  },
  {
    re: /(?<![\w.$])dllstructcreate\s*\(\s*["']byte\s*\[/i,
    name: 'DllStructCreate("byte[...]")',
    why: 'reserva um buffer de bytes (costuma receber o shellcode)',
    kind: 'other',
  },
  {
    re: /(?<![\w.$])regwrite\s*\([^\n]{0,1000}\\currentversion\\run/i,
    name: 'RegWrite na chave Run',
    why: 'fica ativo depois de reiniciar (persistência)',
    kind: 'persistence',
  },
  {
    re: /(?<![\w.$])(?:binarytostring|_crypt_decryptdata|_base64decode)\s*\(/i,
    name: 'BinaryToString/_Crypt_DecryptData',
    why: 'decodifica ou decifra conteúdo escondido',
    kind: 'obfuscation',
  },
  {
    re: /(?<![\w.$])fileinstall\s*\(/i,
    name: 'FileInstall',
    why: 'grava no disco um arquivo embutido no executável',
    kind: 'other',
  },
  {
    re: /#notrayicon\b/i,
    name: '#NoTrayIcon',
    why: 'esconde o ícone da bandeja (roda sem o usuário perceber)',
    kind: 'evasion',
  },
];

/** Binario 0x... do AutoIt: 64 bytes ou mais. */
const AUTOIT_BINARY_RE = /["']0x((?:[0-9a-f]{2}){64,})["']/gi;

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
    re: /certutil(?:\.exe)?\s+[^\n]{0,1000}-(?:urlcache|decode)/i,
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
    re: /powershell(?:\.exe)?\b[^\n]{0,1000}-(?:e|en|enc|enco|encodedcommand)\s/i,
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
    re: /add-mppreference[^\n]{0,1000}-exclusion|set-mppreference[^\n]{0,1000}-disable/i,
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
    re: /vssadmin[^\n]{0,1000}delete|wbadmin[^\n]{0,1000}delete|bcdedit[^\n]{0,1000}recoveryenabled/i,
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

/** Bytes que viram script com XOR de um byte (-bxor com chave fixa). */
function xorCandidate(out: [string, string][], bytes: Buffer): boolean {
  const found = singleByteXor(bytes);
  if (!found) return false;
  const key = `0x${found.key.toString(16).padStart(2, '0')}`;
  out.push([`XOR de um byte (chave ${key})`, found.text]);
  return true;
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
    } else if (!xorCandidate(out, bytes)) {
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
    // So hexadecimal (o binario 0x... do AutoIt, um hash) tambem e Base64 valido, mas nao e.
    if (/^(?:0x)?[0-9a-f]+$/i.test(m[1])) continue;
    const bytes = b64(m[1]);
    const packed = inflate(bytes);
    if (!packed && xorCandidate(out, bytes)) continue;
    const decoded = bytesToText(packed ? packed.data : bytes);
    if (readable(decoded))
      out.push([packed ? `Base64 + ${packed.method}` : 'Base64 (bloco)', decoded]);
  }
  // Shell (item 11): echo <base64> | base64 -d, $'\x41...' e printf '\x41...'.
  for (const m of text.matchAll(
    /echo\s+(?:-n\s+)?["']?([A-Za-z0-9+/]{16,}={0,2})["']?\s*\|\s*base64\s+(?:-d|--decode)/gi,
  )) {
    const bytes = b64(m[1]);
    const packed = inflate(bytes);
    const decoded = bytesToText(packed ? packed.data : bytes);
    if (readable(decoded)) out.push(['echo | base64 -d', decoded]);
  }
  for (const m of text.matchAll(/(?:\$'|printf\s+["'])((?:\\x[0-9a-f]{2}|\\[0-7]{3}){4,})/gi)) {
    const decoded = m[1].replace(/\\x([0-9a-f]{2})|\\([0-7]{3})/gi, (_, hex, oct) =>
      String.fromCharCode(hex ? parseInt(hex, 16) : parseInt(oct, 8)),
    );
    if (readable(decoded)) out.push(["$'\\x..' / printf", decoded]);
  }
  // Python (item 11): b64decode('...') com zlib.decompress, bytes.fromhex('...') e rot13.
  for (const m of text.matchAll(/b(?:64|32)decode\s*\(\s*b?["']([A-Za-z0-9+/=\s]{16,})["']/gi)) {
    const bytes = b64(m[1]);
    const packed = inflate(bytes);
    const decoded = bytesToText(packed ? packed.data : bytes);
    if (readable(decoded))
      out.push([packed ? `b64decode + ${packed.method}` : 'b64decode', decoded]);
  }
  for (const m of text.matchAll(/fromhex\s*\(\s*["']([0-9a-f\s]{32,})["']/gi)) {
    const bytes = Buffer.from(m[1].replace(/\s+/g, ''), 'hex');
    const packed = inflate(bytes);
    const decoded = bytesToText(packed ? packed.data : bytes);
    if (readable(decoded)) out.push(['bytes.fromhex', decoded]);
  }
  for (const m of text.matchAll(
    /codecs\.decode\s*\(\s*["']([^"'\n]{12,})["']\s*,\s*["']rot_?13["']/gi,
  )) {
    out.push([
      'rot13',
      m[1].replace(/[a-z]/gi, (c) =>
        String.fromCharCode(
          ((c.toLowerCase().charCodeAt(0) - 97 + 13) % 26) + (c <= 'Z' ? 65 : 97),
        ),
      ),
    ]);
  }
  // Lista de bytes (0x41,0x42,... ou 65,66,...) com 16 ou mais: texto direto ou com XOR.
  for (const m of text.matchAll(
    /\(\s*((?:(?:0x[0-9a-f]{1,2}|\d{1,3})\s*,\s*){15,20000}(?:0x[0-9a-f]{1,2}|\d{1,3}))\s*\)/gi,
  )) {
    const values = m[1].split(',').map((n) => Number(n.trim()));
    if (values.some((v) => !Number.isInteger(v) || v > 255)) continue;
    const bytes = Buffer.from(values);
    if (xorCandidate(out, bytes)) continue;
    const decoded = bytes.toString('latin1');
    if (readable(decoded)) out.push(['Lista de bytes', decoded]);
  }
  return out;
}

/** Linguagem pelo nome ou, sem extensao conhecida, pelo conteudo. */
function detectLanguage(text: string, filename?: string | null): ScriptLanguage | null {
  const ext = filename?.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1];
  if (ext && EXT[ext]) return EXT[ext];
  const head = text.slice(0, 4000).toLowerCase();
  if (/<hta:application/.test(head)) return 'hta';
  if (
    /^\s*#(?:notrayicon|requireadmin|include\s*<[\w.]+\.au3>)/m.test(head) ||
    /^\s*func\s+\w+\s*\([^)]*\)\s*$[\s\S]{0,3000}^\s*endfunc\b/m.test(head)
  )
    return 'autoit';
  if (/^\s*@?echo\s+off/m.test(head)) return 'batch';
  // Shell e Python (item 11): o shebang, ou o jeito tipico de dropper.
  if (/^#!\s*\S*\/(?:env\s+)?(?:ba|z|da|k)?sh\b/.test(head)) return 'shell';
  if (/^#!\s*\S*\/(?:env\s+)?python/.test(head)) return 'python';
  if (
    /^\s*(?:import\s+(?:os|sys|base64|socket|subprocess|zlib|marshal|ctypes)\b|from\s+\w+\s+import\s)/m.test(
      head,
    )
  )
    return 'python';
  if (/(?:^|;)\s*(?:cd\s+\/tmp|wget\s|curl\s)[^\n]*(?:chmod\s|\|\s*(?:ba)?sh\b)/m.test(head))
    return 'shell';
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

const AUTOIT_PE = 'PE em binário 0x';

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

  const pushLayer = (method: string, from: number, decoded: string): number | null => {
    if (layers.length >= MAX_LAYERS) return null;
    // Hash do texto inteiro: camadas aninhadas comecam iguais ("powershell -enc ...").
    const key = createHash('sha1').update(decoded).digest('hex');
    if (seen.has(key)) return null;
    seen.add(key);
    layers.push({
      method,
      from,
      text: decoded.slice(0, MAX_LAYER_TEXT),
      truncated: decoded.length > MAX_LAYER_TEXT,
    });
    return layers.length;
  };

  const scan = (raw: string, rawLayer: number, depth: number) => {
    // Normalizacao (item 5 das novas analises): o texto sem a ofuscacao que nao e codificacao. As
    // regras e as camadas olham os dois; o normalizado vira camada quando muda o texto.
    let source = raw;
    let layer = rawLayer;
    // O AutoIt concatena com & e usa StringReverse/StringReplace: normaliza como VBScript.
    // Python escapa e concatena como o JavaScript; o shell nao tem normalizacao (o circunflexo e o
    // % do lote mudariam o texto).
    const rootFlavor =
      language === 'autoit' ? 'vbscript' : language === 'python' ? 'javascript' : language;
    const normalized =
      language === 'shell' && depth === 0
        ? { text: raw, techniques: [] }
        : normalizeScript(
            raw,
            flavorOf(raw, depth === 0 ? (rootFlavor as Parameters<typeof flavorOf>[1]) : null),
          );
    if (normalized.techniques.length && normalized.text.trim() !== raw.trim()) {
      const index = pushLayer(normalized.techniques.join(' · '), rawLayer, normalized.text);
      if (index !== null) {
        scanRules(raw, rawLayer);
        source = normalized.text;
        layer = index;
      }
    }
    scanRules(source, layer);
    if (depth >= MAX_DEPTH) return;
    for (const [method, decoded] of decodeCandidates(source)) {
      const index = pushLayer(method, layer, decoded);
      if (index === null) {
        if (layers.length >= MAX_LAYERS) return;
        continue;
      }
      scan(decoded, index, depth + 1);
    }
  };

  const rules =
    language === 'autoit'
      ? [...AUTOIT_RULES, ...RULES]
      : language === 'shell'
        ? [...SHELL_RULES, ...RULES]
        : language === 'python'
          ? [...PYTHON_RULES, ...RULES]
          : RULES;
  const scanRules = (source: string, layer: number) => {
    for (const rule of rules) {
      if (!findings.has(rule.name) && rule.re.test(source)) {
        findings.set(rule.name, { name: rule.name, why: rule.why, kind: rule.kind, layer });
      }
    }
    for (const m of source.matchAll(URL_RE))
      if (urls.size < 50) urls.add(m[0].replace(/[.,;]+$/, ''));
    if (language === 'autoit') scanAutoitBinaries(source, layer);
  };

  // Binario 0x... longo: texto vira camada (pelo scan normal, em decodeCandidates nao entra, que
  // vale para todas as linguagens); PE vira achado.
  const scanAutoitBinaries = (source: string, layer: number) => {
    for (const m of source.matchAll(AUTOIT_BINARY_RE)) {
      const bytes = Buffer.from(m[1], 'hex');
      if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
        if (!findings.has(AUTOIT_PE)) {
          findings.set(AUTOIT_PE, {
            name: AUTOIT_PE,
            why: 'o script traz um executável inteiro em hexadecimal (grava ou carrega na memória)',
            kind: 'execute',
            layer,
          });
        }
        continue;
      }
      const decoded = bytesToText(bytes);
      if (readable(decoded)) pendingBinaries.push([layer, decoded]);
    }
  };
  const pendingBinaries: [number, string][] = [];

  // Script Encoder (#@~^, .vbe/.jse): o texto decodificado e a primeira camada.
  const encoded = /#@~\^/.test(text.slice(0, 4000));
  const plain = encoded ? decodeScriptEncoder(text) : null;
  scan(text, 0, 0);
  for (const [from, decoded] of pendingBinaries.splice(0, 20)) {
    const index = pushLayer('Binário 0x (AutoIt)', from, decoded);
    if (index !== null) scan(decoded, index, 1);
  }
  if (plain) {
    const index = pushLayer('Script Encoder (.vbe/.jse)', 0, plain);
    if (index !== null) scan(plain, index, 1);
  }

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
    encoded,
  };
}
