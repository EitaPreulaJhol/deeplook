import { PutObjectCommand } from '@aws-sdk/client-s3';

import { env, sandboxEnabled } from '../env';
import { log, reason } from './log';
import { syncSniffer } from './mikrotik';
import { prisma } from './prisma';
import { pve } from './proxmox';
import { s3 } from './s3';
import { enqueueSuricata, suricataEnabled } from './suricata';

/**
 * Captura de rede do sandbox (plano pos-revisao, item 5.4). Ao abrir um ambiente, antes de ligar a
 * VM, a API le o MAC dela (net0 do clone), abre uma sessao no netcap e poe o MAC no sniffer do
 * MikroTik CHR, que manda os pacotes por TZSP ao netcap. Ao encerrar, tira o MAC do sniffer, busca
 * o pcap, guarda no MinIO (como os prints) e manda ao Suricata.
 *
 * Nunca derruba o ambiente: falha aqui fica registrada na captura (com o motivo na tela) e a VM
 * segue. Sem MIKROTIK_URL, NETCAP_URL ou NETCAP_STREAM_TARGET, nada disso roda.
 */

export const networkCaptureEnabled = (): boolean =>
  sandboxEnabled &&
  Boolean(env.MIKROTIK_URL && env.NETCAP_URL && env.NETCAP_TOKEN && env.NETCAP_STREAM_TARGET);

/** Espera para os pacotes ja enviados pelo CHR chegarem antes de buscar o pcap. */
export const captureTiming = { drainMs: 1500 };

const netcapBase = () => env.NETCAP_URL.replace(/\/$/, '');

async function netcap(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${netcapBase()}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${env.NETCAP_TOKEN}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new Error(`o serviço netcap não respondeu (${reason(err).slice(0, 120)})`, {
      cause: err,
    });
  }
}

async function netcapError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return `o netcap respondeu ${res.status}${body?.error ? `: ${body.error.slice(0, 120)}` : ''}`;
}

