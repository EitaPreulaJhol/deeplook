# Analise de funcoes com o Ghidra (item 7.3), da NSA (Apache 2.0). Sob demanda, sem rede, sem root e
# com a raiz somente leitura no compose; um container por analise (server.py).
FROM debian:trixie-slim AS fetch
RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip \
  && rm -rf /var/lib/apt/lists/*
# O pacote oficial, conferido pelo SHA-256 publicado na pagina da versao. Ao trocar a versao, troque
# a URL, o hash e GHIDRA_VERSION abaixo (o Ghidra 12 pede Java 25).
ADD --checksum=sha256:2c2cd776db3c1f6a097ba418922378ac3649cadd5e844a6f5f088ae628a7be67 \
  https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.2_build/ghidra_12.2_PUBLIC_20261016.zip \
  /tmp/ghidra.zip
# O guava 32.1.3 que o Ghidra 12.2 traz tem CVE alta com correcao (CVE-2026-102554, negacao de
# servico ao desserializar um stream Java forjado). Troca pelo 33.7.2 e o failureaccess 1.0.3 que ele
# pede, do Maven Central e conferidos pelo hash (o SHA-256 do guava e o publicado; o do
# failureaccess foi conferido pelo SHA-1 publicado). Ao trocar a versao do Ghidra, veja se ainda
# precisa: se o Ghidra ja trouxer um guava corrigido, tire estes ADD e a troca abaixo.
ADD --checksum=sha256:b530942257fb935f8b2cfaa5f8eb5bd59c555fd8e8d01b8ce98912e077ea606c \
  https://repo1.maven.org/maven2/com/google/guava/guava/33.7.2-jre/guava-33.7.2-jre.jar /tmp/
ADD --checksum=sha256:cbfc3906b19b8f55dd7cfd6dfe0aa4532e834250d7f080bd8d211a3e246b59cb \
  https://repo1.maven.org/maven2/com/google/guava/failureaccess/1.0.3/failureaccess-1.0.3.jar /tmp/
# Fora o que o modo headless nao usa: documentacao, extensoes opcionais, o servidor de
# repositorios (e o yajsw, o wrapper que o roda como servico, com um netty de CVE critica), o
# depurador e a pasta docker. O FunctionID fica: e ele que reconhece as funcoes de biblioteca
# (MSVC) e poupa o analista de le-las.
RUN unzip -q /tmp/ghidra.zip -d /opt \
  && mv /opt/ghidra_12.2_PUBLIC /opt/ghidra \
  && cd /opt/ghidra \
  && rm -rf docs Extensions server docker Ghidra/Debug Ghidra/Features/GhidraServer/data/yajsw-* \
  && lib=Ghidra/Framework/Generic/lib \
  && rm "$lib/guava-32.1.3-jre.jar" "$lib/failureaccess-1.0.1.jar" \
  && install -m 644 /tmp/guava-33.7.2-jre.jar /tmp/failureaccess-1.0.3.jar "$lib/" \
  && sed -i 's/guava-32.1.3-jre.jar/guava-33.7.2-jre.jar/; s/failureaccess-1.0.1.jar/failureaccess-1.0.3.jar/' \
    Ghidra/Framework/Generic/Module.manifest

# Bases do Function ID do MinGW-w64 (plans/analise-estatica-ampliada, item 25): o runtime, o libgcc e
# a zlib, de 32 e de 64 bits, dos pacotes do Debian, montadas pelo proprio Ghidra (fid/build.sh). Leva
# alguns minutos; fica no cache do Docker ate trocar o Ghidra ou os scripts.
FROM debian:trixie-slim AS fid
RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-25-jdk-headless binutils \
    mingw-w64-x86-64-dev mingw-w64-i686-dev gcc-mingw-w64-x86-64-win32 gcc-mingw-w64-i686-win32 \
    libz-mingw-w64-dev
COPY --from=fetch /opt/ghidra /opt/ghidra
COPY fid /fid
ENV HOME=/tmp GHIDRA_HEADLESS_MAXMEM=3G
RUN sh /fid/build.sh /opt/fid && chmod -R a+rX /opt/fid

FROM debian:trixie-slim
# JDK, nao JRE: o Ghidra compila os scripts. Os jmods (337 MB) so servem ao jlink e saem. As
# correcoes de seguranca que o Debian ja publicou entram pelo upgrade.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends openjdk-25-jdk-headless python3 \
  && rm -rf /var/lib/apt/lists/* /usr/lib/jvm/java-25-openjdk-amd64/jmods \
  && useradd --system --uid 10002 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin ghidra \
  && install -d -o ghidra -g ghidra -m 700 /bsim
COPY --from=fetch /opt/ghidra /opt/ghidra
COPY --from=fid /opt/fid /opt/fid
# O descompilador nativo com teto de memoria por processo (decompile-limit.sh).
COPY decompile-limit.sh /tmp/
RUN d=/opt/ghidra/Ghidra/Features/Decompiler/os/linux_x86_64 \
  && mv "$d/decompile" "$d/decompile.real" \
  && install -m 755 /tmp/decompile-limit.sh "$d/decompile" \
  && rm /tmp/decompile-limit.sh
# HOME (inclusive a do usuario no /etc/passwd, de onde o Java tira user.home) e as pastas de
# configuracao e cache no /tmp (tmpfs): o Ghidra grava ali as preferencias, o
# log e os scripts compilados; com a raiz somente leitura, nao ha outro lugar.
ENV HOME=/tmp \
  XDG_CONFIG_HOME=/tmp/.config \
  XDG_CACHE_HOME=/tmp/.cache \
  GHIDRA_HOME=/opt/ghidra \
  GHIDRA_VERSION=12.2 \
  GHIDRA_HEADLESS_MAXMEM=3G \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=3300
COPY server.py sensitive-apis.txt pe-ordinals.json /app/
COPY scripts /app/scripts

USER ghidra
EXPOSE 3300
CMD ["python3", "/app/server.py"]
