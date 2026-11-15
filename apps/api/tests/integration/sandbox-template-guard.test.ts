export {};

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// Protecao do template (pedido do dono antes do teste no Proxmox real): nada apaga, liga, desliga
// ou reconfigura o template, nem a limpeza de VMs orfas da subida, mesmo com a etiqueta do sandbox
// no template (o clone a herda).
async function main() {
  process.env.SANDBOX_ENABLED = 'true';
  process.env.PROXMOX_MOCK = 'true';
  process.env.PROXMOX_TEMPLATE_VMID = '100';
  const { prisma } = await import('../../src/lib/prisma');
  const { pve, TemplateProtectedError } = await import('../../src/lib/proxmox');
  const { pveMockReset, pveMockUploadIso } = await import('../../src/lib/proxmox-mock');
  const { reconcileOrphans, sandboxInstance } = await import('../../src/lib/sandbox');
  pveMockReset();

  const refused = async (label: string, call: () => Promise<unknown>) => {
    const err = await call().then(
      () => null,
      (e: unknown) => e,
    );
    ok(label, err instanceof TemplateProtectedError, String(err));
  };
  const exists = async (vmid: number) =>
    pve(`/nodes/pve/qemu/${vmid}/status/current`).then(
      () => true,
      () => false,
    );

  // O template passa a existir no simulado (com a flag e a etiqueta do sandbox).
  ok('template existe', await exists(100));
  await refused('apagar o template: recusado', () =>
    pve('/nodes/pve/qemu/100', { method: 'DELETE', body: { purge: true } }),
  );
  await refused('ligar o template: recusado', () =>
    pve('/nodes/pve/qemu/100/status/start', { method: 'POST' }),
  );
  await refused('desligar o template: recusado', () =>
    pve('/nodes/pve/qemu/100/status/stop', { method: 'POST' }),
  );
  await refused('reconfigurar o template: recusado', () =>
    pve('/nodes/pve/qemu/100/config', { method: 'PUT', body: { name: 'x' } }),
  );
  ok('template ainda existe', await exists(100));

  // Clonar continua permitido.
  const clone = await pve<string>('/nodes/pve/qemu/100/clone', {
    method: 'POST',
    body: { newid: 9001, name: 'deeplook-sandbox-orfa' },
  }).then(
    (v) => v,
    (e: unknown) => String(e),
  );
  ok('clonar o template: permitido', String(clone).startsWith('UPID:'), clone);

  // Outra VM marcada como template tambem nao e apagada (conferido no PVE antes do DELETE).
  await pve('/nodes/pve/qemu/100/clone', { method: 'POST', body: { newid: 9002, name: 'outro' } });
  await pve('/nodes/pve/qemu/9002/config', { method: 'PUT', body: { template: 1 } });
  await refused('apagar outra VM que é template: recusado', () =>
    pve('/nodes/pve/qemu/9002', { method: 'DELETE' }),
  );

  // Limpeza da subida: apaga a orfa com a marca desta instancia, nunca o template (que tambem tem a
  // etiqueta), nem o que e de outra instancia no mesmo Proxmox ou de antes da marca.
  const own = await sandboxInstance();
  ok('identidade da instância guardada no banco', /^[a-f0-9]{8}$/.test(own), own);
  await pve('/nodes/pve/qemu/9001/config', {
    method: 'PUT',
    body: { tags: `deeplook-sandbox;dl-${own}` },
  });
  for (const [vmid, tags] of [
    [9003, 'deeplook-sandbox;dl-0badc0de'],
    [9004, 'deeplook-sandbox'],
  ] as const) {
    await pve('/nodes/pve/qemu/100/clone', {
      method: 'POST',
      body: { newid: vmid, name: `deeplook-sandbox-${vmid}` },
    });
    await pve(`/nodes/pve/qemu/${vmid}/config`, { method: 'PUT', body: { tags } });
  }
  await pveMockUploadIso(`deeplook-${own}-orfa.iso`, 1);
  await pveMockUploadIso('deeplook-0badc0de-de-outra.iso', 1);
  await pveMockUploadIso('deeplook-antiga.iso', 1);
  const result = await reconcileOrphans();
  const isos = ((await pve('/nodes/pve/storage/local/content?content=iso')) as { volid: string }[])
    .map((i) => i.volid)
    .sort();
  ok(
    'limpeza da subida apaga só a VM e a ISO órfãs desta instância',
    result.vms === 1 && result.isos === 1 && !(await exists(9001)),
    result,
  );
  ok(
    'mantém as de outra instância no mesmo Proxmox e as de antes da marca',
    (await exists(9003)) &&
      (await exists(9004)) &&
      JSON.stringify(isos) ===
        JSON.stringify(['iso/deeplook-0badc0de-de-outra.iso', 'iso/deeplook-antiga.iso']),
    isos,
  );
  ok('limpeza da subida não toca no template', await exists(100));
  ok('nem no outro template', await exists(9002));

  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
