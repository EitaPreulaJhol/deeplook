// TZSP (TaZmen Sniffer Protocol) e pcap, sem dependencias (plano pos-revisao, item 5.4).
//
// O sniffer do RouterOS (`/tool/sniffer`, com `streaming-enabled`) manda cada pacote capturado
// num datagrama UDP: um cabecalho de 4 bytes (versao 1, tipo, protocolo encapsulado), campos
// opcionais com etiqueta ate a etiqueta END (1) e, depois, o quadro Ethernet inteiro.

export const TZSP_VERSION = 1;
/** Protocolo encapsulado: Ethernet. */
export const TZSP_ETHERNET = 1;
const TAG_PADDING = 0;
const TAG_END = 1;
const ETHERNET_HEADER = 14;

/**
 * O quadro Ethernet dentro de um datagrama TZSP, ou null se o datagrama nao for TZSP v1 com
 * Ethernet (ou vier truncado).
 */
export function parseTzsp(datagram) {
  if (!Buffer.isBuffer(datagram) || datagram.length < 5) return null;
  if (datagram[0] !== TZSP_VERSION) return null;
  if (datagram.readUInt16BE(2) !== TZSP_ETHERNET) return null;
  let i = 4;
  for (;;) {
    if (i >= datagram.length) return null;
    const tag = datagram[i];
    if (tag === TAG_PADDING) {
      i += 1;
    } else if (tag === TAG_END) {
      i += 1;
      break;
    } else {
      if (i + 1 >= datagram.length) return null;
      i += 2 + datagram[i + 1];
    }
  }
  const frame = datagram.subarray(i);
  return frame.length >= ETHERNET_HEADER ? frame : null;
}

const hex = (b) => b.toString(16).padStart(2, '0').toUpperCase();
const macAt = (frame, offset) => [...frame.subarray(offset, offset + 6)].map(hex).join(':');

/** Os enderecos do quadro: destino e origem (AA:BB:CC:DD:EE:FF). */
export function frameMacs(frame) {
  return { dst: macAt(frame, 0), src: macAt(frame, 6) };
}

/** MAC no formato canonico (maiusculo, com dois-pontos), ou null se nao for um MAC. */
export function normalizeMac(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[:\-.]/g, '');
  if (!/^[0-9a-fA-F]{12}$/.test(digits)) return null;
  return digits.toUpperCase().match(/../g).join(':');
}

/** Cabecalho do pcap classico (microssegundos, Ethernet, quadros de ate 65535 bytes). */
export function pcapHeader() {
  const h = Buffer.alloc(24);
  h.writeUInt32LE(0xa1b2c3d4, 0);
  h.writeUInt16LE(2, 4);
  h.writeUInt16LE(4, 6);
  h.writeInt32LE(0, 8);
  h.writeUInt32LE(0, 12);
  h.writeUInt32LE(65535, 16);
  h.writeUInt32LE(1, 20);
  return h;
}

/** Um registro do pcap: cabecalho de 16 bytes e o quadro. */
export function pcapRecord(frame, timeMs = Date.now()) {
  const data = frame.length > 65535 ? frame.subarray(0, 65535) : frame;
  const h = Buffer.alloc(16);
  h.writeUInt32LE(Math.floor(timeMs / 1000), 0);
  h.writeUInt32LE(Math.floor((timeMs % 1000) * 1000), 4);
  h.writeUInt32LE(data.length, 8);
  h.writeUInt32LE(frame.length, 12);
  return Buffer.concat([h, data]);
}

/** Para testes: embrulha um quadro num datagrama TZSP como o RouterOS manda. */
export function tzspDatagram(frame) {
  const head = Buffer.from([TZSP_VERSION, 0, 0, TZSP_ETHERNET, TAG_END]);
  return Buffer.concat([head, frame]);
}
