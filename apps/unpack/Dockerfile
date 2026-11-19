# Identificar e desempacotar (itens 7.8 e 7.9): Detect It Easy, Magika, GoReSym, upx, 7-Zip, innoextract,
# pyinstxtractor e autoit-ripper. Sem rede, sem root e com a raiz somente leitura no compose; um
# container por trabalho (server.py). Nada e executado.
FROM debian:trixie-slim AS fetch
# pyinstxtractor 2026.07 (GPL-3.0), um script so, sem dependencias, no commit exato da versao.
ADD --checksum=sha256:94e0b6c9d5151bbeefc7e7452e96e24b396c2dbfcb0348e5f12c4c0865fefe58 \
  https://raw.githubusercontent.com/extremecoders-re/pyinstxtractor/815d31cf26bc71e62f851b2e549452e7b7c9dd98/pyinstxtractor.py \
  /opt/pyinstxtractor/pyinstxtractor.py
# autoit-ripper 1.2.0 (MIT; plans/caca-e-formatos, item 5), o wheel do PyPI conferido pelo SHA-256. E
# Python puro; o pefile vem do Debian.
ADD --checksum=sha256:e43fddb7d8eb2e985dffb7952bd1102b77d85a9a4467c1821ecefd8f416b45ce \
  https://files.pythonhosted.org/packages/65/80/1c6111b41b00fb2bebb874c723c7aefae35b579aef42097dc62e54df9c9f/autoit_ripper-1.2.0-py3-none-any.whl \
  /opt/autoit-ripper.whl
# Detect It Easy 3.21 (MIT), o pacote oficial para Debian 13, conferido pelo SHA-256 publicado. So o
# diec (linha de comando) e o banco de assinaturas: a interface grafica, as imagens, os idiomas e o
# resto ficam de fora. O pacote pede o Qt5 inteiro; o diec so carrega o Core e o Script (ldd).
ADD --checksum=sha256:47ed1299fe0fcdf3549e4077573db9651c228144b22a372729eb014548332fcd \
  https://github.com/horsicq/DIE-engine/releases/download/3.21/die_3.21_Debian_13_amd64.deb \
  /tmp/die.deb
# GoReSym 3.4.1 (MIT, Mandiant; plans/analise-estatica-ampliada, item 14): le o pclntab do Go, mesmo
# sem simbolos. Binario estatico; o zip oficial conferido pelo SHA-256.
ADD --checksum=sha256:a557124857f95a589f8ce3525119c2d18c7c7fc7c4225c92ff94e3effb38748d \
  https://github.com/mandiant/GoReSym/releases/download/v3.4.1/GoReSym-linux.zip \
  /opt/goresym.zip
# Magika 1.1.0 (Apache-2.0, Google; item 22): tipo do arquivo por aprendizado de maquina, bom no que
# nao tem magica (scripts, texto, codigo). O CLI em Rust traz o modelo embutido.
ADD --checksum=sha256:6b4c1010c84d1f4f06205ccef4597f1690bcd7744f46d841eee26426bc100485 \
  https://github.com/google/magika/releases/download/cli/v1.1.0/magika-cli-x86_64-unknown-linux-gnu.tar.xz \
  /tmp/magika.tar.xz
RUN apt-get update && apt-get install -y --no-install-recommends xz-utils \
  && mkdir -p /opt/magika \
  && tar -xJf /tmp/magika.tar.xz -C /opt/magika --strip-components=1 \
  && chmod 755 /opt/magika /opt/magika/magika
RUN dpkg-deb -x /tmp/die.deb /tmp/die \
  && mkdir -p /opt/die/usr/bin /opt/die/usr/lib/die \
  && cp /tmp/die/usr/bin/diec /opt/die/usr/bin/ \
  && cp -r /tmp/die/usr/lib/die/db /tmp/die/usr/lib/die/db_custom /opt/die/usr/lib/die/

# unipacker (item 17): wheels conferidos pelo hash do lockfile, instalados numa pasta propria (so o
# processo do unipacker a ve). O mesmo Debian da imagem final: o mesmo Python 3.13.
FROM debian:trixie-slim AS unipacker
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip
COPY requirements.txt /tmp/
RUN pip wheel --no-cache-dir --require-hashes --wheel-dir /wheels \
    -r /tmp/requirements.txt \
  && pip install --break-system-packages --no-cache-dir --no-index --no-deps \
    --target /opt/unipacker /wheels/*.whl \
  && chmod -R a+rX /opt/unipacker

FROM debian:trixie-slim
# upx 4.2, 7-Zip 25 (abre NSIS, ZIP, 7z, RAR, CAB e autoextraiveis) e innoextract 1.9 (Inno Setup
# ate a 6.2). As correcoes de seguranca que o Debian ja publicou entram pelo upgrade.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends upx-ucl 7zip innoextract python3 python3-pefile \
    libqt5core5t64 libqt5script5 libglib2.0-0t64 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10003 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin unpack
# 755: o --chmod vale tambem para a pasta, que sem o x nao se atravessa.
COPY --from=fetch --chmod=755 /opt/pyinstxtractor /opt/pyinstxtractor
COPY --from=fetch /opt/die/ /
COPY --from=fetch /opt/autoit-ripper.whl /tmp/autoit-ripper.whl
COPY --from=fetch /opt/goresym.zip /tmp/goresym.zip
COPY --from=fetch /opt/magika/magika /opt/magika/magika
COPY --from=unipacker /opt/unipacker /opt/unipacker
RUN python3 -m zipfile -e /tmp/goresym.zip /opt/goresym \
  && rm /tmp/goresym.zip \
  && chmod 755 /opt/goresym /opt/goresym/GoReSym
RUN python3 -m zipfile -e /tmp/autoit-ripper.whl /opt/autoit-ripper \
  && rm /tmp/autoit-ripper.whl \
  && chmod -R a+rX /opt/autoit-ripper
ENV HOME=/tmp \
  PYTHONPATH=/opt/autoit-ripper \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=3400
COPY server.py /app/server.py
COPY unpackers /app/unpackers

USER unpack
EXPOSE 3400
CMD ["python3", "/app/server.py"]
