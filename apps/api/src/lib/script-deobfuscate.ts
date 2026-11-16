/**
 * Desofuscacao de scripts mais funda (plans/novas-analises, item 5). O script-analysis.ts desfaz as
 * camadas codificadas (Base64, -EncodedCommand, fromCharCode...); aqui ficam as transformacoes que
 * reescrevem o proprio texto: juntar literais concatenados, resolver o operador -f do PowerShell,
 * tirar os escapes (crase, circunflexo), expandir as variaveis do lote, inverter textos invertidos,
 * decodificar o Script Encoder (.vbe/.jse) e tentar XOR de um byte em blocos que nao sao texto.
 *
 * So texto: nada e executado. Cada transformacao e uma regex sem retrocesso quadratico (classes
 * negadas com tamanho limitado) aplicada ate o texto parar de mudar, com teto de passadas e de
 * tamanho.
 */

export type Flavor = 'powershell' | 'batch' | 'vbscript' | 'javascript';

/** Teto do texto normalizado e das passadas (cada passada aplica todas as transformacoes). */
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_PASSES = 8;
/** Literal que as regex juntam: limitado, para a busca nunca ficar quadratica. */
const LIT = 2000;

/** O que foi feito, para a tela ("Concatenação de literais", "Operador -f"...). */
export type Technique =
  | 'Crase de escape (PowerShell)'
  | 'Concatenação de literais'
  | 'Operador de formato -f'
  | '[char] e listas de códigos'
  | 'Substituição de texto (-replace/Replace)'
  | 'Texto invertido'
  | 'Variável com valor fixo'
  | 'Circunflexo de escape (lote)'
  | 'Variáveis do lote (set, %var:~a,b%)'
  | 'Escapes hexadecimais e Unicode (JavaScript)'
  | 'Chr() no meio do texto';

// ------------------------------------------------------------------ utilidades

/** Literal PowerShell em aspas simples (aspas internas dobradas). */
const psQuote = (s: string) => `'${s.replaceAll("'", "''")}'`;
/** Literal VBScript (aspas internas dobradas). */
const vbQuote = (s: string) => `"${s.replaceAll('"', '""')}"`;
/** Literal JavaScript em aspas simples. */
const jsQuote = (s: string) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

/** Conteudo de um literal PowerShell ('a''b' ou "a`"b") sem as aspas. */
function psUnquote(lit: string): string {
  const body = lit.slice(1, -1);
  return lit[0] === "'"
    ? body.replaceAll("''", "'")
    : body.replaceAll('`"', '"').replaceAll('""', '"');
}

/**
 * Literal PowerShell: aspas simples ou duplas sem interpolacao ($) nem subexpressao. So comeca
 * fora de uma sequencia de aspas e so termina numa aspa que nao e seguida de outra: sem isso, numa
 * fila de aspas ('''''...) cada posicao seria um comeco e cada tamanho um fim (medido: 18 s em
 * 200 mil aspas).
 */
const PS_LIT = `(?:(?<!')'(?:[^'\\n]|''){0,${LIT}}'(?!')|(?<!")"[^"$\`\\n]{0,${LIT}}"(?!"))`;
const psLitRe = (flags = 'g') => new RegExp(PS_LIT, flags);

/** Aplica `fn` ate o texto parar de mudar (ou o teto de passadas). */
function fixpoint(text: string, fn: (t: string) => string): string {
  for (let i = 0; i < MAX_PASSES; i++) {
    const next = fn(text);
    if (next === text || next.length > MAX_TEXT) return text;
    text = next;
  }
  return text;
}

const code = (n: string) => {
  const v = n.toLowerCase().startsWith('0x') ? parseInt(n, 16) : Number(n);
  return Number.isInteger(v) && v >= 0 && v <= 0x10ffff ? String.fromCodePoint(v) : null;
};

const codes = (list: string) => {
  const chars = list.split(',').map((n) => code(n.trim()));
  return chars.every((c) => c !== null) ? chars.join('') : null;
};

// ------------------------------------------------------------------ PowerShell

/**
 * Crase antes de letra fora de escape: `D`own`load`. A crase seguida de 0, a, b, e, f, n, r, t ou v
 * e um escape de verdade dentro de aspas duplas ("linha`n"); so sai quando a letra seguinte tambem
 * e de palavra (`n` no meio de `Dow`nload`).
 */
