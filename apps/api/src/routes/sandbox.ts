import type { Readable } from 'node:stream';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { z } from 'zod';

import { env, proxmoxMock, sandboxEnabled } from '../env';
import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { isAnalyst, loadUser, requireUser } from '../lib/auth';
import { localizeText } from '../lib/data-language';
import { type Lang, requestLang } from '../lib/error-language';
import { recordEvent } from '../lib/events';
import { attachMockVnc } from '../lib/mock-vnc';
import { networkCaptureEnabled } from '../lib/network-capture';
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
import { s3 } from '../lib/s3';
import {
  createSession,
  dispose,
  getSession,
  latestSessionForEntry,
  listSessions,
  sampleFileName,
  sandboxReady,
} from '../lib/sandbox';
import { type GuestProcess, newProcesses } from '../lib/sandbox-artifacts';
import { suricataIndicators, type SuricataResult } from '../lib/suricata';
import {
  describeEvent,
  entrySysmonIndicators,
  sampleRunLists,
  sampleStart,
  sampleTree,
  sysmonTimeline,
  sysmonTimelineAll,
  sysmonView,
  TIMELINE_KINDS,
  TIMELINE_PAGE,
  type TimelineKind,
} from '../lib/sysmon-store';
import { sendValidationError } from '../lib/validation';

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

/** O motivo de falha da execucao automatica sai no idioma de quem pede. */
function localizeSession<T extends { autoRunError?: string | null }>(session: T, lang: Lang): T {
  return session.autoRunError
    ? { ...session, autoRunError: localizeText(session.autoRunError, lang) }
    : session;
}

/** Formato da exportacao da linha do tempo (plans/ajustes-usabilidade, item 6). */
const ExportFormat = z.object({ format: z.enum(['csv', 'json']).default('csv') });

/**
 * Celula de CSV. O texto vem da amostra (linhas de comando, chaves, nomes): o que comecaria uma
 * formula na planilha (=, +, -, @, tab, CR) ganha um apostrofo na frente.
 */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Filtros da linha do tempo de uma execucao (plans/sandbox-execucoes, fase 3). */
