/**
 * Canais de exfiltracao e segredos (plans/analise-estatica-ampliada, item 3): para onde a amostra
 * manda o que rouba e com que credencial. Ladroes de senha (stealers) e RATs costumam levar o token
 * do bot do Telegram, o webhook do Discord ou o usuario e a senha do SMTP/FTP no proprio codigo; e
 * o achado mais util da analise, porque e o C2 e a prova ao mesmo tempo.
 *
 * As regras rodam sobre o texto de varias origens (strings, camadas de script, FLOSS, codigo do
 * ILSpy e do CFR, emulacao, configuracao do CAPE). Nada e consultado: um token da o controle do bot
 * a quem o usa. Os valores com credencial saem mascarados para quem nao e analista.
 */

export type ChannelKind =
  | 'telegram-bot'
  | 'telegram-chat'
  | 'discord-webhook'
  | 'slack-webhook'
  | 'webhook'
  | 'smtp'
  | 'smtp-credential'
  | 'ftp'
  | 'paste'
  | 'tunnel'
  | 'cloud-key';

export type ChannelSource =
  'strings' | 'script' | 'floss' | 'dotnet' | 'jar' | 'emulation' | 'config';

export interface Channel {
  kind: ChannelKind;
  /** O valor inteiro (URL, token, host, usuario:senha). */
  value: string;
  /** Host para os IOCs sugeridos, quando ha. */
  host: string | null;
  /** O valor da credencial no proprio canal (token, senha): sai mascarado para nao analistas. */
  credential: boolean;
  source: ChannelSource;
}

/** Por origem: chega de achados repetidos de um texto enorme. */
const MAX_PER_SOURCE = 100;
/** Texto lido por origem (o resto nao entra). */
const MAX_TEXT = 8 * 1024 * 1024;

