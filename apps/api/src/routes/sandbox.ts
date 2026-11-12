import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import WebSocket from 'ws';

import { env, proxmoxMock, sandboxEnabled } from '../env';
import type { Prisma } from '../generated/prisma/client';
import { isAnalyst, loadUser, requireUser } from '../lib/auth';
import { recordEvent } from '../lib/events';
import { attachMockVnc } from '../lib/mock-vnc';
import { prisma } from '../lib/prisma';
import {
  createVncProxy,
  pve,
  pveAuth,
  pveConsoleWsUrl,
  pveNode,
  pveOrigin,
  pveRaw,
  pveStorageSupportsIso,
  pveTemplateExists,
  pveVerifyTls,
  pveVersion,
  waitTask,
} from '../lib/proxmox';
import {
  activeSessionForEntry,
  createSession,
  dispose,
  getSession,
  listSessions,
  sandboxReady,
} from '../lib/sandbox';

const ACTIVE = ['REQUESTED', 'PROVISIONING', 'RUNNING', 'STOPPING'] as const;

/** Senha efemera do console por sessao (o noVNC busca sob demanda no handshake). */
const consoleAuth = new Map<string, { password: string; expiresAt: number }>();

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function notEnabled(reply: FastifyReply) {
  return reply
    .code(503)
    .send({ error: 'O sandbox não está habilitado neste servidor (SANDBOX_ENABLED).' });
}

/** Teto do que o navegador manda antes de o console do Proxmox abrir (o noVNC manda quase nada). */
const PENDING_MAX_BYTES = 1024 * 1024;

function rawSize(data: WebSocket.RawData): number {
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + part.byteLength, 0);
  return data.byteLength;
}

/** A sessao do cookie continua valendo e a pessoa ainda pode operar este ambiente? */
async function stillAllowed(req: FastifyRequest, analystId: string): Promise<boolean> {
  const user = await loadUser(req);
  return Boolean(user && !user.mustChangePassword && canOperate({ analystId }, user));
}

/** Admin, ou o dono que continua analista: quem perdeu o papel nao opera o que abriu. */
function canOperate(session: { analystId: string }, user: { id: string; role: string }) {
  return user.role === 'ADMIN' || (user.role === 'ANALYST' && session.analystId === user.id);
}

/** Carrega a sessao garantindo que o usuario pode ver/operar (dono ou admin). */
async function loadOwned(
  id: string,
  user: { id: string; role: string },
  reply: FastifyReply,
): Promise<Awaited<ReturnType<typeof getSession>> | null> {
  const session = await getSession(id);
  if (!session) {
    reply.code(404).send({ error: 'Ambiente não encontrado.' });
    return null;
  }
  if (!canOperate(session, user)) {
    reply.code(403).send({ error: 'Este ambiente pertence a outro analista.' });
    return null;
  }
  return session;
}

/** Estado atual da VM no Proxmox (best effort: nunca derruba a resposta). */
async function liveVmStatus(session: {
  vmid: number | null;
  node: string;
}): Promise<string | null> {
  if (!session.vmid) return null;
  try {
    const data = await pve<{ status?: string }>(
      `/nodes/${session.node}/qemu/${session.vmid}/status/current`,
    );
    return data?.status ?? null;
  } catch {
    return null;
  }
}

