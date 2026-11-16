# Configuracao de familias e dumps de memoria (plans/novas-analises, itens 2 e 3): CAPE-parsers
# (GPL-3.0) com as regras YARA do CAPEv2 (rules/, GPL-3.0) e o leitor de minidump (MIT). A licenca
# GPL fica aqui dentro: a API so conversa por HTTP. Sem rede, sem root e com a raiz somente leitura
# no compose; um container por analise (server.py).
FROM python:3.13-slim AS build
COPY requirements.txt /tmp/
# Wheels de tudo, conferidos pelo hash do lockfile.
RUN pip wheel --no-cache-dir --require-hashes --wheel-dir /wheels -r /tmp/requirements.txt

FROM python:3.13-slim
# As correcoes de seguranca que o Debian ja publicou e a imagem do Python ainda nao tem.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10010 --no-create-home --shell /usr/sbin/nologin extract
COPY --from=build /wheels /wheels
# Depois de instalar, o pip sai da imagem (como no capa): o runtime so roda python.
RUN pip install --no-cache-dir --no-index --no-deps /wheels/*.whl \
  && rm -rf /wheels \
  && python -m pip uninstall -y -q pip
ENV HOME=/tmp \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=3800
COPY rules /app/rules
COPY server.py config.py memdump.py /app/
# Os extratores sao importados na primeira analise de cada container: compila os .pyc agora, na
# imagem (a raiz fica somente leitura).
RUN python -m compileall -q /usr/local/lib/python3.13/site-packages/cape_parsers /app

USER extract
EXPOSE 3800
CMD ["python", "/app/server.py"]