interface Rule {
  kind: ChannelKind;
  re: RegExp;
  credential: boolean;
  /** O valor guardado e o host, a partir do que casou. */
  pick?: (m: RegExpExecArray) => { value: string; host: string | null };
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const RULES: Rule[] = [
  // Token de bot: id numerico, dois pontos, 35 caracteres comecando por AA.
  {
    kind: 'telegram-bot',
    re: /(?<!\d)\d{8,10}:AA[0-9A-Za-z_-]{33}(?![\w-])/g,
    credential: true,
    pick: (m) => ({ value: m[0], host: 'api.telegram.org' }),
  },
  {
    kind: 'telegram-chat',
    re: /chat_id["']?\s*[=:]\s*["']?(-?\d{5,15})\b/gi,
    credential: false,
    pick: (m) => ({ value: m[1], host: null }),
  },
  {
    kind: 'discord-webhook',
    re: /https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{60,80}/gi,
    credential: true,
  },
  {
    kind: 'slack-webhook',
    re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,12}\/B[A-Z0-9]{8,12}\/[A-Za-z0-9]{24}/g,
    credential: true,
  },
  {
    kind: 'webhook',
    re: /https?:\/\/(?:webhook\.site\/[0-9a-f-]{36}|[a-z0-9]+\.m\.pipedream\.net[^\s"'<>]*|[a-z0-9-]+\.requestcatcher\.com[^\s"'<>]*|webhook\.office\.com\/webhookb2\/[^\s"'<>]+)/gi,
    credential: false,
  },
  // SMTP: o host, e o usuario e a senha quando o codigo os passa juntos.
  {
    kind: 'smtp',
    re: /\bsmtp(?:-mail|out|\.mail)?\.(?:[a-z0-9-]{1,63}\.){1,4}[a-z]{2,24}\b/gi,
    credential: false,
    pick: (m) => ({ value: m[0].toLowerCase(), host: m[0].toLowerCase() }),
  },
  {
    kind: 'smtp-credential',
    re: /(?:NetworkCredential|PasswordAuthentication)\s*\(\s*"([^"\\]{3,100})"\s*,\s*"([^"\\]{1,100})"/g,
    credential: true,
    pick: (m) => ({ value: `${m[1]}:${m[2]}`, host: null }),
  },
  // FTP com usuario e senha na URL; FTP sem credencial e so o destino.
  {
    kind: 'ftp',
    re: /\bftps?:\/\/[^\s"'<>/@:]{1,64}(?::[^\s"'<>/@]{0,64})?@[a-z0-9.-]+(?::\d+)?[^\s"'<>]*/gi,
    credential: true,
  },
  {
    kind: 'ftp',
    re: /\bftps?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/[^\s"'<>]*)?/gi,
    credential: false,
  },
  {
    kind: 'paste',
    re: /https?:\/\/(?:pastebin\.com\/(?:raw\/)?[A-Za-z0-9]{8}|paste\.ee\/[rd]\/[A-Za-z0-9]+|rentry\.(?:co|org)\/[\w-]+(?:\/raw)?|hastebin\.com\/(?:raw\/)?[\w.]+|controlc\.com\/[0-9a-f]+|gist\.githubusercontent\.com\/[^\s"'<>]+|transfer\.sh\/[^\s"'<>]+|paste\.c-net\.org\/[^\s"'<>]+)/gi,
    credential: false,
  },
  {
    kind: 'tunnel',
    re: /\b(?:[a-z0-9-]{1,63}\.){1,4}(?:ngrok(?:-free)?\.(?:io|app|dev)|trycloudflare\.com|loca\.lt|serveo\.net|ply\.gg|portmap\.(?:io|host)|bore\.pub|localhost\.run|pinggy\.link)\b/gi,
    credential: false,
    pick: (m) => ({ value: m[0].toLowerCase(), host: m[0].toLowerCase() }),
  },
  // Chaves de nuvem e de API (AWS, Google, GitHub, Slack).
  {
    kind: 'cloud-key',
    re: /\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36}|xox[baprs]-[0-9A-Za-z-]{10,72})\b/g,
    credential: true,
    pick: (m) => ({ value: m[0], host: null }),
  },
];

/** Os canais num texto, sem repeticao (o mesmo valor do mesmo tipo vale uma vez). */
export function findChannels(text: string, source: ChannelSource): Channel[] {
  const body = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  const out: Channel[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(body)) && out.length < MAX_PER_SOURCE) {
      const picked = rule.pick ? rule.pick(m) : { value: m[0], host: host(m[0]) };
      const key = `${rule.kind === 'ftp' ? 'ftp' : rule.kind}\u0000${picked.value}`;
      // O FTP com credencial vem antes do sem: a mesma URL nao entra duas vezes.
      const loose = `ftp\u0000${picked.value.replace(/\/\/[^@/]+@/, '//')}`;
      if (seen.has(key) || (rule.kind === 'ftp' && !rule.credential && seen.has(loose))) continue;
      seen.add(key);
      if (rule.kind === 'ftp' && rule.credential) seen.add(loose);
      out.push({ kind: rule.kind, ...picked, credential: rule.credential, source });
    }
  }
  return out;
}

/** Junta os canais de varias origens: o mesmo valor do mesmo tipo fica com a primeira origem. */
export function mergeChannels(lists: Channel[][]): Channel[] {
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const c of lists.flat()) {
    const key = `${c.kind}\u0000${c.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** A credencial escondida: o comeco e o tamanho, para quem nao e analista. */
export function maskChannel(c: Channel): Channel {
  if (!c.credential) return c;
  const keep = c.kind === 'discord-webhook' || c.kind === 'slack-webhook' ? 48 : 6;
  return { ...c, value: `${c.value.slice(0, keep)}… (${c.value.length})` };
}

/** Canal que entrega dado a terceiro com credencial: o achado de alto risco. */
export const credentialed = (channels: Channel[]) => channels.filter((c) => c.credential);
