# Desempacotadores (item 7.8)

Cada arquivo `uNN_nome.py` desta pasta é um desempacotador. O servidor (`../server.py`) os carrega
na ordem do nome e usa **o primeiro que reconhece** a amostra; por isso os específicos (UPX, 10)
vêm antes dos genéricos (arquivo compactado embutido, 90).

Antes deles, o servidor identifica a amostra com o Detect It Easy (item 7.9). O `detect` do plugin
continua sendo quem decide: ele recebe os bytes, não a saída do DIE, porque o DIE também erra. Se
nenhum plugin reconhece, a API usa o que o DIE viu para explicar por quê (por exemplo, "protegido
com Themida"). Os arquivos extraídos também são identificados na mesma rodada, e o `detect` de
cada plugin é chamado neles para saber se a filha precisa de outra rodada; por isso ele tem de ser
barato e não pode falhar.

## Contrato

```python
from common import UnpackError, files_under, is_pe_or_elf, run

NAME = "themida"            # identificador curto (vai para o banco e para a API)
LABEL = "Themida"           # nome que a ficha mostra

def detect(data: bytes) -> bool:
    """Reconhece a amostra pelos bytes. Barato: roda em toda amostra que chega ao serviço."""

def unpack(path: str, outdir: str, timeout: int) -> dict:
    """Desempacota `path` para dentro de `outdir` e devolve
    {"files": [(nome_relativo, caminho_absoluto), ...], "note": "texto curto ou None"}.
    Reconheceu mas não conseguiu: levante UnpackError("motivo legível")."""
```

- `run(cmd, timeout, cwd=None)` roda uma ferramenta num grupo de processos próprio e mata o grupo
  inteiro no tempo esgotado; devolve `(código, saída)`.
- `files_under(pasta)` lista os arquivos comuns (sem links simbólicos).
- O servidor aplica os tetos (`UNPACK_MAX_FILES`, `UNPACK_MAX_TOTAL_MB`), limpa os nomes e monta a
  resposta. O desempacotador não precisa se preocupar com isso.

## O que o contêiner permite

Sem rede, sem root, sem capacidades, raiz somente leitura e `/tmp` em memória **sem execução**. Um
desempacotador que precise **executar a amostra** (os dinâmicos, como a maioria dos de Themida,
VMProtect e afins) não cabe aqui: precisa de um Windows descartável, e o lugar é o sandbox do
Proxmox. Ferramentas novas (um binário, um pacote Python) entram pelo `Dockerfile`, com a versão
fixada e conferida por hash, como as que já estão lá.

Um desempacotador novo pede também um executável de teste em
`apps/api/tests/fixtures/pe/gen.sh` e a checagem em `apps/api/tests/integration/unpack.test.ts`.
