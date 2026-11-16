// Alvos do fuzzing (revisao de novembro, item 2.2): os parsers que leem entrada hostil. Cada alvo
// recebe os bytes e ou devolve um resultado, ou lanca um dos erros que a API ja trata como
// "arquivo invalido". Qualquer outra excecao, demora ou resultado gigante e um achado.
import { analyzeDelivery } from '../../src/lib/delivery-formats';
import { analyzeDiskImage, extractDiskFile } from '../../src/lib/disk-image';
import { parseEmail } from '../../src/lib/eml';
import { cleanEvidenceImage, EvidenceImageError } from '../../src/lib/evidence-image';
import { ImportError, parseImport } from '../../src/lib/ioc-import';
import { decodeScriptEncoder, normalizeScript } from '../../src/lib/script-deobfuscate';
import { analyzeBuffer } from '../../src/lib/static-analysis';
import { tlsh } from '../../src/lib/tlsh';
import { extractZipEntry, listZip, ZipError } from '../../src/lib/zip';

export type Target = {
  /** Erros esperados (entrada invalida): nao sao achados. */
  expected: (err: unknown) => boolean;
  run: (buf: Buffer) => unknown;
};

const never = () => false;

export const TARGETS: Record<string, Target> = {
  // O que roda em todo envio. "Nunca lanca", diz o proprio codigo: aqui se confere.
  static: {
    expected: never,
    run: (buf) => {
      // A extensao muda o caminho (script, disfarce de extensao): varia com o conteudo.
      const names = ['a.exe', 'a.pdf', 'a.docx', 'a.ps1', 'a.js', 'a.lnk', 'a.iso', 'a', null];
      return analyzeBuffer(buf, names[buf.length % names.length]);
    },
  },
  // Desofuscacao de scripts (plans/novas-analises, item 5): regex sobre texto hostil, nos quatro
  // sabores, e o decodificador do Script Encoder.
  deobfuscate: {
    expected: never,
    run: (buf) => {
      const text = buf.toString('latin1');
      const out = (['powershell', 'batch', 'vbscript', 'javascript'] as const).map(
        (f) => normalizeScript(text, f).text.length,
      );
      return { out, encoded: decodeScriptEncoder(`#@~^AAAAAA==${text}AAAAAA==^#~@`)?.length };
    },
  },
  // Formatos de entrega (plans/caca-e-formatos, item 4): o OneNote, o HTML e o MSI, cada um pelo
  // caminho dele (o MSI le o CFB e as tabelas guardadas por coluna).
  delivery: {
    expected: never,
    run: (buf) => {
      const out = [
        analyzeDelivery(buf, 'x.one', 'onenote'),
        analyzeDelivery(buf, 'x.html', 'html'),
        analyzeDelivery(buf, 'x.msi', 'ole'),
      ];
      return out.map((r) => r?.info.files.length ?? -1);
    },
  },
  zip: {
    expected: (err) => err instanceof ZipError,
    run: (buf) => {
      const entries = listZip(buf);
      let bytes = 0;
      for (const entry of entries.slice(0, 20)) {
        if (entry.dir) continue;
        for (const password of ['', 'infected']) {
          try {
            bytes += extractZipEntry(buf, entry, password, 4 * 1024 * 1024).length;
          } catch (err) {
            if (!(err instanceof ZipError)) throw err;
          }
        }
      }
      return { entries: entries.length, bytes };
    },
  },
  disk: {
    expected: never,
    run: (buf) => {
      const info = analyzeDiskImage(buf);
      let bytes = 0;
      for (const file of info?.files.slice(0, 10) ?? []) {
        bytes += extractDiskFile(buf, file, 1024 * 1024)?.length ?? 0;
      }
      return { files: info?.files.length ?? 0, bytes };
    },
  },
  // O postal-mime lanca Error comum para o que nao e e-mail: a rota trata como arquivo invalido.
  // Aqui o que interessa e demora e resultado gigante.
  eml: {
    expected: (err) => err instanceof Error && !(err instanceof RangeError),
    run: async (buf) => {
      const mail = await parseEmail(buf, 1024 * 1024);
      return JSON.stringify(mail).length;
    },
  },
  image: {
    expected: (err) => err instanceof EvidenceImageError,
    run: (buf) => {
      const image = cleanEvidenceImage(buf);
      return {
        type: image.type,
        width: image.width,
        height: image.height,
        size: image.data.length,
      };
    },
  },
  iocs: {
    expected: (err) => err instanceof ImportError,
    run: (buf) => {
      const text = buf.toString('utf8');
      return [parseImport(text, 'watch'), parseImport(text, 'allow')].map((p) => p.items.length);
    },
  },
  tlsh: { expected: never, run: (buf) => tlsh(buf) },
};
