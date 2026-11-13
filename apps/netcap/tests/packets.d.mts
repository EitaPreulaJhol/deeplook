// Tipos de packets.mjs, para os testes da API (TypeScript) montarem o trafego da VM.
interface Net {
  vmMac: string;
  gwMac: string;
  vmIp: string;
}
export function dnsQueryFrame(opts: Net & { dnsIp: string; name: string; id?: number }): Buffer;
export function httpFrames(opts: Net & { serverIp: string; host: string; path?: string }): Buffer[];