function psBackticks(text: string): string {
  return text.replace(/`([A-Za-z])(?=(\w?))/g, (m, ch: string, next: string) =>
    /[0abefnrtv]/.test(ch) && !next ? m : ch,
  );
}

/** 'a'+'b' -> 'ab' (tambem entre parenteses), e ('ab') -> 'ab' fora de chamada. */
function psConcat(text: string): string {
  const re = new RegExp(`(${PS_LIT})\\s*\\+\\s*(${PS_LIT})`, 'g');
  let out = fixpoint(text, (t) =>
    t.replace(re, (_m, a: string, b: string) => psQuote(psUnquote(a) + psUnquote(b))),
  );
  // Parenteses depois de nome, ponto, ] ou ) sao de chamada: ficam.
  out = out.replace(new RegExp(`(?<![\\w.\\])])\\(\\s*(${PS_LIT})\\s*\\)`, 'g'), '$1');
  return out;
}

/** "{1}{0}" -f 'load','Down' -> 'Download' (com ou sem parenteses em volta). */
function psFormat(text: string): string {
  const args = `((?:${PS_LIT}\\s*,\\s*){0,40}${PS_LIT})`;
  const fmt = `(${PS_LIT})\\s*-f\\s*${args}`;
  const apply = (_m: string, f: string, list: string) => {
    const values = [...list.matchAll(psLitRe())].map((v) => psUnquote(v[0]));
    let bad = false;
    const result = psUnquote(f).replace(
      /\{(\d{1,2})(?:,[^}]{0,10})?(?::[^}]{0,20})?\}/g,
      (_x, i: string) => {
        const v = values[Number(i)];
        if (v === undefined) bad = true;
        return v ?? '';
      },
    );
    return bad ? _m : psQuote(result.replaceAll('{{', '{').replaceAll('}}', '}'));
  };
  return (
    text
      // Parenteses de chamada (depois de nome, ponto, ] ou )) ficam: o -f vira o argumento.
      .replace(new RegExp(`(?<![\\w.\\])])\\(\\s*${fmt}\\s*\\)`, 'gi'), apply)
      .replace(new RegExp(fmt, 'gi'), apply)
  );
}

/** [char]72 -> 'H'; [char[]](72,101) -join '' -> 'He'; (72,101|%{[char]$_}) -join '' -> 'He'. */
function psChars(text: string): string {
  const num = '(?:0x[0-9a-f]{1,6}|\\d{1,7})';
  const list = `((?:${num}\\s*,\\s*){0,4000}${num})`;
  const join = `\\s*-join\\s*(?:''|"")`;
  const toText = (m: string, l: string) => {
    const s = codes(l);
    return s === null ? m : psQuote(s);
  };
  const arr = `\\[char\\[\\]\\]\\s*\\(\\s*${list}\\s*\\)`;
  // Com parenteses em volta (o -join pode ficar dentro ou fora) e sem eles.
  let out = text
    .replace(new RegExp(`(?:-join\\s*)?\\(\\s*${arr}(?:${join})?\\s*\\)(?:${join})?`, 'gi'), toText)
    .replace(new RegExp(`(?:-join\\s*)?${arr}(?:${join})?`, 'gi'), toText);
  out = out.replace(
    new RegExp(
      `(?:-join\\s*)?\\(\\s*\\(?\\s*${list}\\s*\\)?\\s*\\|\\s*(?:%|foreach(?:-object)?)\\s*\\{\\s*\\[char\\]\\s*(?:\\[int\\]\\s*)?\\$_\\s*\\}\\s*\\)(?:${join})?`,
      'gi',
    ),
    toText,
  );
  out = out.replace(
    new RegExp(`\\(?\\[char\\]\\s*(?:\\[int\\]\\s*)?(${num})\\)?`, 'gi'),
    (m, n: string) => {
      const c = code(n);
      return c === null ? m : psQuote(c);
    },
  );
  return out;
}

/** Regex do PowerShell como RegExp do JavaScript (sem diferenciar maiusculas), se for segura. */
function safeRegExp(pattern: string, flags: string): RegExp | null {
  // Quantificador aninhado ((a+)+) e referencia para tras: fora (podem custar muito).
  if (pattern.length > 200 || /\([^)]*[+*][^)]*\)[+*{]|\\\d/.test(pattern)) return null;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/** 'aXb' -replace 'X','' e 'aXb'.Replace('X','') sobre literais. */
function psReplace(text: string): string {
  const re = new RegExp(
    `(${PS_LIT})\\s*-(c?)replace\\s*(${PS_LIT})\\s*(?:,\\s*(${PS_LIT}))?`,
    'gi',
  );
  let out = text.replace(re, (m, src: string, c: string, pat: string, rep?: string) => {
    const rx = safeRegExp(psUnquote(pat), c ? 'g' : 'gi');
    if (!rx) return m;
    // No PowerShell, $1 e ${nome} referem grupos, como no JavaScript.
    return psQuote(psUnquote(src).replace(rx, rep ? psUnquote(rep) : ''));
  });
  out = out.replace(
    new RegExp(`(${PS_LIT})\\.replace\\(\\s*(${PS_LIT})\\s*,\\s*(${PS_LIT})\\s*\\)`, 'gi'),
    (_m, src: string, a: string, b: string) =>
      psQuote(psUnquote(src).split(psUnquote(a)).join(psUnquote(b))),
  );
  return out;
}

/** -join 'cba'[-1..-3]; 'cba'[-1..-n] -join ''; [regex]::Matches('cba','.','RightToLeft'). */
function psReverse(text: string): string {
  const rev = (lit: string) => psQuote([...psUnquote(lit)].reverse().join(''));
  const idx = `(${PS_LIT})\\s*\\[\\s*-1\\s*\\.\\.\\s*-?\\(?[^\\]\\n]{1,60}\\]`;
  const join = `(?:\\s*-join\\s*(?:''|""))?`;
  let out = text
    .replace(
      new RegExp(`(?:-join\\s*)?\\(\\s*${idx}${join}\\s*\\)${join}`, 'gi'),
      (_m, lit: string) => rev(lit),
    )
    .replace(new RegExp(`(?:-join\\s*)?${idx}${join}`, 'gi'), (_m, lit: string) => rev(lit));
  out = out.replace(
    new RegExp(
      `(?:-join\\s*)?\\(?\\s*\\[regex\\]::matches\\(\\s*(${PS_LIT})\\s*,\\s*['"]\\.['"]\\s*,\\s*['"]righttoleft['"]\\s*\\)\\s*\\)?(?:\\s*-join\\s*(?:''|""))?`,
      'gi',
    ),
    (_m, lit: string) => rev(lit),
  );
  return out;
}

