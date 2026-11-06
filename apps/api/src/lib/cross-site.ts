import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Pedido que muda estado vindo de outro site (CSRF).
 *
 * O cookie da sessao e SameSite=Lax, o que barra outro dominio, mas nao outro subdominio do
 * mesmo dominio: atras do Cloudflare Tunnel, qualquer servico do homelab em *.seu-dominio.com
 * e "same-site". De la, um formulario multipart (que nem pede preflight de CORS) enviaria uma
 * amostra em nome de quem estiver logado, e um WebSocket abriria o console do sandbox.
 *
 * O navegador informa a origem do pedido em Sec-Fetch-Site, que pagina nenhuma consegue
 * alterar. Recusamos tudo o que nao for GET/HEAD/OPTIONS, e todo WebSocket, quando ele disser
 * `same-site` ou `cross-site`. Sem o cabecalho (scripts com token de API, curl, navegador muito
 * antigo) o pedido passa: nesses casos nao ha cookie de outro site para abusar, ou o SameSite
 * continua cobrindo o resto.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SAME_ORIGIN = new Set(['same-origin', 'none']);

export const CROSS_SITE_ERROR = 'Pedido de outro site recusado.';

/** O pedido veio de outro site e nao pode passar? */
export function isCrossSiteWrite(req: Pick<FastifyRequest, 'method' | 'headers'>): boolean {
  const site = req.headers['sec-fetch-site'];
  if (typeof site !== 'string' || SAME_ORIGIN.has(site.toLowerCase())) return false;
  const websocket = String(req.headers.upgrade ?? '').toLowerCase() === 'websocket';
  return websocket || !SAFE_METHODS.has(req.method);
}

/** Liga a checagem em todas as rotas da instancia (chamar na raiz, antes das rotas). */
export function installCrossSiteGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!isCrossSiteWrite(req)) return;
    req.log.warn(
      { site: req.headers['sec-fetch-site'], method: req.method },
      '[csrf] pedido de outro site recusado',
    );
    return reply.code(403).send({ error: CROSS_SITE_ERROR, code: 'CROSS_SITE' });
  });
}
