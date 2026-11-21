#!/usr/bin/env sh
# Baixa os três repositórios oficiais para vendor/ (sem modificá-los).
set -eu
cd "$(dirname "$0")/.."
mkdir -p vendor
for r in calculadora-rtc-regime-regular calculadora-rtc-simples-nacional calculadora-rtc-gerador-danfse; do
  if [ -d "vendor/$r/.git" ]; then
    git -C "vendor/$r" pull --ff-only
  else
    git clone --depth 1 "https://github.com/ReceitaFederal/$r.git" "vendor/$r"
  fi
done
[ -f .env ] || {
  printf 'AUTH_SECRET=%s\nADMIN_TOKEN=%s\n' "$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/')" "$(head -c 24 /dev/urandom | base64 | tr -d '\n=+/')" > .env
  echo ".env criado com segredos aleatórios."
}
echo "Pronto. Suba com: docker compose up --build"