/**
 * Variavel atribuida uma vez so, com um literal: $a='Down'; ... $a -> 'Down'. Dentro de aspas duplas
 * vira o texto ("$a" -> "Down"); a propria atribuicao fica.
 */
function psVariables(text: string): string {
  const assigned = new Map<string, string | null>();
  for (const m of text.matchAll(
    new RegExp(`\\$(\\w{1,60})\\s*=\\s*(${PS_LIT})\\s*(?=[;\\n\\r]|$)`, 'g'),
  )) {
    const name = m[1].toLowerCase();
    assigned.set(name, assigned.has(name) ? null : psUnquote(m[2]));
  }
  // Atribuida tambem de outro jeito ($a += ..., $a = $b): nao e fixa.
  for (const m of text.matchAll(/\$(\w{1,60})\s*(?:[+\-*/]?=)(?!=)/g)) {
    const name = m[1].toLowerCase();
    if (!assigned.has(name)) continue;
    const isLiteral = new RegExp(`^\\$\\w+\\s*=\\s*${PS_LIT}\\s*(?:[;\\n\\r]|$)`).test(
      text.slice(m.index, m.index + LIT + 100),
    );
    if (!isLiteral) assigned.set(name, null);
  }
  const fixed = new Map([...assigned].filter((e): e is [string, string] => e[1] !== null));
  if (!fixed.size || [...fixed.keys()].every((k) => k.length < 1)) return text;
  const auto = new Set(['_', 'true', 'false', 'null', 'args', 'input', 'this', 'env', 'pshome']);
  let out = '';
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && text[i - 1] !== '`') inDouble = !inDouble;
    if (ch === '$' && !inSingle) {
      const m = /^\$(\w{1,60})/.exec(text.slice(i, i + 62));
      const name = m?.[1].toLowerCase();
      if (m && name && fixed.has(name) && !auto.has(name)) {
        const rest = text.slice(i + m[0].length, i + m[0].length + 4);
        // A atribuicao fica; o uso vira o valor.
        if (!/^\s*[+\-*/]?=(?!=)/.test(rest)) {
          out += inDouble ? fixed.get(name)!.replaceAll('"', '`"') : psQuote(fixed.get(name)!);
          i += m[0].length - 1;
          continue;
        }
      }
    }
    out += ch;
  }
  return out;
}

