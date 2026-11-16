import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { env } from './env';
import { TRUST_PROXY } from './lib/auth';
import { installCrossSiteGuard } from './lib/cross-site';
import { registerErrorLanguage } from './lib/error-language';
import { network, type NetworkPolicy } from './lib/network';
import { requestLogSerializer } from './lib/request-log';
import { isMissingObject, MISSING_OBJECT_MESSAGE } from './lib/s3';
import { adminRoutes } from './routes/admin';
import { aiDraftRoutes } from './routes/ai-draft';
import { allowlistRoutes } from './routes/allowlist';
import { antivirusRoutes } from './routes/antivirus';
import { apiTokenRoutes } from './routes/api-tokens';
import { assignmentRoutes } from './routes/assignment';
import { attackRoutes } from './routes/attack';
import { authRoutes } from './routes/auth';
import { backupRoutes } from './routes/backups';
import { broadcastRoutes } from './routes/broadcasts';
import { capaRoutes } from './routes/capa';
import { captureRoutes } from './routes/captures';
import { caseRoutes } from './routes/cases';
import { companyDomainRoutes } from './routes/company-domains';
import { compareRoutes } from './routes/compare';
import { dashboardRoutes } from './routes/dashboard';
import { dotnetRoutes } from './routes/dotnet';
import { duplicateRoutes } from './routes/duplicates';
import { entryRoutes } from './routes/entries';
import { evidenceRoutes } from './routes/evidence';
import { favoritesRoutes } from './routes/favorites';
import { feedRoutes } from './routes/feeds';
import { ghidraRoutes } from './routes/ghidra';
import { graphRoutes } from './routes/graph';
import { healthRoutes } from './routes/health';
import { hexRoutes } from './routes/hex';
import { iocImportRoutes } from './routes/ioc-import';
import { iocRoutes } from './routes/iocs';
import { kbRoutes } from './routes/kb';
import { managementRoutes } from './routes/management';
import { meRoutes } from './routes/me';
import { monitorRoutes } from './routes/monitor';
import { notificationRoutes } from './routes/notifications';
import { oletoolsRoutes } from './routes/oletools';
import { openApiRoutes } from './routes/openapi';
import { qrRoutes } from './routes/qr';
import { relatedRoutes } from './routes/related';
import { reportRoutes } from './routes/reports';
import { reputationRoutes } from './routes/reputation';
import { riskRoutes } from './routes/risk';
import { sandboxRoutes } from './routes/sandbox';
import { sandboxHuntRoutes } from './routes/sandbox-hunt';
import { searchRoutes } from './routes/search';
import { serviceAnalysisRoutes } from './routes/service-analysis';
import { sessionRoutes } from './routes/sessions';
import { settingsRoutes } from './routes/settings';
import { sigmaRoutes } from './routes/sigma';
import { statusRoutes } from './routes/status';
import { teamViewRoutes } from './routes/team-views';
import { templateRoutes } from './routes/templates';
import { trashRoutes } from './routes/trash';
import { triageRuleRoutes } from './routes/triage-rules';
import { twoFactorRoutes } from './routes/two-factor';
import { unpackRoutes } from './routes/unpack';
import { yaraRoutes } from './routes/yara';

/**
 * Montagem do app (plano pos-revisao, item 1.3): o mesmo para a producao (src/index.ts) e para os
 * testes de integracao. Antes, cada teste montava a sua versao, so com as rotas que usava e sem
 * os ganchos globais (idioma dos erros, pedido de outro site, tratador de erro, 404): o que valia
 * em producao podia nao valer no teste.
 *
 * So monta e registra. Quem chama decide o resto: o index.ts liga o logger dos trabalhos de
 * fundo, roda as tarefas de partida, chama o `listen` e inicia as filas; os testes usam `inject`.
 */

