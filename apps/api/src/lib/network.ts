import net from 'node:net';

import { env } from '../env';

/**
 * De quem a API aceita conexao e o X-Forwarded-For.
 *
 * A API fica em duas redes do compose: a `deeplook` (nginx, banco, MinIO, ClamAV) e a
 * `capture`, onde mora o navegador isolado que abre paginas maliciosas. Confiar em qualquer
 * endereco privado (o padrao antigo) deixava esse navegador, se comprometido, falar com a API
 * sem passar pelo nginx e trocar o X-Forwarded-For a cada pedido, furando o limite de login
 * por IP (vuln-0008 do Strix).
 *
 * Com TRUSTED_NETWORK (a sub-rede fixa da `deeplook` no compose), so o loopback e essa faixa
 * informam o IP do cliente, e qualquer outra conexao e derrubada antes de o HTTP ser lido: a
 * API continua chamando o `capture`, mas o `capture` deixa de alcancar a API. Vazio, vale o
 * comportamento antigo (desenvolvimento e testes), e o status do sistema avisa.
 */

/** Padrao antigo, sem faixa definida: proxy em qualquer rede privada. */
const LEGACY_TRUST = 'loopback,linklocal,uniquelocal';
const LOG_EVERY_MS = 60_000;

type Logger = { warn: (obj: object, msg: string) => void };

export type NetworkPolicy = {
  /** As faixas confiaveis, alem do loopback (vazio = modo antigo). */
  networks: string[];
  /** Valor para o `trustProxy` do Fastify. */
  trustProxy: string;
  /** A conexao deste endereco e aceita? */
  allows: (address: string | undefined) => boolean;
  /** Derruba, no servidor, as conexoes de fora das faixas (nada a fazer no modo antigo). */
  guard: (server: net.Server, log: Logger) => void;
};

function splitCidr(cidr: string): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } {
  const [address, prefixText] = cidr.split('/');
  const family = net.isIP(address) === 6 ? 'ipv6' : 'ipv4';
  const prefix = prefixText === undefined ? (family === 'ipv6' ? 128 : 32) : Number(prefixText);
  return { address, prefix, family };
}

/**
 * Monta a politica a partir das faixas (CIDR separadas por virgula). `loopback: false` so
 * existe para os testes conseguirem ver uma conexao recusada a partir do 127.0.0.1.
 */
export function networkPolicy(value: string, { loopback = true } = {}): NetworkPolicy {
  const networks = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!networks.length) {
    return { networks, trustProxy: LEGACY_TRUST, allows: () => true, guard: () => undefined };
  }

  const list = new net.BlockList();
  if (loopback) {
    list.addSubnet('127.0.0.0', 8, 'ipv4');
    list.addAddress('::1', 'ipv6');
  }
  for (const cidr of networks) {
    const { address, prefix, family } = splitCidr(cidr);
    list.addSubnet(address, prefix, family);
  }
  const allows = (address: string | undefined) => {
    if (!address) return false;
    // Servidor em IPv4 e IPv6 ao mesmo tempo entrega o IPv4 como ::ffff:a.b.c.d.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    if (mapped) return list.check(mapped, 'ipv4');
    const family = net.isIP(address);
    if (!family) return false;
    return list.check(address, family === 6 ? 'ipv6' : 'ipv4');
  };

  let lastLog = 0;
  const guard = (server: net.Server, log: Logger) => {
    server.on('connection', (socket: net.Socket) => {
      if (allows(socket.remoteAddress)) return;
      // Uma linha por minuto basta: um container comprometido insistindo encheria o log.
      if (Date.now() - lastLog >= LOG_EVERY_MS) {
        lastLog = Date.now();
        log.warn(
          { peer: socket.remoteAddress, trusted: networks },
          '[rede] conexao recusada: fora da rede confiavel (TRUSTED_NETWORK)',
        );
      }
      socket.destroy();
    });
  };

  const trusted = [...(loopback ? ['loopback'] : []), ...networks];
  return { networks, trustProxy: trusted.join(','), allows, guard };
}

/** A politica da API, lida do ambiente. */
export const network = networkPolicy(env.TRUSTED_NETWORK);