const TimelineQuery = z.object({
  /** sample: so a amostra e o que ela abriu; all: tudo (com o ruido do Windows). */
  scope: z.enum(['sample', 'all']).optional(),
  kinds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : [...TIMELINE_KINDS]))
    .pipe(z.array(z.enum(TIMELINE_KINDS)).min(1)),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

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
    // No, VM, IP e analista sao para quem opera: o painel so existe para analistas. A sessao mais
    // recente, mesmo encerrada: so a ativa deixava os artefatos (prints, processos, Sysmon,
    // captura) sem lugar na tela assim que o ambiente acabava.
    const session = isAnalyst(user) ? await latestSessionForEntry(id) : null;
    // Sysmon (plano pos-revisao, item 5.3): dominios e IPs que a VM procurou ou contatou, em
    // qualquer ambiente da amostra, vao para os IOCs sugeridos do relatorio.
    const sysmonFound = isAnalyst(user) ? await entrySysmonIndicators(id) : [];
    // O que o Suricata viu no trafego (plano pos-revisao, item 5.4): DNS, HTTP, TLS e os IPs dos
    // alertas.
    const traffic = isAnalyst(user)
      ? await prisma.networkCapture.findMany({
          where: { idsStatus: 'DONE', session: { entryId: id } },
          select: { idsResult: true },
        })
      : [];
    return reply.send({
      enabled: sandboxEnabled,
      consoleEnabled: env.SANDBOX_CONSOLE_ENABLED === 'true',
      session: session ? localizeSession(session, requestLang(req)) : null,
      sysmonIndicators: sysmonFound,
      networkIndicators: [
        ...new Set(
          traffic.flatMap((c) => suricataIndicators(c.idsResult as unknown as SuricataResult)),
        ),
      ],
    });
  });

  // ---- Execucoes da amostra (plans/sandbox-execucoes, fase 1) ----
  // Todas as sessoes, a mais recente primeiro: a secao do ambiente mostra a atual e lista as
  // anteriores, cada uma com os proprios artefatos (rota /api/sandbox/:id/artifacts).
  app.get('/api/entries/:id/sandbox/sessions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas veem os artefatos do ambiente.' });
    }
    const { id } = req.params as { id: string };
    const sessions = await prisma.sandboxSession.findMany({
      where: { entryId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        startedAt: true,
        stoppedAt: true,
        autoRun: true,
        autoRunAt: true,
        autoRunUser: true,
        autoRunSysmon: true,
        autoRunError: true,
        analyst: { select: { id: true, displayName: true } },
      },
    });
    const lang = requestLang(req);
    return reply.send({ sessions: sessions.map((s) => localizeSession(s, lang)) });
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

    // Execucao automatica da amostra (caixa no painel): depois do boot e do Sysmon.
    const autoRun = (req.body as { autoRun?: unknown } | null)?.autoRun === true;
    const result = await createSession(entry, user.id, { autoRun });
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
    return reply.send({ session: localizeSession(session, requestLang(req)), vmStatus });
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

  // ---- Artefatos (revisao 3.7): prints periodicos e processos, tambem depois de encerrado ----
  // Leitura para qualquer analista (sao evidencia da amostra); operar o ambiente continua sendo do
  // dono ou de um admin.
  const artifactSession = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (!isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas veem os artefatos do ambiente.' });
      return null;
    }
    const { id } = req.params as { id: string };
    const session = await prisma.sandboxSession.findUnique({
      where: { id },
      select: { id: true, status: true, artifactsNote: true, startedAt: true, stoppedAt: true },
    });
    if (!session) {
      reply.code(404).send({ error: 'Ambiente não encontrado.' });
      return null;
    }
    return { ...session, viewer: user };
  };

  app.get('/api/sandbox/:id/artifacts', async (req, reply) => {
    const session = await artifactSession(req, reply);
    if (!session) return;
    const [shots, lists, sysmon, capture] = await Promise.all([
      prisma.sandboxArtifact.findMany({
        where: { sessionId: session.id, kind: 'SCREENSHOT' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true },
      }),
      prisma.sandboxArtifact.findMany({
        where: { sessionId: session.id, kind: 'PROCESSES' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, processes: true },
      }),
      // Sysmon (plano pos-revisao, item 5.3): so a leitura mais recente.
      prisma.sandboxArtifact.findFirst({
        where: { sessionId: session.id, kind: 'SYSMON' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, sysmon: true },
      }),
      // Captura de rede e Suricata (plano pos-revisao, item 5.4).
      prisma.networkCapture.findUnique({ where: { sessionId: session.id } }),
    ]);
    const first = lists[0];
    const last = lists.at(-1);
    const processes = (last?.processes ?? []) as GuestProcess[];
    const lang = requestLang(req);
    const sysmonNow = sysmon ? await sysmonView(session.id, sysmon.sysmon, lang) : null;
    return reply.send({
      status: session.status,
      note: localizeText(session.artifactsNote, lang),
      intervalS: env.SANDBOX_ARTIFACT_INTERVAL_S,
      screenshots: shots,
      processes: last
        ? {
            at: last.createdAt,
            firstAt: first!.createdAt,
            lists: lists.length,
            current: processes,
            // O que surgiu desde a primeira listagem (a amostra rodando, o que ela abriu).
            appeared: newProcesses((first!.processes ?? []) as GuestProcess[], processes),
          }
        : null,
      sysmon: sysmon && sysmonNow ? { at: sysmon.createdAt, ...sysmonNow } : null,
      captureEnabled: networkCaptureEnabled(),
      network: capture
        ? {
            status: capture.status,
            error: localizeText(capture.error, lang),
            mac: capture.mac || null,
            packets: capture.packets,
            bytes: capture.bytes,
            truncated: capture.truncated,
            startedAt: capture.startedAt,
            stoppedAt: capture.stoppedAt,
            pcap: Boolean(capture.storageKey),
            ids: capture.idsStatus
              ? {
                  status: capture.idsStatus,
                  error: localizeText(capture.idsError, lang),
                  ms: capture.idsMs,
                  finishedAt: capture.idsFinishedAt,
                  result: capture.idsStatus === 'DONE' ? capture.idsResult : null,
                }
              : null,
          }
        : null,
    });
  });

  // pcap da captura de rede (plano pos-revisao, 5.4): trafego de malware, so para analistas, como
  // anexo (nunca aberto no navegador) e com registro na auditoria.
  app.get('/api/sandbox/:id/pcap', async (req, reply) => {
    const session = await artifactSession(req, reply);
    if (!session) return;
    const capture = await prisma.networkCapture.findUnique({
      where: { sessionId: session.id },
      select: { storageKey: true, bytes: true, session: { select: { entry: true } } },
    });
    if (!capture?.storageKey) {
      return reply.code(404).send({ error: 'Captura de rede não encontrada.' });
    }
    const obj = await s3
      .send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: capture.storageKey }))
      .catch(() => null);
    if (!obj) return reply.code(404).send({ error: 'Captura de rede não encontrada.' });
    const user = session.viewer;
    const entry = capture.session.entry;
    await audit(prisma, req, {
      action: 'SANDBOX_PCAP_DOWNLOADED',
      actorId: user.id,
      targetUserId: entry.ownerId,
      targetLabel: entry.title,
      detail: `ambiente ${session.id} · ${capture.bytes ?? 0} bytes`,
    });
    return reply
      .header('Content-Type', 'application/vnd.tcpdump.pcap')
      .header('Content-Disposition', `attachment; filename="captura-${session.id}.pcap"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(obj.Body as Readable);
  });

  // ---- Linha do tempo de uma execucao (plans/sandbox-execucoes, fase 3) ----
  // Os eventos do Sysmon em ordem de tempo, com as marcas do ambiente (no ar, amostra aberta,
  // prints, fim) a parte. Padrao: so a amostra e o que ela abriu, quando ela aparece no Sysmon.
  app.get('/api/sandbox/:id/timeline', async (req, reply) => {
    const session = await artifactSession(req, reply);
    if (!session) return;
    const parsed = TimelineQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const extra = await prisma.sandboxSession.findUnique({
      where: { id: session.id },
      select: {
        autoRun: true,
        autoRunAt: true,
        entry: { select: { originalFilename: true } },
        artifacts: {
          where: { kind: 'SCREENSHOT' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, createdAt: true },
        },
      },
    });
    const name = sampleFileName({ originalFilename: extra?.entry.originalFilename ?? null });
    const tree = await sampleTree(session.id, name);
    const scope = parsed.data.scope ?? (tree.size ? 'sample' : 'all');
    const { total, events } = await sysmonTimeline(session.id, {
      tree,
      sampleOnly: scope === 'sample',
      kinds: parsed.data.kinds as TimelineKind[],
      page: parsed.data.page,
    });
    const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
    const markers = [
      { kind: 'started', time: iso(session.startedAt) },
      ...(extra?.autoRun === 'DONE' ? [{ kind: 'autorun', time: iso(extra.autoRunAt) }] : []),
      { kind: 'sample', time: await sampleStart(session.id, tree) },
      ...(extra?.artifacts ?? []).map((a) => ({
        kind: 'screenshot',
        time: iso(a.createdAt),
        id: a.id,
      })),
      { kind: 'stopped', time: iso(session.stoppedAt) },
    ].filter((m) => m.time);
    return reply.send({
      sample: { name, found: tree.size > 0, processes: tree.size },
      scope,
      kinds: parsed.data.kinds,
      page: parsed.data.page,
      pageSize: TIMELINE_PAGE,
      total,
      events,
      markers,
    });
  });

  /** O nome do arquivo da amostra e a arvore de processos dela no Sysmon de uma execucao. */
  const sampleOf = async (sessionId: string) => {
    const row = await prisma.sandboxSession.findUnique({
      where: { id: sessionId },
      select: { entryId: true, entry: { select: { originalFilename: true } } },
    });
    const name = sampleFileName({ originalFilename: row?.entry.originalFilename ?? null });
    return { name, entryId: row?.entryId ?? '', tree: await sampleTree(sessionId, name) };
  };

  // ---- Linha do tempo inteira para baixar (plans/ajustes-usabilidade, item 6) ----
  app.get('/api/sandbox/:id/timeline/export', async (req, reply) => {
    const session = await artifactSession(req, reply);
    if (!session) return;
    const parsed = TimelineQuery.merge(ExportFormat).safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const { name, entryId, tree } = await sampleOf(session.id);
    const scope = parsed.data.scope ?? (tree.size ? 'sample' : 'all');
    const events = await sysmonTimelineAll(session.id, {
      tree,
      sampleOnly: scope === 'sample',
      kinds: parsed.data.kinds as TimelineKind[],
    });
    const file = `deeplook-${entryId}-${session.id}-linha-do-tempo.${parsed.data.format}`;
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Disposition', `attachment; filename="${file}"`);
    if (parsed.data.format === 'json') {
      reply.header('Content-Type', 'application/json; charset=utf-8');
      return reply.send(
        JSON.stringify({ sample: { name, found: tree.size > 0 }, scope, events }, null, 2),
      );
    }
    const header = ['time', 'kind', 'process', 'pid', 'sample', 'detail'];
    const rows = events.map((e) =>
      [e.time, e.kind, e.image, e.pid, e.sample, describeEvent(e)].map(csvCell).join(','),
    );
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    // BOM: o Excel le o UTF-8 (caminhos com acento) sem pedir a codificacao.
    return reply.send(`\uFEFF${[header.join(','), ...rows].join('\r\n')}\r\n`);
  });

  // ---- Resumo de uma execucao (ficha impressa e Markdown; ajustes, item 6) ----
  app.get('/api/sandbox/:id/summary', async (req, reply) => {
    const session = await artifactSession(req, reply);
    if (!session) return;
    const lang = requestLang(req);
    const [{ name, tree }, row, statusRow, lists, shots] = await Promise.all([
      sampleOf(session.id),
      prisma.sandboxSession.findUnique({
        where: { id: session.id },
        select: {
          createdAt: true,
          autoRun: true,
          autoRunAt: true,
          autoRunUser: true,
          autoRunSysmon: true,
          analyst: { select: { displayName: true } },
        },
      }),
      prisma.sandboxArtifact.findFirst({
        where: { sessionId: session.id, kind: 'SYSMON' },
        select: { sysmon: true },
      }),
      prisma.sandboxArtifact.findMany({
        where: { sessionId: session.id, kind: 'PROCESSES' },
        orderBy: { createdAt: 'asc' },
        select: { processes: true },
      }),
      prisma.sandboxArtifact.count({ where: { sessionId: session.id, kind: 'SCREENSHOT' } }),
    ]);
    const sysmon = statusRow?.sysmon as
      { available: boolean; reason?: string; events?: number } | null | undefined;
    const first = (lists[0]?.processes ?? []) as GuestProcess[];
    const last = (lists.at(-1)?.processes ?? []) as GuestProcess[];
    return reply.send({
      session: {
        id: session.id,
        status: session.status,
        createdAt: row?.createdAt,
        startedAt: session.startedAt,
        stoppedAt: session.stoppedAt,
        analyst: row?.analyst.displayName ?? null,
        autoRun: row?.autoRun ?? null,
        autoRunAt: row?.autoRunAt ?? null,
        autoRunUser: row?.autoRunUser ?? null,
        autoRunSysmon: row?.autoRunSysmon ?? null,
      },
      sample: { name, found: tree.size > 0, processes: tree.size },
      sysmon: sysmon
        ? {
            available: sysmon.available,
            reason: localizeText(sysmon.reason ?? null, lang),
            events: sysmon.events ?? null,
          }
        : null,
      ...(await sampleRunLists(session.id, tree)),
      appeared: lists.length > 1 ? newProcesses(first, last) : [],
      screenshots: shots,
    });
  });

  app.get('/api/sandbox/:id/artifacts/:artifactId', async (req, reply) => {
    const session = await artifactSession(req, reply);
    if (!session) return;
    const { artifactId } = req.params as { artifactId: string };
    const shot = await prisma.sandboxArtifact.findFirst({
      where: { id: artifactId, sessionId: session.id, kind: 'SCREENSHOT' },
      select: { storageKey: true, createdAt: true },
    });
    if (!shot?.storageKey) return reply.code(404).send({ error: 'Print não encontrado.' });
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: shot.storageKey }),
    );
    return reply
      .header('Content-Type', 'image/png')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'private, max-age=3600')
      .send(obj.Body as Readable);
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
