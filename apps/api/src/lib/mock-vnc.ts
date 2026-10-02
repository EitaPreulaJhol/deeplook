import type { RawData, WebSocket } from 'ws';

/**
 * VNC minimo usado apenas no modo mock (PROXMOX_MOCK=true sem
 * SANDBOX_MOCK_VNC_URL): responde o handshake RFB 3.8 e manda uma tela escura,
 * para o noVNC conectar de verdade e validar todo o tunel do console
 * (browser -> nginx -> API -> backend do console) sem um PVE.
 */
export function attachMockVnc(socket: WebSocket): void {
  const WIDTH = 640;
  const HEIGHT = 400;
  const NAME = 'DeepLook sandbox (mock)';

  let stage = 0;

  socket.send(Buffer.from('RFB 003.008\n', 'latin1'), { binary: true });

  const serverInit = (): Buffer => {
    const head = Buffer.alloc(24);
    head.writeUInt16BE(WIDTH, 0);
    head.writeUInt16BE(HEIGHT, 2);
    // PixelFormat: 32bpp, profundidade 24, little-endian, true color.
    head.writeUInt8(32, 4);
    head.writeUInt8(24, 5);
    head.writeUInt8(0, 6);
    head.writeUInt8(1, 7);
    head.writeUInt16BE(255, 8);
    head.writeUInt16BE(255, 10);
    head.writeUInt16BE(255, 12);
    head.writeUInt8(16, 14);
    head.writeUInt8(8, 15);
    head.writeUInt8(0, 16);
    head.writeUInt32BE(Buffer.byteLength(NAME, 'latin1'), 20);
    return Buffer.concat([head, Buffer.from(NAME, 'latin1')]);
  };

  const darkFrame = (): Buffer => {
    const header = Buffer.alloc(16);
    header.writeUInt8(0, 0); // FramebufferUpdate
    header.writeUInt8(0, 1); // padding
    header.writeUInt16BE(1, 2); // 1 retangulo
    header.writeUInt16BE(0, 4);
    header.writeUInt16BE(0, 6);
    header.writeUInt16BE(WIDTH, 8);
    header.writeUInt16BE(HEIGHT, 10);
    header.writeInt32BE(0, 12); // encoding RAW
    return Buffer.concat([header, Buffer.alloc(WIDTH * HEIGHT * 4, 0x1c)]);
  };

  socket.on('message', (_data: RawData) => {
    stage += 1;
    if (stage === 1) {
      // ClientInit? Nao: primeiro chega a versao do cliente -> oferece "None".
      socket.send(Buffer.from([1, 1]), { binary: true });
      return;
    }
    if (stage === 2) {
      // Escolha do tipo de seguranca -> SecurityResult OK.
      socket.send(Buffer.from([0, 0, 0, 0]), { binary: true });
      return;
    }
    if (stage === 3) {
      // ClientInit -> ServerInit + um quadro escuro.
      socket.send(Buffer.concat([serverInit(), darkFrame()]), { binary: true });
    }
  });

  socket.on('error', () => {
    try {
      socket.close();
    } catch {
      /* noop */
    }
  });
}