/** Rotas da API, na ordem em que sao registradas. */
export const ROUTES: ((app: FastifyInstance) => Promise<void>)[] = [
  // Liveness (/api/health) e readiness (/api/health/ready), item 1.2.
  healthRoutes,

  authRoutes,
  meRoutes,
  sessionRoutes,
  favoritesRoutes,
  relatedRoutes,
  // Mapa de relacoes (item 91).
  graphRoutes,
  // Dominios parecidos com os da empresa (item 92).
  companyDomainRoutes,
  // Documentacao da API (item 93).
  openApiRoutes,
  // Backup em ZIP (item 81).
  backupRoutes,
  // Status do sistema por maquina, com token de escopo STATUS (item 3.2).
  statusRoutes,
  monitorRoutes,
  // Configuracoes do sistema (item 140).
  settingsRoutes,
  iocRoutes,
  notificationRoutes,
  templateRoutes,
  duplicateRoutes,
  dashboardRoutes,
  entryRoutes,
  reportRoutes,
  evidenceRoutes,
  // Regras de triagem (item 86).
  triageRuleRoutes,
  // Avisos gerais (item 88).
  broadcastRoutes,
  // Atribuicao automatica (item 72).
  assignmentRoutes,
  // Captura da pagina de um link (item 80).
  captureRoutes,
  capaRoutes,
  ghidraRoutes,
  unpackRoutes,
  // Office e PDF mais fundo (item 7.14).
  oletoolsRoutes,
  serviceAnalysisRoutes,
  aiDraftRoutes,
  // QR code em imagens, PDFs e no print da pagina (plano pos-revisao, item 2.2).
  qrRoutes,
  // Relatorio gerencial (item 77).
  managementRoutes,
  // Importar indicadores (item 78).
  iocImportRoutes,
  // Feed de indicadores (item 5.3): TAXII 2.1 e feed MISP, para um TIP ou SIEM buscar.
  feedRoutes,
  reputationRoutes,
  // Pontuacao de risco explicavel (item 7.5).
  riskRoutes,
  antivirusRoutes,
  attackRoutes,
  compareRoutes,
  teamViewRoutes,
  kbRoutes,
  caseRoutes,
  allowlistRoutes,
  searchRoutes,
  sigmaRoutes,
  sandboxHuntRoutes,
  dotnetRoutes,
  yaraRoutes,
  hexRoutes,
  adminRoutes,
  apiTokenRoutes,
  trashRoutes,
  twoFactorRoutes,
  sandboxRoutes,
];

export interface BuildAppOptions {
  /** Log do Fastify: `true` (ou opcoes do pino) liga, com o serializador que tira a query string
   * (item 163). Padrao: desligado, como nos testes. */
  logger?: boolean | Exclude<FastifyServerOptions['logger'], boolean | undefined>;
  /** Padrao: TRUST_PROXY (lib/auth.ts). */
  trustProxy?: FastifyServerOptions['trustProxy'];
  /** Quem pode conectar (lib/network.ts). Padrao: a politica do TRUSTED_NETWORK. */
  network?: NetworkPolicy;
  /** Roda antes das rotas: um teste que precise ver cada rota registrada (gancho onRoute). */
  beforeRoutes?: (app: FastifyInstance) => void | Promise<void>;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const logger =
    options.logger === undefined || options.logger === false
      ? false
      : {
          serializers: { req: requestLogSerializer },
          ...(options.logger === true ? {} : options.logger),
        };
  const app = Fastify({
    logger,
    trustProxy: options.trustProxy ?? TRUST_PROXY,
    bodyLimit: 5 * 1024 * 1024,
  });

  // So a rede confiavel (o nginx e os servicos da rede deeplook) conecta na API: o navegador
  // isolado da captura, na outra rede, deixa de alcanca-la (src/lib/network.ts).
  (options.network ?? network).guard(app.server, app.log);
  // Pedido que muda estado vindo de outro site (CSRF), antes de qualquer rota.
  installCrossSiteGuard(app);

  await app.register(cookie, { secret: env.SESSION_SECRET });
  // Limite de tentativas so nas rotas que pedem (config.rateLimit da rota).
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });
  // WebSocket usado pelo console do sandbox. O noVNC exige o subprotocolo
  // "binary" no handshake, entao negociamos ele aqui.
  await app.register(websocket, {
    options: {
      handleProtocols: (protocols: Set<string>) => (protocols.has('binary') ? 'binary' : false),
      maxPayload: 16 * 1024 * 1024,
    },
  });

  // Erros em ingles para quem pede (Accept-Language: en), antes das rotas (revisao 2.5).
  registerErrorLanguage(app);

  // Antes das rotas: cada plugin do Fastify herda o tratador que existia quando foi carregado.
  // Definido depois (como estava no index.ts ate a revisao do plano, item 1.3), ele nunca valia
  // para as rotas: um erro inesperado saia no formato do Fastify, com a mensagem interna inteira.
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: 'Rota nao encontrada.' });
  });

  app.setErrorHandler((error, req, reply) => {
    if (isMissingObject(error)) {
      return reply.code(404).send({ error: MISSING_OBJECT_MESSAGE });
    }
    req.log.error({ err: error }, 'Erro na requisicao');
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: err.message ?? 'Erro na requisição.' });
    }
    return reply.code(500).send({ error: 'Erro interno do servidor.' });
  });

  await options.beforeRoutes?.(app);
  for (const routes of ROUTES) await app.register(routes);

  return app;
}
