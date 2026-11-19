/**
 * Formatos pequenos de entrega (plans/analise-estatica-ampliada, item 12): arquivos de texto ou XML
 * que o Windows abre com um clique e que mandam buscar algo de fora ou rodar um comando. Nenhum
 * traz carga: o perigo e o destino (uma URL, uma pasta remota que vaza o hash NTLM) ou o comando.
 *
 * - `.msc` (console MMC): GrimResource roda JavaScript pelo `res://apds.dll`;
 * - `.url`/`.website` e `.scf`: atalho para URL ou com icone numa pasta remota (vaza o hash);
 * - `.library-ms`/`.search-ms`: biblioteca ou busca do Explorer apontando para pasta remota;
 * - `.appinstaller`: instala um pacote MSIX baixado da URL;
 * - `.iqy` (consulta web do Excel) e `.slk` (planilha SYLK com EXEC);
 * - `.reg`: chaves de inicializacao; `.inf` e `.sct`: o INF do cmstp e o scriptlet COM;
 * - `.settingcontent-ms`: o DeepLink executa um comando.
 */

export type SmallFormat =
  | 'msc'
  | 'url'
  | 'scf'
  | 'library-ms'
  | 'search-ms'
  | 'appinstaller'
  | 'iqy'
  | 'slk'
  | 'reg'
  | 'inf'
  | 'sct'
  | 'settingcontent';

export interface SmallFormatInfo {
  format: SmallFormat;
  alerts: { level: 'high' | 'medium' | 'info'; text: string }[];
  /** URLs, caminhos UNC e comandos que o arquivo usa (os enderecos vao para os IOCs). */
  targets: string[];
  /** Script embutido (o do .msc e do .sct), para a analise de scripts. */
  script: string | null;
}

const MAX_TEXT = 1024 * 1024;
const MAX_TARGETS = 50;

const REMOTE = /^(?:https?:|ftp:|\\\\|\/\/|file:\/\/[^/]|search-ms:|ms-|davwww|webdav)/i;
const unc = (v: string) => /^\\\\[^\\]+\\/.test(v) || /^file:\/\/[^/]/i.test(v);

function textOf(buf: Buffer): string {
  const slice = buf.subarray(0, MAX_TEXT);
  if (slice[0] === 0xff && slice[1] === 0xfe) return slice.subarray(2).toString('utf16le');
  return slice.toString('utf8').replace(/^\uFEFF/, '');
}

const ext = (filename?: string | null) => filename?.toLowerCase().match(/\.([a-z-]{2,20})$/)?.[1];

/** Valores de uma chave de INI (`Chave=valor`), sem diferenciar maiusculas. */
const iniValues = (text: string, key: string) =>
  [...text.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'gim'))].map((m) => m[1]);

/** Valores entre <tag> e </tag> (XML simples). */
const xmlValues = (text: string, tag: string) =>
  [...text.matchAll(new RegExp(`<${tag}[^>]*>\\s*([^<]{1,2000}?)\\s*</${tag}>`, 'gi'))].map(
    (m) => m[1],
  );

