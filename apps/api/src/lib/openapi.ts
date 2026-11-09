import { z } from 'zod';

import { ListQuery, UrlSchema } from '../routes/entries';
import { ExportQuery } from '../routes/iocs';

/**
 * Especificacao OpenAPI 3.1 das rotas que aceitam token de API (item 93). Os
 * parametros e corpos saem dos schemas zod das proprias rotas
 * (z.toJSONSchema); as respostas sao descritas aqui. O teste confere que a
 * lista bate com ALLOWED_ROUTES (lib/api-tokens.ts).
 */

type Schema = Record<string, unknown>;

/** JSON Schema de entrada (o que o cliente manda) de um schema zod. */
function input(schema: z.ZodType): Schema {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Schema;
  return rest;
}

/** Parametros de query a partir de um z.object. */
function queryParams(schema: z.ZodObject): Schema[] {
  const json = input(schema) as { properties?: Record<string, Schema>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({
    name,
    in: 'query',
    required: json.required?.includes(name) ?? false,
    schema: s,
    ...(typeof s.description === 'string' ? { description: s.description } : {}),
  }));
}

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Id da amostra (o `id` devolvido no envio).',
  schema: { type: 'string' },
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: Schema, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const errors = {
  '400': json(ref('Error'), 'Dados inválidos (`details` traz os campos).'),
  '401': json(ref('Error'), 'Token ausente, inválido ou expirado.'),
  '403': json(ref('Error'), 'Sem permissão (ou rota que não aceita token).'),
  '404': json(ref('Error'), 'Amostra não encontrada.'),
};
const pick = (...codes: (keyof typeof errors)[]) =>
  Object.fromEntries(codes.map((c) => [c, errors[c]]));

const uploadFields = {
  title: { type: 'string', description: 'Título (padrão: o nome do arquivo).' },
  description: { type: 'string', maxLength: 4000 },
  tags: { type: 'string', description: 'Tags separadas por vírgula (até 20).' },
};

