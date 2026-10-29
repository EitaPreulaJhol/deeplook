import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { CopyButton } from '../components/CopyButton';
import { HpsmSection } from '../components/HpsmForm';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  format?: string;
  default?: unknown;
  maximum?: number;
  maxLength?: number;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
};
interface Param {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema: Schema;
}
interface Operation {
  summary: string;
  description?: string;
  parameters?: Param[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { description: string }>;
}
interface OpenApi {
  info: { description: string };
  paths: Record<string, Record<string, Operation>>;
}

/** "string (até 200)", "csv | stix | misp", "inteiro, padrão 25". */
function typeText(s: Schema | undefined): string {
  if (!s) return '—';
  if (s.enum) return s.enum.join(' | ');
  if (s.anyOf) return s.anyOf.map(typeText).join(' ou ');
  const type = Array.isArray(s.type) ? s.type.join(' | ') : (s.type ?? 'valor');
  const extra = [
    s.format === 'binary' ? 'arquivo' : s.format,
    s.maxLength !== undefined && `até ${s.maxLength}`,
    s.maximum !== undefined && `máx. ${s.maximum}`,
    s.default !== undefined && `padrão ${String(s.default)}`,
  ].filter(Boolean);
  return extra.length ? `${type} (${extra.join(', ')})` : type;
}

/** Linhas de campos: parametros e propriedades do corpo. */
function Fields({
  rows,
}: {
  rows: { name: string; where: string; required: boolean; schema: Schema; description?: string }[];
}) {
  if (!rows.length) return null;
  return (
    <table className="dl-apidoc__fields">
      <thead>
        <tr>
          <th scope="col">Campo</th>
          <th scope="col">Onde</th>
          <th scope="col">Tipo</th>
          <th scope="col">Descrição</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.where}:${r.name}`}>
            <td className="dl-mono">
              {r.name}
              {r.required && <span title="obrigatório"> *</span>}
            </td>
            <td>{r.where}</td>
            <td className="dl-mono">{typeText(r.schema)}</td>
            <td>{r.description ?? r.schema.description ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Example({ title, code }: { title: string; code: string }) {
  return (
    <div className="dl-apidoc__example">
      <div className="dl-apidoc__example-head">
        <strong>{title}</strong>
        <CopyButton value={code} label={`o exemplo "${title}"`} />
      </div>
      <pre className="dl-mono">{code}</pre>
    </div>
  );
}

/**
 * Documentacao da API (item 93): exemplos em curl e as rotas que aceitam token,
 * lidas de /api/openapi.json. So leitura: nada aqui chama a API pela pessoa.
 */
export function ApiDocsPage() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['openapi'],
    queryFn: () => api.get<OpenApi>('/openapi.json'),
    staleTime: Infinity,
  });
  const origin = window.location.origin;
  const auth = '-H "Authorization: Bearer $DEEPLOOK_TOKEN"';
  const examples = [
    {
      title: 'Enviar um arquivo',
      code: `curl ${auth} \\\n  -F file=@fatura.pdf -F "title=Fatura recebida por e-mail" -F "tags=financeiro" \\\n  "${origin}/api/entries/file"`,
    },
    {
      title: 'Enviar um link',
      code: `curl ${auth} -H "Content-Type: application/json" \\\n  -d '{"url":"https://exemplo.top/login","title":"Link do SMS"}' \\\n  "${origin}/api/entries/url"`,
    },
    {
      title: 'Consultar o resultado (status, veredito e o que fazer)',
      code: `curl ${auth} "${origin}/api/entries/<id>"`,
    },
    {
      title: 'Baixar os indicadores (csv, stix ou misp)',
      code: `curl ${auth} -o iocs.csv "${origin}/api/entries/<id>/iocs/export?format=csv"`,
    },
  ];

  return (
    <>
      <PageHeader
        title="Documentação da API"
        subtitle="Envio e consulta de amostras por script, com um token de API. Só as rotas abaixo aceitam token; as demais respondem 403."
      />
      {!user?.apiAccess && (
        <HpsmMessage kind="info">
          O acesso por API da sua conta não está liberado. Peça a um administrador.
        </HpsmMessage>
      )}
      <HpsmSection title="Como usar">
        <ol className="dl-apidoc__steps">
          <li>
            Crie um token em <Link className="dl-link" to="/user?tab=tokens">Minha Conta &gt; Tokens de API</Link>{' '}
            (ele aparece uma única vez).
          </li>
          <li>
            Envie <span className="dl-mono">Authorization: Bearer &lt;token&gt;</span> em cada chamada; nos
            exemplos, o token está na variável <span className="dl-mono">DEEPLOOK_TOKEN</span>.
          </li>
          <li>
            Erros vêm como <span className="dl-mono">{'{ "error": "...", "details": { campo: [...] } }'}</span>;
            envios têm limite por dia (429).
          </li>
        </ol>
        <p>
          <a className="dl-link" href="/api/openapi.json" download="deeplook-openapi.json">
            Baixar a especificação (OpenAPI 3.1)
          </a>{' '}
          para gerar clientes ou importar no seu programa de API.
        </p>
      </HpsmSection>

      <HpsmSection title="Exemplos" className="dl-mt-lg">
        {examples.map((e) => (
          <Example key={e.title} {...e} />
        ))}
      </HpsmSection>

      <HpsmSection title="Rotas" className="dl-mt-lg">
        {query.isLoading && <HpsmLoading text="Carregando a especificação..." />}
        {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
        {query.data &&
          Object.entries(query.data.paths).flatMap(([path, ops]) =>
            Object.entries(ops).map(([method, op]) => {
              const body = op.requestBody && Object.entries(op.requestBody.content)[0];
              const rows = [
                ...(op.parameters ?? []).map((p) => ({
                  name: p.name,
                  where: p.in === 'path' ? 'caminho' : 'query',
                  required: Boolean(p.required),
                  schema: p.schema,
                  description: p.description,
                })),
                ...Object.entries(body?.[1].schema.properties ?? {}).map(([name, s]) => ({
                  name,
                  where: body![0] === 'multipart/form-data' ? 'formulário' : 'JSON',
                  required: body![1].schema.required?.includes(name) ?? false,
                  schema: s,
                })),
              ];
              return (
                <article key={`${method} ${path}`} className="dl-apidoc__route" data-route={`${method.toUpperCase()} ${path}`}>
                  <h3>
                    <span className={`dl-apidoc__method dl-apidoc__method--${method}`}>{method.toUpperCase()}</span>{' '}
                    <span className="dl-mono">{path}</span> — {op.summary}
                  </h3>
                  {op.description && <p>{op.description}</p>}
                  <Fields rows={rows} />
                  <p className="dl-apidoc__responses">
                    Respostas:{' '}
                    {Object.entries(op.responses)
                      .map(([code, r]) => `${code} ${r.description}`)
                      .join(' · ')}
                  </p>
                </article>
              );
            }),
          )}
      </HpsmSection>
    </>
  );
}