// ------------------------------------------------------------------ lote (BAT/CMD)

/** Variaveis de ambiente de um Windows 10/11 comum: o lote ofuscado fatia estas. */
const WINDOWS_ENV: Record<string, string> = {
  allusersprofile: 'C:\\ProgramData',
  commonprogramfiles: 'C:\\Program Files\\Common Files',
  comspec: 'C:\\WINDOWS\\system32\\cmd.exe',
  os: 'Windows_NT',
  pathext: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
  processor_architecture: 'AMD64',
  programdata: 'C:\\ProgramData',
  programfiles: 'C:\\Program Files',
  'programfiles(x86)': 'C:\\Program Files (x86)',
  public: 'C:\\Users\\Public',
  systemdrive: 'C:',
  systemroot: 'C:\\WINDOWS',
  windir: 'C:\\WINDOWS',
};

/** Teto de uma linha de comando do cmd. */
const BATCH_LINE_MAX = 8191;

/** %var:~a,b%: fatia como o cmd (inicio negativo conta do fim; tamanho negativo corta do fim). */
function batchSlice(value: string, start: number, length?: number): string {
  const n = value.length;
  let s = start < 0 ? Math.max(0, n + start) : Math.min(start, n);
  if (length === undefined) return value.slice(s);
  const e = length < 0 ? n + length : s + length;
  if (e < s) s = e;
  return value.slice(s, Math.max(s, e));
}

