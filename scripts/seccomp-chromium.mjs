// Gera apps/capture/seccomp-chromium.json: o perfil seccomp padrao do Docker mais o minimo que
// o sandbox do Chromium precisa para subir sem nenhuma capacidade (item 6.16).
//
//   node scripts/seccomp-chromium.mjs           regrava o perfil
//   node scripts/seccomp-chromium.mjs --check   so confere que o arquivo bate com a geracao
//
// O padrao do Docker so libera clone/unshare com flags de namespace e chroot para quem tem
// CAP_SYS_ADMIN/CAP_SYS_CHROOT, e o capture roda com cap_drop: ALL. O sandbox do Chromium cria
// um user namespace (com pid e net) e faz chroot dentro dele. Entram tres regras:
//   - clone e unshare criando so os namespaces user, pid e net (mount, uts, ipc e cgroup
//     continuam barrados, entao nem dentro do namespace da para montar nada);
//   - chroot.
// A base vem de um commit fixo do moby/profiles: trocar a versao e uma decisao revisavel.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBY_COMMIT = '4b8214fc4971e06172938a1f1554ccff6647ee80';
const SOURCE = `https://raw.githubusercontent.com/moby/profiles/${MOBY_COMMIT}/seccomp/default.json`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'capture', 'seccomp-chromium.json');

// Flags de namespace do clone/unshare (linux/sched.h).
const NS = {
  NEWNS: 0x00020000,
  NEWCGROUP: 0x02000000,
  NEWUTS: 0x04000000,
  NEWIPC: 0x08000000,
  NEWUSER: 0x10000000,
  NEWPID: 0x20000000,
  NEWNET: 0x40000000,
};
/** Flags que continuam proibidas: (flags & FORBIDDEN) precisa dar 0. */
const FORBIDDEN = NS.NEWNS | NS.NEWCGROUP | NS.NEWUTS | NS.NEWIPC;
const onlyUserPidNet = (index) => [{ index, value: FORBIDDEN, valueTwo: 0, op: 'SCMP_CMP_MASKED_EQ' }];

const EXTRA = [
  {
    names: ['clone'],
    action: 'SCMP_ACT_ALLOW',
    args: onlyUserPidNet(0),
    comment: 'DeepLook: sandbox do Chromium (namespaces user, pid e net)',
    excludes: { arches: ['s390', 's390x'] },
  },
  {
    names: ['clone'],
    action: 'SCMP_ACT_ALLOW',
    args: onlyUserPidNet(1),
    comment: 'DeepLook: o mesmo, com a ordem de parametros do s390',
    includes: { arches: ['s390', 's390x'] },
  },
  {
    names: ['unshare'],
    action: 'SCMP_ACT_ALLOW',
    args: onlyUserPidNet(0),
    comment: 'DeepLook: sandbox do Chromium (namespaces user, pid e net)',
  },
  {
    names: ['chroot'],
    action: 'SCMP_ACT_ALLOW',
    comment: 'DeepLook: o sandbox do Chromium faz chroot dentro do proprio user namespace',
  },
];

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE}: ${res.status}`);
const profile = await res.json();
profile.syscalls.push(...EXTRA);
const text = `${JSON.stringify(profile, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== text) {
    console.error(`${OUT} difere do que o gerador produz: rode node scripts/seccomp-chromium.mjs`);
    process.exit(1);
  }
  console.log('perfil seccomp do capture confere com a geração');
} else {
  writeFileSync(OUT, text);
  console.log(`gravado ${OUT} (base moby/profiles ${MOBY_COMMIT.slice(0, 12)} + ${EXTRA.length} regras)`);
}