/** O MAC da primeira placa de rede da VM (net0: "virtio=BC:24:11:..,bridge=vmbr1"). */
export function macOf(config: Record<string, unknown>): string | null {
  const net = Object.keys(config)
    .filter((k) => /^net\d+$/.test(k))
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
    .map((k) => String(config[k]));
  for (const value of net) {
    const m = /(?:^|[=,])([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})(?:,|$)/.exec(value);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/** Os MACs dos ambientes que estao capturando agora (a lista do sniffer). */
async function capturingMacs(except?: string): Promise<string[]> {
  const rows = await prisma.networkCapture.findMany({
    where: { status: 'CAPTURING', ...(except ? { sessionId: { not: except } } : {}) },
    select: { mac: true },
  });
  return [...new Set(rows.map((r) => r.mac))];
}

async function fail(sessionId: string, error: string): Promise<void> {
  await prisma.networkCapture
    .update({
      where: { sessionId },
      data: { status: 'FAILED', error: error.slice(0, 300), stoppedAt: new Date() },
    })
    .catch(() => undefined);
}

/** Comeca a capturar (antes de ligar a VM). Nunca lanca. */
export async function startCapture(sessionId: string, node: string, vmid: number): Promise<void> {
  if (!networkCaptureEnabled()) return;
  let mac: string | null = null;
  try {
    mac = macOf(await pve<Record<string, unknown>>(`/nodes/${node}/qemu/${vmid}/config`));
  } catch (err) {
    log.warn(`[captura] não leu a configuração da VM ${vmid}: ${reason(err)}`);
  }
  await prisma.networkCapture.upsert({
    where: { sessionId },
    create: { sessionId, mac: mac ?? '' },
    update: { mac: mac ?? '', status: 'CAPTURING', error: null, startedAt: new Date() },
  });
  if (!mac) {
    await fail(sessionId, 'a VM não tem placa de rede com MAC (net0)');
    return;
  }
  try {
    const res = await netcap('/sessions', {
      method: 'POST',
      body: JSON.stringify({ id: sessionId, mac }),
    });
    if (!res.ok) throw new Error(await netcapError(res));
    await res.body?.cancel();
  } catch (err) {
    await fail(sessionId, reason(err));
    return;
  }
  try {
    await syncSniffer(await capturingMacs());
  } catch (err) {
    await fail(sessionId, `sniffer do MikroTik: ${reason(err)}`);
    await netcap(`/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => undefined);
    return;
  }
  log.info(`[captura] ambiente ${sessionId}: capturando ${mac}`);
}

/**
 * Para a captura: tira o MAC do sniffer, guarda o pcap no MinIO e o manda ao Suricata. Nunca
 * lanca; chamar de novo (ou sem captura) nao faz nada.
 */
export async function stopCapture(sessionId: string): Promise<void> {
  const capture = await prisma.networkCapture.findUnique({
    where: { sessionId },
    include: { session: { select: { entryId: true } } },
  });
  if (capture?.status !== 'CAPTURING') return;

  // 1. Tira o MAC do sniffer (os outros ambientes seguem).
  let snifferError: string | null = null;
  try {
    await syncSniffer(await capturingMacs(sessionId));
  } catch (err) {
    snifferError = `sniffer do MikroTik: ${reason(err)}`;
    log.warn(`[captura] ${snifferError}`);
  }
  await new Promise((resolve) => setTimeout(resolve, captureTiming.drainMs));

  // 2. Busca o pcap e guarda.
  try {
    const res = await netcap(`/sessions/${sessionId}/pcap`);
    if (!res.ok) throw new Error(await netcapError(res));
    const body = Buffer.from(await res.arrayBuffer());
    const packets = Number(res.headers.get('x-packets') ?? 0);
    const key = `sandbox/${capture.session.entryId}/${sessionId}/captura.pcap`;
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: 'application/vnd.tcpdump.pcap',
      }),
    );
    await prisma.networkCapture.update({
      where: { sessionId },
      data: {
        status: 'STORED',
        storageKey: key,
        bytes: body.length,
        packets,
        truncated: res.headers.get('x-truncated') === 'true',
        error: snifferError,
        stoppedAt: new Date(),
      },
    });
    log.info(`[captura] ambiente ${sessionId}: ${packets} pacote(s), ${body.length} bytes`);
    if (packets > 0 && suricataEnabled()) await enqueueSuricata(capture.id);
  } catch (err) {
    await fail(sessionId, reason(err));
  }

  // 3. Fecha a sessao no netcap.
  await netcap(`/sessions/${sessionId}`, { method: 'DELETE' })
    .then((r) => r.body?.cancel())
    .catch(() => undefined);
}

/**
 * Na subida: fecha a captura de ambiente que nao esta mais ativo (a API caiu no meio), deixa o
 * sniffer com a lista certa e apaga do netcap a sessao que o banco nao conhece.
 */
export async function reconcileCaptures(): Promise<void> {
  if (!networkCaptureEnabled()) return;
  const stale = await prisma.networkCapture.findMany({
    where: {
      status: 'CAPTURING',
      session: { status: { notIn: ['REQUESTED', 'PROVISIONING', 'RUNNING'] } },
    },
    select: { sessionId: true },
  });
  for (const c of stale) await stopCapture(c.sessionId);
  try {
    await syncSniffer(await capturingMacs());
  } catch (err) {
    log.warn(`[captura] não acertou o sniffer do MikroTik na subida: ${reason(err)}`);
  }
  try {
    const res = await netcap('/sessions');
    if (!res.ok) throw new Error(await netcapError(res));
    const { sessions } = (await res.json()) as { sessions: { id: string }[] };
    const known = new Set(
      (
        await prisma.networkCapture.findMany({
          where: { status: 'CAPTURING' },
          select: { sessionId: true },
        })
      ).map((c) => c.sessionId),
    );
    for (const s of sessions) {
      if (!known.has(s.id)) {
        await netcap(`/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' }).catch(
          () => undefined,
        );
      }
    }
  } catch (err) {
    log.warn(`[captura] não conferiu as sessões do netcap na subida: ${reason(err)}`);
  }
}

/** Chaves dos pcaps de uma amostra (a lixeira apaga junto). */
export async function captureKeysOf(entryId: string): Promise<string[]> {
  const rows = await prisma.networkCapture.findMany({
    where: { session: { entryId }, storageKey: { not: null } },
    select: { storageKey: true },
  });
  return rows.map((r) => r.storageKey!);
}
