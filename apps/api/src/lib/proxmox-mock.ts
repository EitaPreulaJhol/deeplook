import { env } from '../env';
import type { PveMethod } from './proxmox';

/**
 * Modo simulado do Proxmox (PROXMOX_MOCK=true).
 * Mantem um "cluster" em memoria para permitir desenvolver e testar todo o
 * fluxo do sandbox sem ter um PVE de verdade.
 */

interface MockVm {
  vmid: number;
  name: string;
  status: 'stopped' | 'running';
  tags?: string;
  config: Record<string, unknown>;
}

interface MockTask {
  upid: string;
  finishAt: number;
  exitstatus: string;
}

const vms = new Map<number, MockVm>();
const tasks = new Map<string, MockTask>();
const isos = new Map<string, number>();

let nextId = 9000;
let taskSeq = 0;

const CLONE_MS = 2000;
const START_MS = 1200;
const UPLOAD_MS = 1500;
const STOP_MS = 600;

/** Quantas listagens de processos o agente simulado ja fez. */
let agentRuns = 0;
/** O que cada execucao do agente pediu (pid -> tipo), para o exec-status responder certo. */
const agentJobs = new Map<number, 'processes' | 'sysmon' | 'probe' | 'autorun'>();
/** Execucoes automaticas da amostra que o agente simulado recebeu (os testes conferem). */
export const mockAutoRuns: { vmid: number; script: string }[] = [];
/** Leitura do Sysmon que volta ilegivel (os testes ligam; como um agente que falha no meio). */
export const mockSysmon = { broken: false };
/** As proximas `calls` chamadas ao agente dao "got timeout", como o PVE com a VM ocupada. */
export const mockAgentBusy = {
  calls: 0,
  /** O pedido de execucao da amostra da "got timeout" (e conta quantas vezes veio). */
  autorunStart: false,
  autorunTries: 0,
};
let agentPid = 1000;

/**
 * Eventos de exemplo do Sysmon (plano pos-revisao, item 5.3): a amostra abre um PowerShell, que
 * consulta um dominio, conecta nele, grava um arquivo e cria uma chave de inicializacao.
 */
export const MOCK_SYSMON_EVENTS = [
  {
    id: 1,
    time: '2026-11-13T12:00:01.0000000Z',
    data: {
      ProcessId: '4410',
      ParentProcessId: '3020',
      Image: 'D:\\fatura.exe',
      CommandLine: '"D:\\fatura.exe" /silent',
      ParentImage: 'C:\\Windows\\explorer.exe',
      User: 'SANDBOX\\analista',
      Hashes: 'SHA256=AB12',
    },
  },
  {
    id: 1,
    time: '2026-11-13T12:00:02.0000000Z',
    data: {
      ProcessId: '4512',
      ParentProcessId: '4410',
      Image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      CommandLine: 'powershell -enc SQBFAFgA',
      ParentImage: 'D:\\fatura.exe',
    },
  },
  {
    id: 22,
    time: '2026-11-13T12:00:03.0000000Z',
    data: { Image: 'powershell.exe', QueryName: 'c2.evil.example', QueryResults: '203.0.113.7;' },
  },
  {
    id: 3,
    time: '2026-11-13T12:00:04.0000000Z',
    data: {
      Image: 'powershell.exe',
      Protocol: 'tcp',
      DestinationIp: '203.0.113.7',
      DestinationPort: '443',
      DestinationHostname: '-',
    },
  },
  {
    id: 11,
    time: '2026-11-13T12:00:05.0000000Z',
    data: { Image: 'powershell.exe', TargetFilename: 'C:\\Users\\Public\\stage2.dll' },
  },
  {
    id: 13,
    time: '2026-11-13T12:00:06.0000000Z',
    data: {
      Image: 'powershell.exe',
      EventType: 'SetValue',
      TargetObject: 'HKU\\S-1-5-21\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\upd',
      Details: 'C:\\Users\\Public\\stage2.dll',
    },
  },
];

/** MAC da placa de rede de uma VM simulada (BC:24:11 e o prefixo do Proxmox). */
export function mockMac(vmid: number): string {
  const hex = vmid.toString(16).toUpperCase().padStart(6, '0');
  return `BC:24:11:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}`;
}

export function pveMockReset(): void {
  agentRuns = 0;
  agentJobs.clear();
  mockAutoRuns.length = 0;
  agentPid = 1000;
  vms.clear();
  tasks.clear();
  isos.clear();
  nextId = 9000;
  taskSeq = 0;
}

function upid(kind: string, vmid: number): string {
  taskSeq += 1;
  return `UPID:mock:0000${taskSeq.toString(16).padStart(4, '0')}:00000000:00000000:${kind}:${vmid}:root@pam:`;
}