/** Documento OpenAPI (o mesmo para todos; nada depende de quem pede). */
export function openApiDocument(): Schema {
  return {
    openapi: '3.1.0',
    info: {
      title: 'DeepLook API',
      version: '1.0.0',
      description:
        'Envio e consulta de amostras com token de API (Minha Conta > Tokens de API). ' +
        'Envie `Authorization: Bearer <token>`. Só as rotas abaixo aceitam token; as demais respondem 403.',
    },
    // Mesmo endereco de onde a especificacao foi baixada.
    servers: [{ url: '/' }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description: 'Token criado em Minha Conta > Tokens de API.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: {
              type: 'object',
              additionalProperties: { type: 'array', items: { type: 'string' } },
            },
          },
          required: ['error'],
        },
        Entry: {
          type: 'object',
          description: 'Amostra (campos principais).',
          properties: {
            id: { type: 'string' },
            type: { enum: ['FILE', 'URL'] },
            title: { type: 'string' },
            status: { enum: ['PENDING', 'IN_REVIEW', 'COMPLETED'] },
            verdict: { enum: ['UNKNOWN', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS'] },
            priority: { enum: ['P1', 'P2', 'P3', 'P4'] },
            resolution: { type: ['string', 'null'], description: 'O que fazer, para quem enviou.' },
            sha256: { type: ['string', 'null'] },
            url: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    paths: {
      '/api/openapi.json': {
        get: {
          summary: 'Esta especificação',
          responses: { '200': json({ type: 'object' }, 'Documento OpenAPI 3.1.'), ...pick('401') },
        },
      },
      '/api/entries/file': {
        post: {
          summary: 'Enviar arquivo',
          description:
            'Um arquivo por envio (`.eml` vira e-mail com os anexos como amostras). Limite de envios por dia (429).',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: { file: { type: 'string', format: 'binary' }, ...uploadFields },
                  required: ['file'],
                },
              },
            },
          },
          responses: {
            '201': json(
              {
                type: 'object',
                properties: {
                  entry: ref('Entry'),
                  previous: {
                    type: ['object', 'null'],
                    description: 'Envio anterior do mesmo arquivo.',
                  },
                },
              },
              'Amostra criada.',
            ),
            '429': json(ref('Error'), 'Limite de envios do dia.'),
            ...pick('400', '401'),
          },
        },
      },
      '/api/entries/zip': {
        post: {
          summary: 'Enviar vários arquivos num .zip',
          description:
            'Cada arquivo do .zip vira uma amostra (até 20). `password` para .zip protegido.',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: { type: 'string', format: 'binary' },
                    password: { type: 'string', maxLength: 200 },
                    ...uploadFields,
                  },
                  required: ['file'],
                },
              },
            },
          },
          responses: {
            '201': json(
              {
                type: 'object',
                properties: {
                  created: { type: 'array', items: { type: 'object' } },
                  skipped: { type: 'array', items: { type: 'object' } },
                },
              },
              'Amostras criadas e arquivos ignorados.',
            ),
            '429': json(ref('Error'), 'Limite de envios do dia.'),
            ...pick('400', '401'),
          },
        },
      },
      '/api/entries/url': {
        post: {
          summary: 'Enviar link',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: input(UrlSchema) } },
          },
          responses: {
            '201': json({ type: 'object', properties: { entry: ref('Entry') } }, 'Amostra criada.'),
            '429': json(ref('Error'), 'Limite de envios do dia.'),
            ...pick('400', '401'),
          },
        },
      },
      '/api/entries': {
        get: {
          summary: 'Listar amostras',
          description: '`scope=mine` traz só as do dono do token.',
          parameters: queryParams(ListQuery),
          responses: {
            '200': json(
              {
                type: 'object',
                properties: {
                  items: { type: 'array', items: ref('Entry') },
                  total: { type: 'integer' },
                },
              },
              'Página de amostras.',
            ),
            ...pick('400', '401'),
          },
        },
      },
      '/api/entries/{id}': {
        get: {
          summary: 'Consultar a amostra (status, veredito, resolução)',
          parameters: [idParam],
          responses: {
            '200': json({ type: 'object', properties: { entry: ref('Entry') } }, 'Amostra.'),
            ...pick('401', '404'),
          },
        },
      },
      '/api/entries/{id}/reports': {
        get: {
          summary: 'Relatórios da amostra',
          description: 'Usuário comum vê só os publicados.',
          parameters: [idParam],
          responses: {
            '200': json(
              {
                type: 'object',
                properties: { reports: { type: 'array', items: { type: 'object' } } },
              },
              'Relatórios.',
            ),
            ...pick('401', '404'),
          },
        },
      },
      '/api/entries/{id}/events': {
        get: {
          summary: 'Histórico da amostra',
          parameters: [idParam],
          responses: {
            '200': json(
              {
                type: 'object',
                properties: { events: { type: 'array', items: { type: 'object' } } },
              },
              'Eventos.',
            ),
            ...pick('401', '404'),
          },
        },
      },
      '/api/entries/{id}/iocs': {
        get: {
          summary: 'Indicadores da amostra',
          parameters: [idParam],
          responses: {
            '200': json(
              {
                type: 'object',
                properties: {
                  iocs: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { kind: { type: 'string' }, value: { type: 'string' } },
                    },
                  },
                },
              },
              'Indicadores dos relatórios publicados e da própria amostra.',
            ),
            ...pick('401', '404'),
          },
        },
      },
      '/api/entries/{id}/iocs/export': {
        get: {
          summary: 'Baixar os indicadores (CSV, STIX 2.1 ou MISP)',
          parameters: [idParam, ...queryParams(ExportQuery)],
          responses: {
            '200': {
              description: 'Arquivo para download.',
              content: { 'text/csv': {}, 'application/json': {} },
            },
            ...pick('400', '401', '404'),
          },
        },
      },
      '/api/entries/{id}/reputation': {
        get: {
          summary: 'Reputação (consultas externas já feitas)',
          parameters: [idParam],
          responses: {
            '200': json({ type: 'object' }, 'Resultados por serviço.'),
            ...pick('401', '404'),
          },
        },
      },
      '/api/entries/{id}/antivirus': {
        get: {
          summary: 'Resultado do antivírus',
          parameters: [idParam],
          responses: {
            '200': json({ type: 'object' }, 'Varredura do arquivo.'),
            ...pick('401', '404'),
          },
        },
      },
      '/api/entries/{id}/ghidra': {
        get: {
          summary: 'Análise com o Ghidra',
          description:
            'Pedida por um analista. Resumo do programa, as maiores funções, quem chama APIs ' +
            'sensíveis e o pseudo-C dessas funções e do ponto de entrada. `analysis` é null ' +
            'enquanto ninguém pedir.',
          parameters: [idParam],
          responses: {
            '200': json({ type: 'object' }, 'Situação e resultado da análise.'),
            ...pick('401', '404'),
          },
        },
      },
      '/api/entries/{id}/capa': {
        get: {
          summary: 'Análise de funções (capa e FLOSS)',
          description:
            'O que as funções do executável fazem (regras do capa, com ATT&CK e MBC) e as strings ' +
            'que só aparecem na execução (FLOSS). `analysis` é null enquanto não houver análise.',
          parameters: [idParam],
          responses: {
            '200': json({ type: 'object' }, 'Situação e resultado da análise.'),
            ...pick('401', '404'),
          },
        },
      },
    },
  };
}

/** "GET /api/entries/:id" de cada operacao (para conferir com ALLOWED_ROUTES). */
export function documentedRoutes(doc = openApiDocument()): string[] {
  const paths = doc.paths as Record<string, Record<string, unknown>>;
  return Object.entries(paths).flatMap(([path, ops]) =>
    Object.keys(ops).map((m) => `${m.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`),
  );
}
