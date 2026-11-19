// Listas do LOLDrivers e do LOLRMM (Apache-2.0, magicsword-io), por scripts/vendor-lol.mjs.
import { LOLBINS, type LolUse } from './lolbins';
import DRIVERS from './loldrivers.json';
import RMM from './lolrmm.json';

/**
 * Abuso conhecido (plans/analise-estatica-ampliada, item 4):
 * - o driver e um dos do LOLDrivers (vulneravel, usado para desligar o antivirus, ou malicioso),
 *   pelo SHA-256 do arquivo ou pelo authentihash;
 * - o executavel e uma ferramenta de acesso remoto legitima do LOLRMM (AnyDesk, ScreenConnect...),
 *   pela versao, pelo assinante ou pelos dominios de rede da ferramenta nas strings;
 * - uma linha de comando usa um binario do sistema para baixar, executar ou decodificar carga.
 */

export interface LolDriverHit {
  id: string;
  category: 'malicious' | 'vulnerable';
  name: string;
  cves: string[];
  usecase: string;
  by: 'sha256' | 'authentihash';
}

export interface LolRmmHit {
  name: string;
  /** Como foi reconhecida: produto, nome original, assinante ou dominio. */
  by: 'product' | 'filename' | 'signer' | 'domain';
  evidence: string;
}

export interface LolBinHit {
  name: string;
  platform: 'windows' | 'linux';
  uses: LolUse[];
  /** O trecho da linha de comando (ate 200 caracteres). */
  evidence: string;
  url: string;
}

export interface LolInfo {
  driver: LolDriverHit | null;
  rmm: LolRmmHit[];
  lolbins: LolBinHit[];
  alerts: { level: 'high' | 'medium' | 'info'; text: string }[];
}

const DRIVER_TABLE = DRIVERS as unknown as {
  date: string;
  drivers: Omit<LolDriverHit, 'by'>[];
  hashes: Record<string, number>;
};
const RMM_TABLE = RMM as unknown as {
  date: string;
  tools: { name: string; files: string[]; products: string[]; domains: string[] }[];
};

/** Versao das listas, para o Status do sistema e a ficha. */
export const LOL_VERSIONS = { loldrivers: DRIVER_TABLE.date, lolrmm: RMM_TABLE.date };

const MAX_LOLBINS = 20;
const MAX_TEXT = 4 * 1024 * 1024;

/** Dominio do LOLRMM (com * de coringa) como regex de host. */
const domainRes = RMM_TABLE.tools.map((t) =>
  t.domains.map(
    (d) =>
      new RegExp(
        `^${d.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]{0,63}')}$`,
        'i',
      ),
  ),
);

export interface LolInput {
  sha256?: string | null;
  authentihash?: string | null;
  /** O executavel e um driver (subsistema nativo ou .sys). */
  driver?: boolean;
  version?: Record<string, string> | null;
  signer?: string | null;
  /** Hosts achados nas strings (dominios das URLs e dominios soltos). */
  hosts?: string[];
  /** Textos com linha de comando: script, camadas, atalho, acoes do MSI, strings. */
  texts?: string[];
}

export function lolOf(input: LolInput): LolInfo | null {
  let driver: LolDriverHit | null = null;
  for (const [by, hash] of [
    ['authentihash', input.authentihash],
    ['sha256', input.driver ? input.sha256 : null],
  ] as const) {
    const index = hash ? DRIVER_TABLE.hashes[hash.toLowerCase()] : undefined;
    if (index !== undefined && !driver) driver = { ...DRIVER_TABLE.drivers[index], by };
  }

  const rmm: LolRmmHit[] = [];
  const product = (input.version?.ProductName ?? '').trim().toLowerCase();
  const original = (input.version?.OriginalFilename ?? '').trim().toLowerCase();
  const signer = (input.signer ?? '').toLowerCase();
  const hosts = [...new Set((input.hosts ?? []).map((h) => h.toLowerCase()))].slice(0, 2000);
  RMM_TABLE.tools.forEach((tool, i) => {
    const name = tool.name.toLowerCase();
    const names = [name, ...tool.products.map((p) => p.toLowerCase())];
    let hit: LolRmmHit | null = null;
    if (product && names.some((n) => product === n || product.startsWith(`${n} `))) {
      hit = { name: tool.name, by: 'product', evidence: input.version!.ProductName };
    } else if (original && tool.files.includes(original)) {
      hit = { name: tool.name, by: 'filename', evidence: input.version!.OriginalFilename };
    } else if (signer && name.length >= 6 && new RegExp(`\\b${escapeRe(name)}\\b`).test(signer)) {
      hit = { name: tool.name, by: 'signer', evidence: input.signer! };
    } else {
      const host = hosts.find((h) => domainRes[i].some((re) => re.test(h)));
      if (host) hit = { name: tool.name, by: 'domain', evidence: host };
    }
    if (hit) rmm.push(hit);
  });

  const lolbins: LolBinHit[] = [];
  const text = (input.texts ?? []).join('\n').slice(0, MAX_TEXT);
  for (const bin of LOLBINS) {
    if (lolbins.length >= MAX_LOLBINS) break;
    const m = bin.re.exec(text);
    if (!m) continue;
    // A linha onde o abuso aparece, cortada.
    const start = Math.max(0, text.lastIndexOf('\n', m.index) + 1);
    const end = text.indexOf('\n', m.index + m[0].length);
    const line = text.slice(start, end < 0 ? undefined : end).trim();
    lolbins.push({
      name: bin.name,
      platform: bin.platform,
      uses: bin.uses,
      evidence: line.length > 200 ? `${m[0].slice(0, 200)}` : line,
      url: bin.url,
    });
  }

  const alerts: LolInfo['alerts'] = [];
  if (driver?.category === 'malicious') {
    alerts.push({
      level: 'high',
      text: `Driver malicioso conhecido (LOLDrivers): ${driver.name}.`,
    });
  } else if (driver) {
    alerts.push({
      level: 'high',
      text: `Driver vulnerável conhecido (LOLDrivers): ${driver.name}. É usado para desligar o antivírus a partir do kernel (BYOVD).`,
    });
  }
  for (const r of rmm.slice(0, 3)) {
    alerts.push({
      level: 'info',
      text: `Ferramenta de acesso remoto legítima (LOLRMM): ${r.name}. Entregue por e-mail ou link, é golpe comum.`,
    });
  }
  if (lolbins.length) {
    alerts.push({
      level: 'medium',
      text: `Binário do sistema usado para baixar ou executar carga: ${[...new Set(lolbins.map((b) => b.name))].join(', ')}.`,
    });
  }
  return driver || rmm.length || lolbins.length ? { driver, rmm, lolbins, alerts } : null;
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
