# Descompilacao de .NET (plans/caca-e-formatos, item 3): ilspycmd 11.2 (MIT), o binario nativo para
# Linux (AOT, sem o runtime do .NET), do pacote ilspycmd.linux-x64 do NuGet conferido pelo SHA-256.
# Sem rede, sem root e com a raiz somente leitura no compose; um container por analise (server.py).
FROM python:3.14-slim AS fetch
ADD --checksum=sha256:5be3af86839e93075d103e5b4fec73a637b8d70e49c97eaf043ebe55b7c7800d \
  https://api.nuget.org/v3-flatcontainer/ilspycmd.linux-x64/11.2.0.10050/ilspycmd.linux-x64.11.2.0.10050.nupkg \
  /tmp/ilspy.nupkg
RUN python -m zipfile -e /tmp/ilspy.nupkg /tmp/ilspy \
  && mkdir -p /opt/ilspy \
  && cp /tmp/ilspy/tools/any/linux-x64/ilspycmd /opt/ilspy/ilspycmd \
  && chmod 755 /opt/ilspy/ilspycmd

FROM python:3.14-slim
# As correcoes de seguranca que o Debian ja publicou e a imagem do Python ainda nao tem. O pip sai
# da imagem: o runtime so roda python e o ilspycmd.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10011 --no-create-home --shell /usr/sbin/nologin dotnet \
  && python -m pip uninstall -y -q pip
COPY --from=fetch /opt/ilspy /opt/ilspy
# O ILSpy nao precisa de cultura (os nomes vem do assembly) nem de telemetria.
ENV HOME=/tmp \
  DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 \
  DOTNET_CLI_TELEMETRY_OPTOUT=1 \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=3900
COPY server.py analyze.py /app/

USER dotnet
EXPOSE 3900
CMD ["python", "/app/server.py"]
