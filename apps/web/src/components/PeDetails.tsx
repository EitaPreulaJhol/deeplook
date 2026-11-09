import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';

import type { PeAlert, PeInfo } from '../api/types';
import { CopyButton } from './CopyButton';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmField, HpsmForm, HpsmReadonly } from './HpsmForm';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

/**
 * Partes da analise de PE do item 7.1 na secao "Analise estatica": alertas, hashes que ligam
 * amostras (imphash, Rich header), assinatura, versao, manifesto, .NET, recursos, exports e as
 * funcoes importadas. Analise antiga (sem estes campos) mostra so o que ja mostrava.
 */

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

const ALERT_TONE: Record<PeAlert['level'], StatusTone> = {
  high: 'red',
  medium: 'orange',
  info: 'none',
};

const VERSION_LABELS: Record<string, string> = {
  CompanyName: 'Empresa',
  FileDescription: 'Descrição',
  FileVersion: 'Versão do arquivo',
  InternalName: 'Nome interno',
  OriginalFilename: 'Nome original',
  ProductName: 'Produto',
  ProductVersion: 'Versão do produto',
  LegalCopyright: 'Copyright',
  Comments: 'Comentários',
};

/** Idiomas dos recursos: o idioma de quem compilou e uma pista de origem. */
const LANGS: Record<number, string> = {
  0: 'neutro',
  1033: 'inglês (EUA)',
  2057: 'inglês (Reino Unido)',
  1046: 'português (Brasil)',
  2070: 'português (Portugal)',
  3082: 'espanhol',
  1036: 'francês',
  1031: 'alemão',
  1040: 'italiano',
  1049: 'russo',
  1058: 'ucraniano',
  2052: 'chinês (simplificado)',
  1028: 'chinês (tradicional)',
  1041: 'japonês',
  1042: 'coreano',
  1065: 'persa',
  1025: 'árabe',
  1055: 'turco',
};

const EXECUTION_LEVELS: Record<string, { text: string; tone: StatusTone }> = {
  requireAdministrator: { text: 'pede administrador', tone: 'orange' },
  highestAvailable: { text: 'pede o maior privilégio disponível', tone: 'orange' },
  asInvoker: { text: 'roda com o usuário que abriu', tone: 'none' },
};

/** Conteudo embutido que chama atencao (executavel ou arquivo compactado). */
const RISKY_CONTENT = new Set(['pe', 'elf', 'macho', 'zip', '7z', 'rar', 'cab', 'script', 'jar']);

export function PeAlerts({ alerts }: { alerts?: PeAlert[] }) {
  if (!alerts?.length) return null;
  return (
    <HpsmField label="Alertas" wide top>
      <ul className="dl-doc-alerts">
        {alerts.map((a) => (
          <li key={a.text}>
            <StatusText tone={ALERT_TONE[a.level]}>{a.text}</StatusText>
          </li>
        ))}
      </ul>
    </HpsmField>
  );
}

/** Campos novos do cabecalho, no mesmo formulario do PE. */
export function PeHeaderFields({ pe }: { pe: PeInfo }) {
  if (pe.imphash === undefined) return null;
  const level = pe.manifest?.executionLevel ? EXECUTION_LEVELS[pe.manifest.executionLevel] : null;
  return (
    <>
      <HpsmField
        label="Imphash"
        help="Hash das importações, igual ao do pefile e do VirusTotal. Amostras com o mesmo imphash aparecem em Relacionadas."
      >
        <HpsmReadonly>
          {pe.imphash ? (
            <>
              <code>{pe.imphash}</code> <CopyButton value={pe.imphash} label="imphash" />
            </>
          ) : (
            'Sem importações legíveis'
          )}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField
        label="Rich header"
        help="Registro das ferramentas do Visual Studio que montaram o programa. Editado ou copiado de outro binário é sinal de despiste."
      >
        <HpsmReadonly>
          {pe.rich ? (
            <>
              <code>{pe.rich.hash}</code> <CopyButton value={pe.rich.hash} label="Rich hash" />{' '}
              {pe.rich.checksumValid ? (
                `· ${pe.rich.entries.length} ferramenta(s)`
              ) : (
                <StatusText tone="orange">editado</StatusText>
              )}
            </>
          ) : (
            'Ausente (não foi compilado com o Visual Studio)'
          )}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField label="Ponto de entrada">
        <HpsmReadonly>
          {pe.entryPoint ? (
            <>
              <code>0x{pe.entryPoint.rva.toString(16)}</code> na seção{' '}
              <code>{pe.entryPoint.section ?? '(nenhuma)'}</code>
            </>
          ) : (
            '—'
          )}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField
        label="Checksum"
        help="O linker pode deixar em 0; drivers e DLLs do sistema precisam dele certo."
      >
        <HpsmReadonly>
          {!pe.checksum?.declared
            ? 'Não preenchido'
            : pe.checksum.computed === null
              ? 'Não recalculado (arquivo grande)'
              : pe.checksum.computed === pe.checksum.declared
                ? 'Confere'
                : 'Não confere'}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField
        label="Dados anexados"
        help="Bytes depois do fim do executável (overlay), fora a assinatura."
      >
        <HpsmReadonly>
          {pe.overlay
            ? `${formatFileSize(pe.overlay.size)} · ${pe.overlay.type ?? 'tipo não reconhecido'} · entropia ${pe.overlay.entropy.toFixed(2)}`
            : 'Nenhum'}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField label="TLS callbacks" help="Código que roda antes do ponto de entrada.">
        <HpsmReadonly>{pe.tlsCallbacks ?? 0}</HpsmReadonly>
      </HpsmField>
      <HpsmField label="Manifesto">
        <HpsmReadonly>
          {pe.manifest ? (
            level ? (
              <StatusText tone={level.tone}>{level.text}</StatusText>
            ) : (
              'sem nível de execução declarado'
            )
          ) : (
            'Nenhum'
          )}
        </HpsmReadonly>
      </HpsmField>
    </>
  );
}