export async function sandboxRoutes(app: FastifyInstance) {
  // ---- Diagnostico da integracao (admin) ----
  app.get('/api/sandbox/health', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Acesso restrito a administradores.' });
    }

    const checks: { name: string; ok: boolean; detail: string }[] = [];
    const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

    add(
      'sandbox-habilitado',
      sandboxEnabled,
      sandboxEnabled ? 'SANDBOX_ENABLED=true' : 'SANDBOX_ENABLED=false (feature inerte)',
    );
    add(
      'modo-mock',
      proxmoxMock,
      proxmoxMock ? 'PROXMOX_MOCK=true (nao fala com o PVE real)' : 'usando o PVE real',
    );

    if (sandboxEnabled) {
      if (proxmoxMock) {
        add('pve-acessivel', true, 'simulado em memoria');
      } else {
        try {
          add('pve-acessivel', true, await pveVersion());
        } catch (err) {
          add('pve-acessivel', false, msg(err));
        }
      }

      try {
        const ok = await pveTemplateExists(env.PROXMOX_TEMPLATE_VMID);
        add('template', ok, `vmid ${env.PROXMOX_TEMPLATE_VMID} no node ${pveNode()}`);
      } catch (err) {
        add('template', false, msg(err));
      }

      try {
        const ok = await pveStorageSupportsIso(env.PROXMOX_ISO_STORAGE);
        add('storage-iso', ok, `storage ${env.PROXMOX_ISO_STORAGE} aceita content iso`);
      } catch (err) {
        add('storage-iso', false, msg(err));
      }

      add(
        'usuario-console',
        proxmoxMock || (Boolean(env.PROXMOX_USER) && Boolean(env.PROXMOX_PASSWORD)),
        proxmoxMock
          ? 'modo mock: nao precisa de usuario do PVE'
          : 'console exige usuario/senha do PVE (API token nao serve)',
      );
    }

    const activeSessions = await prisma.sandboxSession.count({
      where: { status: { in: [...ACTIVE] } },
    });

    return reply.send({
      enabled: sandboxEnabled,
      mock: proxmoxMock,
      node: pveNode(),
      templateVmid: env.PROXMOX_TEMPLATE_VMID,
      isoStorage: env.PROXMOX_ISO_STORAGE,
      ttlMinutes: env.SANDBOX_TTL_MINUTES,
      maxActive: env.SANDBOX_MAX_ACTIVE,
      maxPerUser: env.SANDBOX_MAX_PER_USER,
      consoleEnabled: env.SANDBOX_CONSOLE_ENABLED === 'true',
      activeSessions,
      checks,
    });
  });

  // ---- Sessao ativa de uma amostra (painel do analista) ----
  app.get('/api/entries/:id/sandbox', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    // No, VM, IP e analista sao para quem opera: o painel so existe para analistas.
    const session = isAnalyst(user) ? await activeSessionForEntry(id) : null;
    return reply.send({
      enabled: sandboxEnabled,
      consoleEnabled: env.SANDBOX_CONSOLE_ENABLED === 'true',
      session: session ?? null,
    });
  });

  // ---- Abre o ambiente para uma amostra ----
  app.post('/api/entries/:id/sandbox', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas podem abrir um ambiente.' });
    }
    if (!sandboxEnabled) return notEnabled(reply);
    // Limpeza inicial ainda rodando (API recem-iniciada): sem sessao nova ate acabar.
    if (!sandboxReady()) {
      return reply
        .code(503)
        .send({ error: 'O sandbox está iniciando. Tente de novo em alguns segundos.' });
    }

    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id } });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });

    const result = await createSession(entry, user.id);
    if (!result.ok) return reply.code(result.code).send({ error: result.error });
    await recordEvent(prisma, { entryId: entry.id, actorId: user.id, type: 'SANDBOX_OPENED' });

    return reply.code(201).send({ session: result.session });
  });

  // ---- Lista de ambientes (analista ve os seus; admin pode ver todos) ----
  app.get('/api/sandbox', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    if (!isAnalyst(user)) return reply.send({ sessions: [] });
    const query = req.query as { scope?: string; active?: string };
    const where: Prisma.SandboxSessionWhereInput = {};
    if (user.role !== 'ADMIN' || query.scope !== 'all') where.analystId = user.id;
    if (query.active === 'true') where.status = { in: [...ACTIVE] };

    const sessions = await listSessions(where);
    return reply.send({ sessions });
  });

  // ---- Detalhe (usado no polling do painel) ----
  app.get('/api/sandbox/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const session = await loadOwned(id, user, reply);
    if (!session) return;

    const vmStatus = session.status === 'RUNNING' ? await liveVmStatus(session) : null;
    return reply.send({ session, vmStatus });
  });

  // ---- Estende o tempo de vida ----
  app.post('/api/sandbox/:id/extend', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const session = await loadOwned(id, user, reply);
    if (!session) return;
    if (!ACTIVE.includes(session.status as (typeof ACTIVE)[number])) {
      return reply.code(409).send({ error: 'Este ambiente já foi encerrado.' });
    }

    const requested = Number((req.body as { minutes?: number } | null)?.minutes);
    // Cada extensao vale no maximo um TTL (sem teto, um valor enorme vira data invalida).
    const minutes =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, env.SANDBOX_TTL_MINUTES)
        : env.SANDBOX_TTL_MINUTES;
    const base = Math.max(session.expiresAt.getTime(), Date.now());

    const updated = await prisma.sandboxSession.update({
      where: { id },
      data: { expiresAt: new Date(base + minutes * 60_000) },
    });
    return reply.send({ session: updated });
  });

  // ---- Liga/desliga a VM sem destruir o ambiente ----
  app.post('/api/sandbox/:id/power', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!sandboxEnabled) return notEnabled(reply);

    const { id } = req.params as { id: string };
    const session = await loadOwned(id, user, reply);
    if (!session) return;
    if (!session.vmid) return reply.code(409).send({ error: 'A VM ainda não foi criada.' });

    const action = (req.body as { action?: string } | null)?.action;
    if (action !== 'on' && action !== 'off') {
      return reply.code(400).send({ error: 'Ação inválida (use "on" ou "off").' });
    }

    try {
      const upid = await pve<string>(
        `/nodes/${session.node}/qemu/${session.vmid}/status/${action === 'on' ? 'start' : 'shutdown'}`,
        { method: 'POST' },
      );
      await waitTask(upid, 120_000);
    } catch (err) {
      return reply.code(502).send({ error: msg(err) });
    }

    return reply.send({ ok: true, vmStatus: await liveVmStatus(session) });
  });

  // ---- Descarta o ambiente (destroi a VM e apaga o ISO da amostra) ----
  app.delete('/api/sandbox/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const session = await loadOwned(id, user, reply);
    if (!session) return;

    await dispose(id, 'STOPPED');
    await recordEvent(prisma, {
      entryId: session.entryId,
      actorId: user.id,
      type: 'SANDBOX_CLOSED',
      detail: 'descartado',
    });
    return reply.send({ ok: true });
  });

  // ---- Captura de tela da VM (evidencia para o relatorio) ----
  app.get('/api/sandbox/:id/screenshot', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const session = await loadOwned(id, user, reply);
    if (!session) return;
    if (!session.vmid) return reply.code(409).send({ error: 'A VM ainda não foi criada.' });

    const shot = await pveRaw(`/nodes/${session.node}/qemu/${session.vmid}/screenshot`, {
      method: 'POST',
    });
    if (shot.status >= 400) {
      return reply.code(502).send({ error: 'Nao foi possivel capturar a tela da VM.' });
    }
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'no-store');
    return reply.send(shot.body);
  });

  // ---- Console: o front so recebe o caminho do websocket (ticket fica aqui) ----
  app.get('/api/sandbox/:id/console', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const session = await loadOwned(id, user, reply);
    if (!session) return;
    if (env.SANDBOX_CONSOLE_ENABLED !== 'true') {
      return reply
        .code(503)
        .send({ error: 'O console está desabilitado (SANDBOX_CONSOLE_ENABLED).' });
    }
    if (!session.vmid) return reply.code(409).send({ error: 'A VM ainda não foi criada.' });

    return reply.send({ wsPath: `/api/sandbox/${session.id}/console/ws` });
  });

  // ---- Senha VNC do console (o noVNC busca aqui no handshake) ----
  // O PVE exige auth VNC (vncproxy -> vncwebsocket). O ticket continua so no
  // backend; ao navegador entregamos apenas a senha efemera do console.
  app.get('/api/sandbox/:id/console/credentials', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const session = await loadOwned(id, user, reply);
    if (!session) return;

    const entry = consoleAuth.get(session.id);
    if (!entry || entry.expiresAt < Date.now()) {
      return reply.code(409).send({ error: 'O console ainda não foi conectado.' });
    }
    reply.header('Cache-Control', 'no-store');
    return reply.send({ password: entry.password });
  });

  // ---- WebSocket do console: proxy autenticado para o vncwebsocket do PVE ----
  // O navegador nunca ve o ticket do Proxmox: ele fica so no backend.
  app.get('/api/sandbox/:id/console/ws', { websocket: true }, (socket, req) => {
    const fail = (code: number, reason: string) => {
      try {
        socket.close(code, reason.slice(0, 120));
      } catch {
        /* socket ja fechado */
      }
    };
    void (async () => {
      const user = await loadUser(req);
      if (!user) return fail(4401, 'nao autenticado');
      // Fora do requireUser: a senha a trocar tambem bloqueia o console.
      if (user.mustChangePassword) return fail(4403, 'defina uma nova senha');
      if (!sandboxEnabled) return fail(4403, 'sandbox desabilitado');
      if (env.SANDBOX_CONSOLE_ENABLED !== 'true') return fail(4403, 'console desabilitado');

      const { id } = req.params as { id: string };
      const session = await getSession(id);
      if (!session) return fail(4404, 'ambiente não encontrado');
      if (!canOperate(session, user)) {
        return fail(4403, 'sem permissao para este ambiente');
      }
      if (!session.vmid) return fail(4409, 'a VM ainda não existe');

      let upstream: WebSocket;
      try {
        if (proxmoxMock && !env.SANDBOX_MOCK_VNC_URL) {
          // Sem um VNC de teste no modo mock: responde o RFB por aqui mesmo.
          return attachMockVnc(socket);
        }
        if (proxmoxMock) {
          upstream = new WebSocket(env.SANDBOX_MOCK_VNC_URL, ['binary'], {
            perMessageDeflate: false,
            handshakeTimeout: 15_000,
          });
        } else {
          const proxy = await createVncProxy(session.vmid);
          const auth = await pveAuth();
          // Guarda a senha para o noVNC buscar em /console/credentials e
          // completar a auth VNC (o ticket permanece so no backend).
          consoleAuth.set(session.id, {
            password: proxy.password,
            expiresAt: Date.now() + 10 * 60_000,
          });
          upstream = new WebSocket(
            pveConsoleWsUrl(session.vmid, proxy.port, proxy.ticket),
            ['binary'],
            {
              headers: {
                Cookie: auth.cookie,
                CSRFPreventionToken: auth.csrf,
                Origin: pveOrigin(),
              },
              rejectUnauthorized: pveVerifyTls(),
              perMessageDeflate: false,
              handshakeTimeout: 15_000,
            },
          );
        }
      } catch (err) {
        return fail(4502, msg(err));
      }

      // O noVNC so fala depois do handshake do servidor, mas guardamos o que
      // chegar antes do upstream abrir para nao perder nada.
      const pending: { data: WebSocket.RawData; binary: boolean }[] = [];
      let pendingBytes = 0;
      let upstreamOpen = false;

      socket.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (!upstreamOpen) {
          // O noVNC manda poucos bytes antes do handshake: acima do teto e abuso de memoria.
          pendingBytes += rawSize(data);
          if (pendingBytes > PENDING_MAX_BYTES)
            return shutdown(1009, 'dados demais antes da conexão');
          pending.push({ data, binary: isBinary });
          return;
        }
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      });

      upstream.on('open', () => {
        upstreamOpen = true;
        for (const item of pending) upstream.send(item.data, { binary: item.binary });
        pending.length = 0;
      });

      upstream.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(data, { binary: isBinary });
      });

      let ping: NodeJS.Timeout | null = null;
      const shutdown = (code: number, reason: string) => {
        if (ping) clearInterval(ping);
        ping = null;
        try {
          if (
            upstream.readyState === WebSocket.OPEN ||
            upstream.readyState === WebSocket.CONNECTING
          ) {
            upstream.close();
          }
        } catch {
          /* noop */
        }
        fail(code, reason);
      };

      // Ping periodico para manter o tunel (browser -> nginx -> API -> PVE) vivo. No mesmo
      // tique, confere se quem abriu o console ainda pode: sem isto, sair, expirar a sessao ou
      // perder o papel nao fechava um console ja aberto.
      ping = setInterval(() => {
        if (upstream.readyState === WebSocket.OPEN) upstream.ping();
        void stillAllowed(req, session.analystId).then(
          (allowed) => {
            if (!allowed) shutdown(4401, 'sessão encerrada');
          },
          // Banco fora: nao derruba o console por causa da rede; confere de novo no proximo tique.
          () => undefined,
        );
      }, 30_000);
      ping.unref();

      socket.on('close', () => shutdown(1000, ''));
      socket.on('error', () => shutdown(1011, 'erro no console'));
      upstream.on('close', () => shutdown(1000, ''));
      upstream.on('error', (err: Error) => shutdown(1011, msg(err)));
    })().catch((err: unknown) => {
      // O loadUser e o getSession ficam fora de qualquer try: com o banco fora, a promessa
      // rejeitava sem ninguem ouvir e o Node encerrava a API (mesma classe do item 8.1).
      req.log.error({ err }, '[sandbox] falha ao abrir o console');
      fail(1011, 'erro interno');
    });
  });
}
