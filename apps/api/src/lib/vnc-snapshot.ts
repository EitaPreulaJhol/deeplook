import crypto from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

import WebSocket from 'ws';

/**
 * Print da tela de uma VM pelo console VNC (revisao de novembro, 3.7). O PVE 9 tirou o endpoint
 * de screenshot (responde 501), e o botao "Capturar tela" passou a ler o canvas do noVNC no
 * navegador. Para guardar prints sem ninguem com o console aberto, a API faz o mesmo que o noVNC:
 * abre o vncwebsocket do PVE, autentica com a senha do vncproxy, pede UM quadro inteiro da tela
 * (codificacao Raw) e fecha. Nao envia teclado nem mouse.
 *
 * So o necessario do RFB 3.8: versao, seguranca None ou VNC (DES), ClientInit compartilhado (quem
 * esta no console nao cai), SetPixelFormat, SetEncodings e um FramebufferUpdateRequest.
 */

const MAX_SIDE = 4096;
const TIMEOUT_MS = 15_000;

/** DES-ECB de um bloco. O OpenSSL 3 so tem DES simples no provedor legado; o 3DES de duas chaves
 * com as duas metades iguais (E_K(D_K(E_K(x)))) e exatamente o DES com a chave K. */
export function desEncrypt(key: Buffer, data: Buffer): Buffer {
  const cipher = crypto.createCipheriv('des-ede-ecb', Buffer.concat([key, key]), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/** Resposta ao desafio do VNC: a senha (8 bytes) com os bits de cada byte invertidos e DES. */
export function vncAuthResponse(password: string, challenge: Buffer): Buffer {
  const key = Buffer.alloc(8);
  Buffer.from(password, 'latin1').copy(key, 0, 0, 8);
  for (let i = 0; i < 8; i++) {
    let b = key[i];
    let r = 0;
    for (let bit = 0; bit < 8; bit++) {
      r = (r << 1) | (b & 1);
      b >>= 1;
    }
    key[i] = r;
  }
  return desEncrypt(key, challenge);
}

/** PNG RGB de 8 bits a partir de pixels BGRX (o formato pedido ao servidor). */
export function encodePng(width: number, height: number, bgrx: Buffer): Buffer {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filtro: nenhum
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = row + 1 + x * 3;
      raw[dst] = bgrx[src + 2];
      raw[dst + 1] = bgrx[src + 1];
      raw[dst + 2] = bgrx[src];
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bits por canal
  ihdr.writeUInt8(2, 9); // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Leitor sequencial sobre as mensagens do WebSocket: pede N bytes e espera chegarem. */
class Reader {
  private buffer = Buffer.alloc(0);
  private waiting: { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void } | null =
    null;
  private failed: Error | null = null;

  push(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    this.flush();
  }

  fail(err: Error): void {
    this.failed ??= err;
    this.flush();
  }

  /** Entrega o pedido se ja ha bytes; se a conexao caiu antes, rejeita. Nunca lanca. */
  private flush(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    if (this.buffer.length >= waiting.n) {
      const out = this.buffer.subarray(0, waiting.n);
      this.buffer = this.buffer.subarray(waiting.n);
      this.waiting = null;
      waiting.resolve(out);
    } else if (this.failed) {
      this.waiting = null;
      waiting.reject(this.failed);
    }
  }

  read(n: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.waiting = { n, resolve, reject };
      this.flush();
    });
  }
}

/**
 * Um quadro da tela pelo console VNC, como PNG. `url` e `headers` sao os do vncwebsocket do PVE
 * (ou de um servidor de teste); `password`, a do vncproxy.
 */
export async function vncSnapshot(
  url: string,
  options: { password: string; headers?: Record<string, string>; rejectUnauthorized?: boolean },
): Promise<Buffer> {
  const ws = new WebSocket(url, ['binary'], {
    headers: options.headers,
    rejectUnauthorized: options.rejectUnauthorized ?? true,
    perMessageDeflate: false,
    handshakeTimeout: TIMEOUT_MS,
  });
  const reader = new Reader();
  ws.on('message', (data: WebSocket.RawData) =>
    reader.push(Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer)),
  );
  ws.on('error', (err) => reader.fail(err));
  ws.on('close', () => reader.fail(new Error('o console fechou a conexão')));
  const timer = setTimeout(() => {
    reader.fail(new Error('o console não respondeu a tempo'));
    ws.terminate();
  }, TIMEOUT_MS);
  const send = (data: Buffer) => ws.send(data, { binary: true });

  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    // Versao.
    const version = (await reader.read(12)).toString('latin1');
    if (!/^RFB 003\.\d{3}\n$/.test(version)) throw new Error('o console não falou RFB');
    send(Buffer.from('RFB 003.008\n', 'latin1'));
    // Seguranca: None (1) ou VNC (2).
    const count = (await reader.read(1))[0];
    if (count === 0) {
      const len = (await reader.read(4)).readUInt32BE(0);
      throw new Error(
        `o console recusou: ${(await reader.read(Math.min(len, 500))).toString('latin1')}`,
      );
    }
    const types = [...(await reader.read(count))];
    const type = types.includes(2) ? 2 : types.includes(1) ? 1 : 0;
    if (!type) throw new Error(`segurança do console não suportada (${types.join(',')})`);
    send(Buffer.from([type]));
    if (type === 2) send(vncAuthResponse(options.password, await reader.read(16)));
    if ((await reader.read(4)).readUInt32BE(0) !== 0) throw new Error('senha do console recusada');
    // ClientInit compartilhado e ServerInit.
    send(Buffer.from([1]));
    const init = await reader.read(24);
    const width = init.readUInt16BE(0);
    const height = init.readUInt16BE(2);
    await reader.read(init.readUInt32BE(20));
    if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) {
      throw new Error(`tela de tamanho inesperado (${width}x${height})`);
    }
    // 32 bits por pixel, little-endian, cor verdadeira: B, G, R, X na memoria.
    const format = Buffer.alloc(20);
    format.writeUInt8(0, 0);
    format.writeUInt8(32, 4);
    format.writeUInt8(24, 5);
    format.writeUInt8(0, 6);
    format.writeUInt8(1, 7);
    format.writeUInt16BE(255, 8);
    format.writeUInt16BE(255, 10);
    format.writeUInt16BE(255, 12);
    format.writeUInt8(16, 14);
    format.writeUInt8(8, 15);
    format.writeUInt8(0, 16);
    send(format);
    const encodings = Buffer.alloc(8);
    encodings.writeUInt8(2, 0);
    encodings.writeUInt16BE(1, 2);
    encodings.writeInt32BE(0, 4); // Raw
    send(encodings);
    const request = Buffer.alloc(10);
    request.writeUInt8(3, 0); // FramebufferUpdateRequest, nao incremental
    request.writeUInt16BE(width, 6);
    request.writeUInt16BE(height, 8);
    send(request);

    const frame = Buffer.alloc(width * height * 4);
    let covered = 0;
    while (covered < width * height) {
      const kind = (await reader.read(1))[0];
      if (kind === 2) continue; // campainha
      if (kind === 3) {
        // Texto da area de transferencia: descartado.
        const head = await reader.read(7);
        await reader.read(head.readUInt32BE(3));
        continue;
      }
      if (kind === 1) {
        const head = await reader.read(5);
        await reader.read(head.readUInt16BE(3) * 6);
        continue;
      }
      if (kind !== 0) throw new Error(`mensagem inesperada do console (${kind})`);
      const rects = (await reader.read(3)).readUInt16BE(1);
      for (let r = 0; r < rects; r++) {
        const head = await reader.read(12);
        const [x, y, w, h] = [0, 2, 4, 6].map((o) => head.readUInt16BE(o));
        const encoding = head.readInt32BE(8);
        if (encoding !== 0) throw new Error(`codificação inesperada (${encoding})`);
        const data = await reader.read(w * h * 4);
        for (let row = 0; row < h; row++) {
          if (y + row >= height) break;
          const cols = Math.max(0, Math.min(w, width - x));
          data.copy(frame, ((y + row) * width + x) * 4, row * w * 4, row * w * 4 + cols * 4);
        }
        covered += w * h;
      }
    }
    return encodePng(width, height, frame);
  } finally {
    clearTimeout(timer);
    ws.removeAllListeners('close');
    ws.on('error', () => undefined);
    ws.close();
  }
}
