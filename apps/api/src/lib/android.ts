import { z } from 'zod';

import { env } from '../env';
import { extractIocs } from './iocs';
import { registerService, type ServiceAlert } from './service-analysis';

/**
 * APK/Android com o androguard (plans/novas-analises, item 6): o servico android (apps/android) le o
 * manifesto, os certificados e a tabela de strings dos DEX; nada do aplicativo e executado. Todo
 * APK enviado vai sozinho para a fila.
 */

const text = (max: number) => z.string().max(max);
const opt = (max: number) => text(max).nullable().optional();

export const androidSchema = z.object({
  sha256: text(64).optional(),
  package: opt(300),
  appName: opt(300),
  versionName: opt(100),
  versionCode: opt(40),
  minSdk: opt(10),
  targetSdk: opt(10),
  mainActivity: opt(300),
  permissions: z
    .array(z.object({ name: text(300), short: text(200), dangerous: z.boolean() }))
    .max(300),
  components: z.object({
    activities: z.number().int().nonnegative(),
    services: z.number().int().nonnegative(),
    receivers: z.number().int().nonnegative(),
    providers: z.number().int().nonnegative(),
  }),
  exported: z
    .array(
      z.object({
        kind: text(40),
        name: opt(300),
        permission: opt(300),
        actions: z.array(text(200).nullable()).max(10),
      }),
    )
    .max(300),
  certificates: z
    .array(
      z.object({
        subject: opt(400),
        issuer: opt(400),
        serial: opt(80),
        sha256: text(64),
        notBefore: opt(40),
        notAfter: opt(40),
        selfSigned: z.boolean(),
        debug: z.boolean(),
      }),
    )
    .max(5),
  signed: z.object({ v1: z.boolean(), v2: z.boolean(), v3: z.boolean() }),
  apis: z.array(text(40)).max(50),
  urls: z.array(text(500).nullable()).max(300),
  ips: z.array(text(45)).max(300),
  domains: z.array(text(300)).max(300),
  dexFiles: z.array(text(100)).max(50),
  nativeLibs: z.array(text(300).nullable()).max(300),
  hiddenPayloads: z.array(text(300).nullable()).max(300),
  fileCount: z.number().int().nonnegative(),
  dexErrors: z.array(text(200).nullable()).max(10),
});
export type AndroidResult = z.infer<typeof androidSchema>;

/** Lista curta e neutra no idioma ("a, b, c (+2)"): o texto vai traduzido pelo modelo inteiro. */
const list = (items: string[], max = 4) =>
  items.length > max
    ? `${items.slice(0, max).join(', ')} (+${items.length - max})`
    : items.join(', ');

/** Alertas legiveis: as combinacoes de permissoes e APIs tipicas de banker, spyware e dropper. */
export function androidAlerts(r: AndroidResult): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  const perms = new Set(r.permissions.map((p) => p.short));
  const apis = new Set(r.apis);
  const accessibility = perms.has('BIND_ACCESSIBILITY_SERVICE') || apis.has('accessibility');
  const sms =
    ['READ_SMS', 'RECEIVE_SMS', 'SEND_SMS'].some((p) => perms.has(p)) || apis.has('sms_send');
  if (accessibility && sms) {
    alerts.push({
      level: 'high',
      text: 'Acessibilidade com SMS: a combinação típica de trojan bancário (lê a tela e intercepta códigos).',
    });
  } else if (accessibility) {
    alerts.push({
      level: 'medium',
      text: 'Usa o serviço de acessibilidade (pode ler a tela e tocar por quem usa o aparelho).',
    });
  }
  if (perms.has('SEND_SMS') || apis.has('sms_send')) {
    alerts.push({ level: 'medium', text: 'Envia SMS (fraude por SMS pago, espalha links).' });
  }
  if (perms.has('BIND_DEVICE_ADMIN') || apis.has('device_admin')) {
    alerts.push({
      level: 'high',
      text: 'Pede administrador do dispositivo (dificulta a remoção, pode bloquear a tela).',
    });
  }
  const loader = ['dex_loader', 'in_memory_dex'].filter((a) => apis.has(a));
  if (loader.length || r.hiddenPayloads.length) {
    alerts.push({
      level: 'high',
      text: `Carrega código em tempo de execução${
        r.hiddenPayloads.length
          ? `: ${list(
              r.hiddenPayloads.filter((x): x is string => Boolean(x)),
              3,
            )}`
          : ''
      }.`,
    });
  }
  if (perms.has('SYSTEM_ALERT_WINDOW') || apis.has('overlay')) {
    alerts.push({
      level: 'medium',
      text: 'Desenha sobre outros aplicativos (telas falsas de login).',
    });
  }
  if (perms.has('BIND_NOTIFICATION_LISTENER_SERVICE') || apis.has('notification_listener')) {
    alerts.push({
      level: 'medium',
      text: 'Lê as notificações (códigos de verificação, mensagens).',
    });
  }
  if (perms.has('REQUEST_INSTALL_PACKAGES') || apis.has('package_install')) {
    alerts.push({ level: 'medium', text: 'Instala outros aplicativos.' });
  }
  if (apis.has('screen_capture')) {
    alerts.push({ level: 'medium', text: 'Grava ou transmite a tela.' });
  }
  if (apis.has('runtime_exec') || apis.has('su_binary')) {
    alerts.push({ level: 'medium', text: 'Executa comandos do sistema (ou procura o su).' });
  }
  if (r.certificates.some((c) => c.debug)) {
    alerts.push({ level: 'medium', text: 'Assinado com o certificado de depuração do Android.' });
  }
  if (!r.signed.v1 && !r.signed.v2 && !r.signed.v3) {
    alerts.push({
      level: 'medium',
      text: 'O APK não está assinado (o Android não instala assim).',
    });
  }
  const dangerous = r.permissions.filter((p) => p.dangerous).map((p) => p.short);
  if (dangerous.length) {
    alerts.push({
      level: 'info',
      text: `${dangerous.length} permissão(ões) perigosa(s): ${list(dangerous, 6)}`,
    });
  }
  return alerts;
}

/** URLs, IPs e dominios da tabela de strings (o extrator de IOCs tira os locais e os comuns). */
export function androidIocs(r: AndroidResult): string[] {
  const parts = [
    ...r.urls.filter((u): u is string => Boolean(u)),
    ...r.ips,
    ...r.domains,
    ...r.certificates.map((c) => c.sha256),
  ];
  return extractIocs(parts.join('\n')).map((i) => i.value);
}

export const androidService = registerService({
  kind: 'ANDROID',
  name: 'android',
  url: () => env.ANDROID_URL,
  token: () => env.ANDROID_TOKEN,
  timeoutS: () => env.ANDROID_REQUEST_TIMEOUT_S,
  maxMb: () => env.ANDROID_MAX_MB,
  path: '/analyze',
  autoKinds: new Set(['apk']),
  manualOk: (typeId) => typeId === 'apk' || typeId === 'zip' || typeId === 'jar',
  query: () => '',
  schema: androidSchema,
  alerts: androidAlerts,
  iocs: androidIocs,
});
