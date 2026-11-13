// Tipos de tzsp.mjs, para os testes da API (TypeScript) importarem o gerador de TZSP.
export function parseTzsp(datagram: Buffer): Buffer | null;
export function frameMacs(frame: Buffer): { src: string; dst: string };
export function normalizeMac(value: unknown): string | null;
export function pcapHeader(): Buffer;
export function pcapRecord(frame: Buffer, timeMs?: number): Buffer;
export function tzspDatagram(frame: Buffer): Buffer;
