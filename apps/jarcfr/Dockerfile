# Descompilacao de Java (plans/caca-e-formatos): CFR 0.152 (MIT), o JAR do Maven Central conferido
# pelo SHA-256, numa JRE headless. So le o bytecode; nada e executado. Sem rede, sem root e com a
# raiz somente leitura no compose; um container por analise (server.py).
FROM python:3.14-slim AS fetch
ADD --checksum=sha256:f686e8f3ded377d7bc87d216a90e9e9512df4156e75b06c655a16648ae8765b2 \
  https://repo1.maven.org/maven2/org/benf/cfr/0.152/cfr-0.152.jar /tmp/cfr.jar
RUN mkdir -p /opt/cfr && cp /tmp/cfr.jar /opt/cfr/cfr.jar && chmod 644 /opt/cfr/cfr.jar

FROM python:3.14-slim
# As correcoes de seguranca que o Debian ja publicou e a imagem do Python ainda nao tem, e so a JRE
# headless (sem o JDK e sem pacotes recomendados). O pip sai da imagem: o runtime so roda python e java.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends openjdk-21-jre-headless \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10012 --no-create-home --shell /usr/sbin/nologin jarcfr \
  && python -m pip uninstall -y -q pip
COPY --from=fetch /opt/cfr /opt/cfr
ENV HOME=/tmp \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=4000
COPY server.py analyze.py /app/

USER jarcfr
EXPOSE 4000
CMD ["python", "/app/server.py"]
