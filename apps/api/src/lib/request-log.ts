import type { FastifyRequest } from 'fastify';

/**
 * Pedido no log sem a query string (item 163): a busca, a consulta de indicador e o
 * link colado levam URLs de vitima, com token ou e-mail, e o log nao e lugar delas.
 */
export function requestLogSerializer(req: FastifyRequest) {
  return {
    method: req.method,
    url: req.url.split('?')[0],
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