/** %var%, %var:~a,b%, %var:x=y% e !var! com o ambiente atual; desconhecida fica como esta. */
function batchExpand(line: string, env: Map<string, string>): string {
  const lookup = (name: string) => env.get(name.toLowerCase()) ?? WINDOWS_ENV[name.toLowerCase()];
  // Teto do que a expansao acrescenta: passou, o resto fica como esta (a linha volta inteira).
  let budget = BATCH_LINE_MAX;
  const spend = (m: string, value: string) => {
    budget -= value.length;
    return budget < 0 ? m : value;
  };
  return line.replace(
    /([%!])([A-Za-z_][\w()#$@.-]{0,60})(?::(?:~(-?\d{1,4})(?:,(-?\d{1,4}))?|(\*?)([^=%!\r\n]{1,60})=([^%!\r\n]{0,60})))?\1/g,
    (
      m,
      _d,
      name: string,
      start?: string,
      len?: string,
      star?: string,
      from?: string,
      to?: string,
    ) => {
      const value = lookup(name);
      if (value === undefined || budget < 0) return m;
      if (start !== undefined) {
        return spend(
          m,
          batchSlice(value, Number(start), len === undefined ? undefined : Number(len)),
        );
      }
      if (from !== undefined) {
        if (star) {
          const at = value.toLowerCase().indexOf(from.toLowerCase());
          return spend(m, at < 0 ? value : (to ?? '') + value.slice(at + from.length));
        }
        const rx = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        return spend(
          m,
          value.replace(rx, () => to ?? ''),
        );
      }
      return spend(m, value);
    },
  );
}

/** Circunflexo fora de aspas (p^o^w^e^r -> power); ^^ vira ^. */
function batchCarets(line: string): string {
  let out = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    if (ch === '^' && !quoted && i + 1 < line.length) {
      out += line[i + 1];
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Linha a linha: tira os circunflexos, expande as variaveis e grava os `set` no ambiente. */
function batchNormalize(text: string, used: Set<Technique>): string {
  const env = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines.slice(0, 20_000)) {
    let line = raw;
    const unescaped = batchCarets(line);
    if (unescaped !== line) used.add('Circunflexo de escape (lote)');
    line = unescaped;
    // Expansao em mais de uma rodada: %a:~%b%,1% e variaveis que montam nomes. A linha do cmd tem
    // teto de 8191 caracteres: uma variavel que se repete (set a=%a%%a%) para ai.
    const expanded = fixpoint(line, (l) => {
      const next = batchExpand(l, env);
      return next.length > BATCH_LINE_MAX ? l : next;
    });
    if (expanded !== line) used.add('Variáveis do lote (set, %var:~a,b%)');
    line = expanded;
    const set =
      /^\s*@?set\s+(?!\/[ap]\b)(?:"([^=\r\n"]{1,60})=([^"\r\n]*)"|([^=\s"]{1,60})=(.*))\s*$/i.exec(
        line,
      );
    if (set) env.set((set[1] ?? set[3]).toLowerCase(), set[1] !== undefined ? set[2] : set[4]);
    out.push(line);
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ VBScript

const VB_LIT = `(?<!")"(?:[^"\\n]|""){0,${LIT}}"(?!")`;
const vbUnquote = (lit: string) => lit.slice(1, -1).replaceAll('""', '"');

function vbNormalize(text: string, used: Set<Technique>): string {
  const step = (t: string) => {
    let out = t.replace(/\bchrw?\s*\(\s*(\d{1,5}|&h[0-9a-f]{1,4})\s*\)/gi, (m, n: string) => {
      const c = code(n.toLowerCase().startsWith('&h') ? `0x${n.slice(2)}` : n);
      if (c === null) return m;
      used.add('Chr() no meio do texto');
      return vbQuote(c);
    });
    const concat = out.replace(
      new RegExp(`(${VB_LIT})\\s*[&+]\\s*(${VB_LIT})`, 'g'),
      (_m, a: string, b: string) => vbQuote(vbUnquote(a) + vbUnquote(b)),
    );
    if (concat !== out) used.add('Concatenação de literais');
    out = concat;
    const rev = out.replace(
      new RegExp(`\\bstrreverse\\s*\\(\\s*(${VB_LIT})\\s*\\)`, 'gi'),
      (_m, a: string) => vbQuote([...vbUnquote(a)].reverse().join('')),
    );
    if (rev !== out) used.add('Texto invertido');
    out = rev;
    const rep = out.replace(
      new RegExp(
        `\\breplace\\s*\\(\\s*(${VB_LIT})\\s*,\\s*(${VB_LIT})\\s*,\\s*(${VB_LIT})\\s*\\)`,
        'gi',
      ),
      (_m, s: string, a: string, b: string) =>
        vbQuote(vbUnquote(s).split(vbUnquote(a)).join(vbUnquote(b))),
    );
    if (rep !== out) used.add('Substituição de texto (-replace/Replace)');
    return rep.replace(new RegExp(`(?<![\\w.)])\\(\\s*(${VB_LIT})\\s*\\)`, 'g'), '$1');
  };
  return fixpoint(text, step);
}

// ------------------------------------------------------------------ JavaScript

const JS_LIT = `(?:'(?:[^'\\\\\\n]|\\\\.){0,${LIT}}'|"(?:[^"\\\\\\n]|\\\\.){0,${LIT}}")`;

/** Conteudo de um literal JavaScript, com os escapes resolvidos. */
function jsUnquote(lit: string): string {
  return lit
    .slice(1, -1)
    .replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F]{1,6}\}|.)/g, (_m, e: string) => {
      if (e.length > 1 && e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
      if (e.length > 1 && e[0] === 'u') {
        const cp = parseInt(e.replace(/[u{}]/g, ''), 16);
        return cp <= 0x10ffff ? String.fromCodePoint(cp) : e;
      }
      return ({ n: '\n', r: '\r', t: '\t', '0': '\0' } as Record<string, string>)[e] ?? e;
    });
}

function jsNormalize(text: string, used: Set<Technique>): string {
  // Escapes \x41 e \u0041 dentro dos literais: o texto fica legivel.
  const unescaped = text.replace(new RegExp(JS_LIT, 'g'), (lit) =>
    /\\[xu]/.test(lit) ? jsQuote(jsUnquote(lit)) : lit,
  );
  if (unescaped !== text) used.add('Escapes hexadecimais e Unicode (JavaScript)');
  const step = (t: string) => {
    const concat = t.replace(
      new RegExp(`(${JS_LIT})\\s*\\+\\s*(${JS_LIT})`, 'g'),
      (_m, a: string, b: string) => jsQuote(jsUnquote(a) + jsUnquote(b)),
    );
    if (concat !== t) used.add('Concatenação de literais');
    const rev = concat.replace(
      new RegExp(
        `(${JS_LIT})\\.split\\(\\s*(?:''|"")\\s*\\)\\.reverse\\(\\s*\\)\\.join\\(\\s*(?:''|"")\\s*\\)`,
        'g',
      ),
      (_m, a: string) => jsQuote([...jsUnquote(a)].reverse().join('')),
    );
    if (rev !== concat) used.add('Texto invertido');
    const rep = rev.replace(
      new RegExp(
        `(${JS_LIT})\\.replace(?:All)?\\(\\s*(?:/((?:[^/\\\\\\n]|\\\\.){1,200})/([gimsuy]{0,6})|(${JS_LIT}))\\s*,\\s*(${JS_LIT})\\s*\\)`,
        'g',
      ),
      (m, src: string, re?: string, flags?: string, lit?: string, to?: string) => {
        const value = jsUnquote(src);
        const target = jsUnquote(to!);
        if (lit !== undefined) return jsQuote(value.split(jsUnquote(lit)).join(target));
        const rx = safeRegExp(re!, flags ?? '');
        return rx ? jsQuote(value.replace(rx, target)) : m;
      },
    );
    if (rep !== rev) used.add('Substituição de texto (-replace/Replace)');
    return rep.replace(new RegExp(`(?<![\\w.\\])$])\\(\\s*(${JS_LIT})\\s*\\)`, 'g'), '$1');
  };
  return fixpoint(unescaped, step);
}

// ------------------------------------------------------------------ entrada

/** Sabor do texto para a normalizacao: pela linguagem do arquivo ou, numa camada, pelo conteudo. */
export function flavorOf(text: string, language: Flavor | 'hta' | null): Flavor {
  const head = text.slice(0, 4000);
  if (/(?:^|\s)-join\b|\[char\]|\$\w+\s*=|\binvoke-|\biex\b|-bxor\b|\bnew-object\b/i.test(head))
    return 'powershell';
  if (language === 'hta') return /<script[^>]*vbscript/i.test(head) ? 'vbscript' : 'javascript';
  if (language) return language;
  if (/^\s*@?(?:echo\s+off|set\s)/im.test(head)) return 'batch';
  if (/\bdim\s|\bcreateobject\s*\(|\bchrw?\s*\(\s*\d/i.test(head)) return 'vbscript';
  return 'javascript';
}

export interface Normalized {
  text: string;
  techniques: Technique[];
}

/**
 * Reescreve o texto sem a ofuscacao que nao e codificacao. Devolve o texto e as tecnicas que
 * mudaram alguma coisa (lista vazia: nada a fazer).
 */
export function normalizeScript(source: string, flavor: Flavor): Normalized {
  const used = new Set<Technique>();
  let text = source.slice(0, MAX_TEXT);
  const track = (name: Technique, fn: (t: string) => string) => {
    const next = fn(text);
    if (next !== text && next.length <= MAX_TEXT) {
      used.add(name);
      text = next;
    }
  };
  if (flavor === 'powershell') {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const before = text;
      track('Crase de escape (PowerShell)', psBackticks);
      track('[char] e listas de códigos', psChars);
      track('Concatenação de literais', psConcat);
      track('Operador de formato -f', psFormat);
      track('Substituição de texto (-replace/Replace)', psReplace);
      track('Texto invertido', psReverse);
      track('Concatenação de literais', psConcat);
      track('Variável com valor fixo', psVariables);
      if (text === before) break;
    }
  } else if (flavor === 'batch') {
    text = batchNormalize(text, used);
  } else if (flavor === 'vbscript') {
    text = vbNormalize(text, used);
  } else {
    text = jsNormalize(text, used);
  }
  return { text, techniques: [...used] };
}

// ------------------------------------------------------------------ Script Encoder (.vbe/.jse)

/**
 * Tabelas do decodificador do Script Encoder da Microsoft (screnc), dos caracteres 9 a 127: cada
 * posicao usa uma das tres, na sequencia de 64 abaixo. Os valores sao os do decode-vbe.py de Didier
 * Stevens (dominio publico).
 */
const SE_TABLES = [
  '574a0b0c4a0e0f101112131415161718191a1b1c1d1e1f2e477a56426a2f26494134325b7672433839704568714f09624423754a7e4a5e40774a615d224b6f4e3b4c50672a7d74542b2d2c306e6b66352521644d52633f7b7829287359337f6d55537c3a5f65465831696c5a48275c3d24793760512036',
  '6e4c0b0c4c0e0f101112131415161718191a1b1c1d1e1f2d755260715e495c627d2936207c7a7f6b63332b68516676316454434c3a4c7e4c452c2a7427374479592f6f26726a397b3f387767534734785d30235a5b6c485570692e4c21244e5009567335614b583b57226d4d2528464a32413d5f4f4265',
  '7b410b0c410e0f101112131415161718191a1b1c1d1e1f323021295b38333d583a3565395c5673664e456b6259785e7d4a6d714160415340422748727531374d5222546a47642d207f2e4c5d7e6c6f797443267625242b28234134092a443f773b55696163506751494f46687c36706e7a2f5f4b5a2c57',
].map((hex) => Buffer.from(hex, 'hex'));
const SE_PICK = '0120121221210212021200122102122100212120200120210212001220012021';

/** Decodifica um bloco #@~^XXXXXX==...XXXXXX==^#~@; null se nao houver bloco. */
export function decodeScriptEncoder(text: string): string | null {
  const m = /#@~\^[\w+/]{6}==([\s\S]{1,2000000}?)[\w+/]{6}==\^#~@/.exec(text);
  if (!m) return null;
  const data = m[1]
    .replaceAll('@&', '\n')
    .replaceAll('@#', '\r')
    .replaceAll('@*', '>')
    .replaceAll('@!', '<')
    .replaceAll('@$', '@');
  let out = '';
  let index = -1;
  for (const ch of data) {
    const byte = ch.charCodeAt(0);
    if (byte < 128) index++;
    if ((byte === 9 || (byte > 31 && byte < 128)) && byte !== 60 && byte !== 62 && byte !== 64) {
      const table = SE_TABLES[Number(SE_PICK[index % 64])];
      out += String.fromCharCode(table[byte - 9]);
    } else {
      out += ch;
    }
  }
  return out;
}

/** O inverso (so para os testes): codifica um texto como o screnc. */
export function encodeScriptEncoder(plain: string): string {
  let out = '';
  let index = -1;
  for (const ch of plain) {
    const byte = ch.charCodeAt(0);
    if (byte < 128) index++;
    if ((byte === 9 || (byte > 31 && byte < 128)) && byte !== 60 && byte !== 62 && byte !== 64) {
      const table = SE_TABLES[Number(SE_PICK[index % 64])];
      const enc = table.indexOf(byte);
      out += enc < 0 ? ch : String.fromCharCode(enc + 9);
    } else if (ch === '\n') out += '@&';
    else if (ch === '\r') out += '@#';
    else if (ch === '>') out += '@*';
    else if (ch === '<') out += '@!';
    else if (ch === '@') out += '@$';
    else out += ch;
  }
  return `#@~^AAAAAA==${out}AAAAAA==^#~@`;
}

// ------------------------------------------------------------------ XOR de um byte

const INTERESTING =
  /https?:\/\/|powershell|cmd(?:\.exe)?\s|wscript|createobject|invoke-|downloadstring|\.exe\b|function\s|\$\w+\s*=/i;

/** Proporcao de caracteres imprimiveis. */
function printable(bytes: Uint8Array): number {
  let ok = 0;
  const n = Math.min(bytes.length, 4000);
  for (let i = 0; i < n; i++) {
    const c = bytes[i];
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) ok++;
  }
  return n ? ok / n : 0;
}

/**
 * Bytes que viram script com XOR de um byte so (chave de 1 a 255): texto imprimivel com cara de
 * script (URL, comando, funcao). Os bytes podem parecer texto antes (XOR com chave alta costuma
 * dar caracteres imprimiveis), por isso o teste e o "cara de script" e nao so o imprimivel.
 * Devolve a chave e o texto, ou null.
 */
export function singleByteXor(bytes: Uint8Array): { key: number; text: string } | null {
  if (bytes.length < 16) return null;
  // Ja e script legivel: nada a desfazer.
  if (
    printable(bytes) > 0.95 &&
    INTERESTING.test(Buffer.from(bytes.subarray(0, 4000)).toString('latin1'))
  ) {
    return null;
  }
  const sample = bytes.subarray(0, 4000);
  for (let key = 1; key < 256; key++) {
    const x = Uint8Array.from(sample, (b) => b ^ key);
    if (printable(x) < 0.95) continue;
    const full = Buffer.from(Uint8Array.from(bytes.subarray(0, MAX_TEXT), (b) => b ^ key)).toString(
      'latin1',
    );
    if (INTERESTING.test(full)) return { key, text: full };
  }
  return null;
}
