// Gerador de quadros Ethernet para os testes (plano pos-revisao, item 5.4): uma consulta DNS e uma
// conversa HTTP completa (handshake TCP, pedido, resposta), como a VM faria. Usado nos testes do
// netcap e na integracao da API, que manda os quadros por TZSP como o MikroTik.

const macBytes = (mac) => Buffer.from(mac.replace(/:/g, ''), 'hex');
const ipBytes = (ip) => Buffer.from(ip.split('.').map(Number));

function checksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 2) sum += (buf[i] << 8) + (buf[i + 1] ?? 0);
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

function ipv4(src, dst, proto, payload) {
  const h = Buffer.alloc(20);
  h[0] = 0x45;
  h.writeUInt16BE(20 + payload.length, 2);
  h.writeUInt16BE(Math.floor(Math.random() * 0xffff), 4);
  h[8] = 64;
  h[9] = proto;
  ipBytes(src).copy(h, 12);
  ipBytes(dst).copy(h, 16);
  h.writeUInt16BE(checksum(h), 10);
  return Buffer.concat([h, payload]);
}

function pseudo(src, dst, proto, segment) {
  const p = Buffer.alloc(12);
  ipBytes(src).copy(p, 0);
  ipBytes(dst).copy(p, 4);
  p[9] = proto;
  p.writeUInt16BE(segment.length, 10);
  return checksum(Buffer.concat([p, segment]));
}

function ethernet(srcMac, dstMac, payload) {
  return Buffer.concat([macBytes(dstMac), macBytes(srcMac), Buffer.from([0x08, 0x00]), payload]);
}

function udp(src, dst, sport, dport, data) {
  const h = Buffer.alloc(8);
  h.writeUInt16BE(sport, 0);
  h.writeUInt16BE(dport, 2);
  h.writeUInt16BE(8 + data.length, 4);
  const seg = Buffer.concat([h, data]);
  seg.writeUInt16BE(pseudo(src, dst, 17, seg) || 0xffff, 6);
  return seg;
}

const FLAGS = { FIN: 1, SYN: 2, PSH: 8, ACK: 16 };

function tcp(src, dst, sport, dport, seq, ack, flags, data = Buffer.alloc(0)) {
  const h = Buffer.alloc(20);
  h.writeUInt16BE(sport, 0);
  h.writeUInt16BE(dport, 2);
  h.writeUInt32BE(seq >>> 0, 4);
  h.writeUInt32BE(ack >>> 0, 8);
  h[12] = 5 << 4;
  h[13] = flags.reduce((a, f) => a | FLAGS[f], 0);
  h.writeUInt16BE(64240, 14);
  const seg = Buffer.concat([h, data]);
  seg.writeUInt16BE(pseudo(src, dst, 6, seg), 16);
  return seg;
}

/** Consulta DNS (tipo A) de `name`, da VM para o resolvedor. */
export function dnsQueryFrame({ vmMac, gwMac, vmIp, dnsIp, name, id = 0x1234 }) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(1, 4);
  const qname = Buffer.concat([
    ...name
      .split('.')
      .map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
    Buffer.from([0, 0, 1, 0, 1]),
  ]);
  const data = Buffer.concat([header, qname]);
  return ethernet(vmMac, gwMac, ipv4(vmIp, dnsIp, 17, udp(vmIp, dnsIp, 53001, 53, data)));
}

/** Uma conversa HTTP inteira: handshake, GET, resposta 200 e o fim, nos dois sentidos. */
export function httpFrames({ vmMac, gwMac, vmIp, serverIp, host, path = '/' }) {
  const [c, s] = [41000, 80];
  let cseq = 1000;
  let sseq = 5000;
  const out = (seg) => ethernet(vmMac, gwMac, ipv4(vmIp, serverIp, 6, seg));
  const back = (seg) => ethernet(gwMac, vmMac, ipv4(serverIp, vmIp, 6, seg));
  const request = Buffer.from(
    `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: deeplook-teste\r\nAccept: */*\r\n\r\n`,
  );
  const response = Buffer.from(
    'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok',
  );
  const frames = [];
  frames.push(out(tcp(vmIp, serverIp, c, s, cseq, 0, ['SYN'])));
  frames.push(back(tcp(serverIp, vmIp, s, c, sseq, cseq + 1, ['SYN', 'ACK'])));
  cseq += 1;
  sseq += 1;
  frames.push(out(tcp(vmIp, serverIp, c, s, cseq, sseq, ['ACK'])));
  frames.push(out(tcp(vmIp, serverIp, c, s, cseq, sseq, ['PSH', 'ACK'], request)));
  cseq += request.length;
  frames.push(back(tcp(serverIp, vmIp, s, c, sseq, cseq, ['ACK'])));
  frames.push(back(tcp(serverIp, vmIp, s, c, sseq, cseq, ['PSH', 'ACK'], response)));
  sseq += response.length;
  frames.push(out(tcp(vmIp, serverIp, c, s, cseq, sseq, ['ACK'])));
  frames.push(back(tcp(serverIp, vmIp, s, c, sseq, cseq, ['FIN', 'ACK'])));
  sseq += 1;
  frames.push(out(tcp(vmIp, serverIp, c, s, cseq, sseq, ['FIN', 'ACK'])));
  cseq += 1;
  frames.push(back(tcp(serverIp, vmIp, s, c, sseq, cseq, ['ACK'])));
  return frames;
}