function schedule(kind: string, vmid: number, ms: number, exitstatus = 'OK'): string {
  const id = upid(kind, vmid);
  tasks.set(id, { upid: id, finishAt: Date.now() + ms, exitstatus });
  return id;
}

export function pveMockUploadIso(filename: string, size: number): Promise<string> {
  isos.set(filename, size);
  return Promise.resolve(schedule('imgcopy', 0, UPLOAD_MS));
}

/** PNG 1x1 valido (usado no lugar do screenshot real no modo mock). */
export function pveMockScreenshot(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
}

export async function pveMock(
  path: string,
  method: PveMethod,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const clean = path.split('?')[0];

  if (clean === '/version') return { version: '8.2.2', release: 'mock' };

  if (clean === '/cluster/nextid') return String(nextId);

  if (clean === '/access/ticket') {
    return { ticket: 'PVE:mock:0::mock', CSRFPreventionToken: 'mock-csrf' };
  }

  // ---- storage ----
  if (/\/storage\/[^/]+\/status$/.test(clean)) {
    return { content: 'iso,vztmpl,backup', active: 1 };
  }
  if (/\/storage\/[^/]+\/content$/.test(clean)) {
    return [...isos.keys()].map((name) => ({ volid: `iso/${name}`, content: 'iso' }));
  }
  if (/\/storage\/[^/]+\/content\/[^/]+$/.test(clean) && method === 'DELETE') {
    const volid = decodeURIComponent(clean.split('/').pop() ?? '');
    isos.delete(volid.replace(/^.*\//, ''));
    return null;
  }

  // ---- tasks ----
  const taskMatch = clean.match(/\/tasks\/(.+)\/status$/);
  if (taskMatch) {
    const id = decodeURIComponent(taskMatch[1]);
    const task = tasks.get(id);
    if (!task) return { status: 'stopped', exitstatus: 'OK' };
    if (Date.now() < task.finishAt) return { status: 'running' };
    tasks.delete(id);
    return { status: 'stopped', exitstatus: task.exitstatus };
  }

  // ---- lista de VMs do node (reconciliacao) ----
  if (clean.endsWith('/qemu') && method === 'GET') {
    return [...vms.values()].map((vm) => ({
      vmid: vm.vmid,
      name: vm.name,
      status: vm.status,
      tags: vm.tags,
      template: vm.config.template ? 1 : undefined,
    }));
  }

  const vmMatch = clean.match(/\/qemu\/(\d+)(\/.*)?$/);
  if (vmMatch) {
    const vmid = Number(vmMatch[1]);
    const rest = vmMatch[2] ?? '';

    if (rest === '/clone' && method === 'POST') {
      const newId = Number(body?.newid ?? 0) || nextId;
      vms.set(newId, {
        vmid: newId,
        name: String(body?.name ?? `vm-${newId}`),
        status: 'stopped',
        // Placa de rede com MAC (plano pos-revisao, 5.4: a captura filtra por ele).
        config: { net0: `virtio=${mockMac(newId)},bridge=vmbr1,firewall=0` },
      });
      nextId = Math.max(nextId, newId) + 1;
      return schedule('qmclone', newId, CLONE_MS);
    }

    if (rest === '/config' && method === 'PUT') {
      const vm = vms.get(vmid);
      if (!vm) throw new Error(`VM ${vmid} nao existe`);
      vm.config = { ...vm.config, ...(body ?? {}) };
      if (body?.name) vm.name = String(body.name);
      if (body?.tags) vm.tags = String(body.tags);
      return null;
    }

    if (rest === '/config' && method === 'GET') {
      return vms.get(vmid)?.config ?? {};
    }

    if (rest === '/status/current') {
      // O template e criado sob demanda para o health check passar no modo mock.
      if (!vms.has(vmid) && vmid === env.PROXMOX_TEMPLATE_VMID) {
        vms.set(vmid, {
          vmid,
          name: `${env.SANDBOX_TAG}-template`,
          status: 'stopped',
          // Como no PVE: o template tem a flag e, de proposito, a etiqueta do sandbox (o clone a
          // herda); a protecao do template nao pode depender de nenhuma das duas faltar.
          tags: env.SANDBOX_TAG,
          config: { template: 1, tags: env.SANDBOX_TAG },
        });
      }
      const vm = vms.get(vmid);
      if (!vm) throw new Error(`VM ${vmid} nao existe`);
      return { vmid, name: vm.name, status: vm.status, qmpstatus: vm.status };
    }

    if (rest === '/status/start' && method === 'POST') {
      const vm = vms.get(vmid);
      if (!vm) throw new Error(`VM ${vmid} nao existe`);
      vm.status = 'running';
      return schedule('qmstart', vmid, START_MS);
    }

    if ((rest === '/status/stop' || rest === '/status/shutdown') && method === 'POST') {
      const vm = vms.get(vmid);
      if (vm) vm.status = 'stopped';
      return schedule('qmstop', vmid, STOP_MS);
    }

    if (rest === '/vncproxy' && method === 'POST') {
      return { port: 5900 + (vmid % 100), ticket: `PVEVNC:mock:${vmid}`, user: 'mock' };
    }

    if (rest === '/screenshot') return {};

    if (rest === '' && method === 'DELETE') {
      vms.delete(vmid);
      return schedule('qmdestroy', vmid, STOP_MS);
    }

    if (rest === '/agent/ping') {
      throw new Error('agent nao disponivel no mock');
    }

    // Agente do guest (revisao 3.7): um Windows com tres processos e, a partir da segunda
    // listagem, mais dois, como se a amostra tivesse comecado a rodar.
    // VM 9999: simula o agente desligado no guest.
    if (rest.startsWith('/agent/') && vmid === 9999) {
      throw new Error('QEMU guest agent is not running');
    }
    if (rest.startsWith('/agent/') && mockAgentBusy.calls > 0) {
      mockAgentBusy.calls -= 1;
      throw new Error(`VM ${vmid} qga command 'guest-exec' failed - got timeout`);
    }
    if (rest === '/agent/get-osinfo') {
      return { result: { id: 'mswindows', name: 'Microsoft Windows 10' } };
    }
    if (rest === '/agent/exec' && method === 'POST') {
      const command = (body?.command ?? []) as string[];
      // PowerShell em Base64: o marcador diz qual comando e (execucao automatica, conferencia do
      // Sysmon ou a leitura dele).
      const encoded = command.includes('-EncodedCommand') ? command.at(-1) : null;
      const script = encoded ? Buffer.from(encoded, 'base64').toString('utf16le') : '';
      const kind = !encoded
        ? 'processes'
        : script.includes('DEEPLOOK_AUTORUN')
          ? 'autorun'
          : script.includes('DEEPLOOK_SYSMON_PROBE')
            ? 'probe'
            : 'sysmon';
      if (kind === 'autorun' && mockAgentBusy.autorunStart) {
        mockAgentBusy.autorunTries += 1;
        throw new Error(`VM ${vmid} qga command 'guest-exec' failed - got timeout`);
      }
      if (kind === 'autorun') mockAutoRuns.push({ vmid, script });
      if (kind === 'processes') agentRuns += 1;
      agentPid += 1;
      agentJobs.set(agentPid, kind);
      return { pid: agentPid };
    }
    // VM 9998: Windows sem o Sysmon no template (plano pos-revisao, item 5.3).
    const execPid = Number(/pid=(\d+)/.exec(path)?.[1] ?? 0);
    if (rest.startsWith('/agent/exec-status') && agentJobs.get(execPid) === 'probe') {
      return { exited: 1, exitcode: 0, 'out-data': vmid === 9998 ? 'SYSMON_AUSENTE' : 'SYSMON_OK' };
    }
    if (rest.startsWith('/agent/exec-status') && agentJobs.get(execPid) === 'autorun') {
      return { exited: 1, exitcode: 0, 'out-data': 'AUTORUN_OK|SANDBOX\\analista\r\n' };
    }
    if (rest.startsWith('/agent/exec-status') && agentJobs.get(execPid) === 'sysmon') {
      const out =
        vmid === 9998
          ? 'DEEPLOOK_SEM_SYSMON'
          : mockSysmon.broken
            ? 'saida cortada'
            : JSON.stringify(MOCK_SYSMON_EVENTS);
      return { exited: 1, exitcode: 0, 'out-data': out };
    }
    if (rest.startsWith('/agent/exec-status')) {
      const lines = [
        '"ProcessId","ParentProcessId","Name","CommandLine"',
        '"4","0","System",""',
        '"612","4","smss.exe","\\SystemRoot\\System32\\smss.exe"',
        '"3020","2988","explorer.exe","C:\\Windows\\Explorer.EXE"',
        ...(agentRuns > 1
          ? [
              '"4410","3020","fatura.exe","""D:\\fatura.exe"" /silent"',
              '"4512","4410","powershell.exe","powershell -enc SQBFAFgA"',
            ]
          : []),
      ];
      return { exited: 1, exitcode: 0, 'out-data': lines.join('\r\n') };
    }
  }

  throw new Error(`mock: rota nao implementada ${method} ${path}`);
}