function SignatureBlock({ signature }: { signature: NonNullable<PeInfo['signature']> }) {
  const situation: { tone: StatusTone; text: string } = signature.error
    ? { tone: 'orange', text: `Não conferida: ${signature.error}` }
    : signature.digestMatches === false
      ? { tone: 'red', text: 'Alterado depois de assinado' }
      : !signature.signatureValid
        ? { tone: 'red', text: 'Assinatura inválida' }
        : { tone: 'green', text: 'Íntegra' };
  const signer = signature.signer;
  return (
    <div className="dl-static-block">
      <h4 className="dl-static-title">Assinatura digital</h4>
      <HpsmForm columns={2}>
        <HpsmField
          label="Situação"
          help="Confere o hash do arquivo e a assinatura com o certificado. A cadeia não é conferida contra as raízes confiáveis do Windows."
        >
          <HpsmReadonly>
            <StatusText tone={situation.tone}>{situation.text}</StatusText>
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Assinado por">
          <HpsmReadonly>
            {signer?.subject ?? '—'}
            {signature.selfSigned && (
              <>
                {' '}
                <StatusText tone="orange">autoassinado</StatusText>
              </>
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Emitido por">
          <HpsmReadonly>{signer?.issuer ?? '—'}</HpsmReadonly>
        </HpsmField>
        <HpsmField label="Validade do certificado">
          <HpsmReadonly>
            {signer ? `${fmtDay(signer.validFrom)} a ${fmtDay(signer.validTo)}` : '—'}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Impressão digital (SHA-1)">
          <HpsmReadonly>
            {signer ? (
              <>
                <code>{signer.sha1}</code>{' '}
                <CopyButton value={signer.sha1} label="impressão digital" />
              </>
            ) : (
              '—'
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField
          label="Carimbo de tempo"
          help="Data em que a assinatura foi feita, segundo a autoridade de carimbo (não conferida)."
        >
          <HpsmReadonly>
            {signature.timestamp ? fmtDate(signature.timestamp) : 'Sem carimbo'}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Programa declarado">
          <HpsmReadonly>
            {[signature.programName, signature.programUrl].filter(Boolean).join(' · ') || '—'}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Cadeia no arquivo">
          <HpsmReadonly>
            {signature.chain.length ? signature.chain.map((c) => c.subject).join(' → ') : '—'}
            {signature.nested > 0 && ` (+${signature.nested} assinatura(s) aninhada(s))`}
          </HpsmReadonly>
        </HpsmField>
      </HpsmForm>
    </div>
  );
}

function DotnetBlock({ dotnet }: { dotnet: NonNullable<PeInfo['dotnet']> }) {
  const chips = (items: string[], empty: string) =>
    items.length ? (
      <span className="dl-static-chips">
        {items.map((item) => (
          <code key={item}>{item}</code>
        ))}
      </span>
    ) : (
      empty
    );
  return (
    <div className="dl-static-block">
      <h4 className="dl-static-title">.NET</h4>
      <HpsmForm columns={2}>
        <HpsmField label="Assembly">
          <HpsmReadonly>
            {dotnet.assembly ? `${dotnet.assembly.name} ${dotnet.assembly.version}` : '—'}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Runtime">
          <HpsmReadonly>
            {dotnet.runtime ?? '—'}
            {dotnet.flags.length > 0 && ` · ${dotnet.flags.join(', ')}`}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Tipos e métodos">
          <HpsmReadonly>
            {dotnet.types} tipo(s) · {dotnet.methods} método(s)
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Ofuscador">
          <HpsmReadonly>
            {dotnet.obfuscator ? (
              <StatusText tone="orange">{dotnet.obfuscator}</StatusText>
            ) : (
              'Nenhum reconhecido'
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Chamadas sensíveis" wide>
          <HpsmReadonly>{chips(dotnet.suspicious, 'Nenhuma da lista de atenção')}</HpsmReadonly>
        </HpsmField>
        <HpsmField
          label="P/Invoke"
          wide
          help="Funções nativas do Windows que o código .NET chama diretamente (DllImport)."
        >
          <HpsmReadonly>
            {chips(
              dotnet.pinvoke.map((f) => `${f.dll}!${f.name}`),
              'Nenhuma',
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Referências" wide>
          <HpsmReadonly>{chips(dotnet.assemblyRefs, 'Nenhuma')}</HpsmReadonly>
        </HpsmField>
      </HpsmForm>
    </div>
  );
}

/** Blocos abaixo das tabelas de secoes e imports. */
export function PeExtraBlocks({ pe }: { pe: PeInfo }) {
  if (pe.imphash === undefined) return null;
  const resources = pe.resources ?? [];
  const version = pe.version ? Object.entries(pe.version) : [];
  const named = pe.imports.filter((i) => i.names?.length);
  return (
    <>
      {pe.signature ? (
        <SignatureBlock signature={pe.signature} />
      ) : (
        <div className="dl-static-block">
          <h4 className="dl-static-title">Assinatura digital</h4>
          <p className="dl-static-empty">Sem assinatura digital.</p>
        </div>
      )}
      {pe.dotnet && <DotnetBlock dotnet={pe.dotnet} />}
      {(version.length > 0 || resources.length > 0) && (
        <div className="dl-static-tables">
          {version.length > 0 && (
            <TableContainer>
              <Table size="xs" aria-label="Informações de versão">
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">Informação de versão</TableHeader>
                    <TableHeader scope="col">Valor</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {version.map(([key, value]) => (
                    <TableRow key={key}>
                      <TableCell>{VERSION_LABELS[key] ?? key}</TableCell>
                      <TableCell>{value}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {resources.length > 0 && (
            <TableContainer>
              <Table size="xs" aria-label="Recursos do executável">
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">Recurso</TableHeader>
                    <TableHeader scope="col">Idioma</TableHeader>
                    <TableHeader scope="col">Tamanho</TableHeader>
                    <TableHeader scope="col">Entropia</TableHeader>
                    <TableHeader scope="col">Conteúdo</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {resources.map((r, i) => (
                    <TableRow key={`${r.type}-${r.name}-${r.lang}-${i}`}>
                      <TableCell>
                        <code>
                          {r.type}/{r.name}
                        </code>
                      </TableCell>
                      <TableCell>{LANGS[r.lang] ?? r.lang}</TableCell>
                      <TableCell>{formatFileSize(r.size)}</TableCell>
                      <TableCell>{r.entropy.toFixed(2)}</TableCell>
                      <TableCell>
                        {r.content ? (
                          RISKY_CONTENT.has(r.content) ? (
                            <StatusText tone="orange">{r.content}</StatusText>
                          ) : (
                            r.content
                          )
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {pe.resourcesTruncated && (
                <p className="dl-static-empty">Lista cortada: há mais recursos no arquivo.</p>
              )}
            </TableContainer>
          )}
        </div>
      )}
      {pe.exports && (
        <details className="dl-static-strings">
          <summary>
            Exports ({pe.exports.total}){pe.exports.dll ? ` · ${pe.exports.dll}` : ''}
          </summary>
          <TableContainer>
            <Table size="xs" aria-label="Funções exportadas">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Ordinal</TableHeader>
                  <TableHeader scope="col">Nome</TableHeader>
                  <TableHeader scope="col">Encaminha para</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {pe.exports.symbols.map((s) => (
                  <TableRow key={s.ordinal}>
                    <TableCell>{s.ordinal}</TableCell>
                    <TableCell>{s.name ? <code>{s.name}</code> : '(só ordinal)'}</TableCell>
                    <TableCell>{s.forwarder ? <code>{s.forwarder}</code> : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {pe.exports.truncated && <p className="dl-static-empty">Lista cortada.</p>}
        </details>
      )}
      {named.length > 0 && (
        <details className="dl-static-strings">
          <summary>Funções importadas ({pe.imports.reduce((n, i) => n + i.functions, 0)})</summary>
          {named.map((imp) => (
            <div key={imp.dll} className="dl-static-imports">
              <strong>{imp.dll}</strong>
              <span className="dl-static-chips">
                {imp.names!.map((fn, i) => (
                  <code key={`${fn}-${i}`}>{fn}</code>
                ))}
              </span>
            </div>
          ))}
        </details>
      )}
    </>
  );
}

/** Permissoes da secao: gravavel e executavel ao mesmo tempo em destaque. */
export function SectionFlags({ flags }: { flags?: string }) {
  if (!flags) return <>—</>;
  return flags.includes('W') && flags.includes('X') ? (
    <StatusText tone="red">{flags}</StatusText>
  ) : (
    <code>{flags}</code>
  );
}