function which(text: string, filename?: string | null): SmallFormat | null {
  const e = ext(filename);
  const head = text.slice(0, 4000);
  if (/<MMC_ConsoleFile\b/i.test(head) || e === 'msc')
    return /<MMC_ConsoleFile\b/i.test(head) ? 'msc' : null;
  if (/^\s*\[InternetShortcut\]/im.test(head)) return 'url';
  if (/^\s*\[Shell\]/im.test(head) && /^\s*(?:Command|IconFile)\s*=/im.test(head)) return 'scf';
  if (/<libraryDescription\b/i.test(head)) return 'library-ms';
  if (/<persistedQuery\b|<searchConnectorDescription\b/i.test(head)) return 'search-ms';
  if (/<AppInstaller\b/i.test(head)) return 'appinstaller';
  if (
    /^WEB\s*\r?\n\s*1\s*\r?\n\s*\S+:\/\//i.test(head) ||
    (e === 'iqy' && /https?:\/\//i.test(head))
  )
    return 'iqy';
  if (/^ID;P/.test(head)) return 'slk';
  if (/^(?:Windows Registry Editor Version 5\.00|REGEDIT4)\b/.test(head)) return 'reg';
  if (/^\s*\[version\]/im.test(head) && /signature\s*=\s*["']?\$/i.test(head)) return 'inf';
  if (/<scriptlet\b/i.test(head) && /<script\b/i.test(text)) return 'sct';
  if (/<PCSettings\b/i.test(head)) return 'settingcontent';
  return null;
}

export function analyzeSmallFormat(buf: Buffer, filename?: string | null): SmallFormatInfo | null {
  if (buf.length > MAX_TEXT * 4 || buf.length < 8) return null;
  // Binario (zeros fora do UTF-16) nao e nenhum destes.
  const text = textOf(buf);
  if (!text || text.slice(0, 2000).includes('\0')) return null;
  const format = which(text, filename);
  if (!format) return null;
  const alerts: SmallFormatInfo['alerts'] = [];
  const targets = new Set<string>();
  let script: string | null = null;
  // Frases inteiras por tipo (o tradutor so casa a frase toda).
  const PHRASES = {
    url: [
      (v: string) =>
        `O atalho aponta para uma pasta remota (${v}): o Windows manda o hash NTLM de quem abre.`,
      (v: string) => `O atalho aponta para fora da máquina: ${v}`,
    ],
    icon: [
      (v: string) =>
        `O ícone fica numa pasta remota (${v}): o Windows manda o hash NTLM de quem abre.`,
      (v: string) => `O ícone vem de fora da máquina: ${v}`,
    ],
    folder: [
      (v: string) =>
        `A biblioteca ou a busca abre uma pasta remota (${v}): o Windows manda o hash NTLM de quem abre.`,
      (v: string) => `A biblioteca ou a busca abre um local fora da máquina: ${v}`,
    ],
  };
  const remote = (values: string[], what: keyof typeof PHRASES) => {
    for (const v of values.map((x) => x.trim()).filter(Boolean)) {
      targets.add(v);
      if (unc(v)) alerts.push({ level: 'high', text: PHRASES[what][0](v) });
      else if (REMOTE.test(v)) alerts.push({ level: 'high', text: PHRASES[what][1](v) });
    }
  };

  switch (format) {
    case 'msc': {
      const code = [...text.matchAll(/<String[^>]*>([\s\S]{0,200000}?)<\/String>/gi)]
        .map((m) => m[1])
        .filter((s) => /\b(?:function|var\s|CreateObject|eval\(|ActiveXObject|WScript)/i.test(s))
        .join('\n');
      if (/res:\/\/apds\.dll/i.test(text)) {
        alerts.push({
          level: 'high',
          text: 'Console MMC com res://apds.dll (GrimResource): executa script ao abrir.',
        });
      }
      if (code) {
        script = code;
        alerts.push({ level: 'high', text: 'Console MMC com script embutido.' });
      }
      if (!alerts.length) {
        alerts.push({ level: 'medium', text: 'Console MMC: abre ferramentas administrativas.' });
      }
      break;
    }
    case 'url':
      remote(iniValues(text, 'URL'), 'url');
      remote(iniValues(text, 'IconFile'), 'icon');
      break;
    case 'scf':
      remote(iniValues(text, 'IconFile'), 'icon');
      for (const c of iniValues(text, 'Command')) targets.add(c);
      if (!alerts.length) {
        alerts.push({ level: 'medium', text: 'Arquivo de comando do Explorer (.scf).' });
      }
      break;
    case 'library-ms':
    case 'search-ms':
      remote(
        [
          ...xmlValues(text, 'url'),
          ...xmlValues(text, 'simpleLocation'),
          ...xmlValues(text, 'scope'),
        ],
        'folder',
      );
      break;
    case 'appinstaller': {
      const uris = [...text.matchAll(/\bUri\s*=\s*"([^"]{1,2000})"/gi)].map((m) => m[1]);
      for (const u of uris) {
        targets.add(u);
        alerts.push({ level: 'high', text: `Instala pacote MSIX baixado de ${u}` });
      }
      break;
    }
    case 'iqy': {
      const url = /\S+:\/\/\S+/.exec(text)?.[0];
      if (url) {
        targets.add(url);
        alerts.push({
          level: 'high',
          text: `Consulta web do Excel: busca ${url} ao abrir (usada para entregar DDE).`,
        });
      }
      break;
    }
    case 'slk':
      if (/\bE(?:EXEC|CALL|REGISTER)\b|=\s*(?:EXEC|CALL|REGISTER)\s*\(/i.test(text)) {
        alerts.push({ level: 'high', text: 'Planilha SYLK com EXEC/CALL: roda comando ao abrir.' });
      } else {
        alerts.push({
          level: 'medium',
          text: 'Planilha SYLK (formato antigo usado para driblar filtros).',
        });
      }
      for (const m of text.matchAll(/(?:EXEC|CALL)\s*\(\s*"([^"]{1,500})"/gi)) targets.add(m[1]);
      break;
    case 'reg': {
      const keys = [...text.matchAll(/^\s*\[(-?HKEY_[^\]]{1,500})\]/gim)].map((m) => m[1]);
      const risky = keys.filter((k) =>
        /\\CurrentVersion\\Run(?:Once)?\b|Image File Execution Options|\\Winlogon\b|\\Policies\\Microsoft\\Windows Defender|\\Services\\/i.test(
          k,
        ),
      );
      for (const k of risky.slice(0, 5)) {
        alerts.push({ level: 'high', text: `Altera chave de inicialização ou de defesa: ${k}` });
      }
      if (!risky.length) {
        alerts.push({ level: 'info', text: `${keys.length} chave(s) do registro alterada(s).` });
      }
      keys.slice(0, MAX_TARGETS).forEach((k) => targets.add(k));
      break;
    }
    case 'inf':
      if (
        /^\s*(?:RegisterOCXs|UnRegisterOCXs|RunPreSetupCommands|RunPostSetupCommands)\s*=/im.test(
          text,
        )
      ) {
        alerts.push({
          level: 'high',
          text: 'INF com RegisterOCXs/RunPreSetupCommands: executa comando (abuso do cmstp).',
        });
      } else {
        alerts.push({ level: 'medium', text: 'Arquivo de instalação INF.' });
      }
      for (const m of text.matchAll(/(?:scrobj\.dll|https?:\/\/[^\s,"]+|\\\\[^\s,"]+)/gi))
        targets.add(m[0]);
      break;
    case 'sct':
      script = [...text.matchAll(/<script[^>]*>([\s\S]{0,200000}?)<\/script>/gi)]
        .map((m) => m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, ''))
        .join('\n');
      alerts.push({
        level: 'high',
        text: 'Scriptlet COM (.sct): roda script quando registrado (regsvr32 /i).',
      });
      break;
    case 'settingcontent':
      for (const d of xmlValues(text, 'DeepLink')) targets.add(d);
      alerts.push({
        level: 'high',
        text: 'Atalho de Configurações com DeepLink: executa o comando ao abrir.',
      });
      break;
  }
  return { format, alerts, targets: [...targets].slice(0, MAX_TARGETS), script: script || null };
}
