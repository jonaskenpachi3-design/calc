#!/usr/bin/env sh
# Baixa os três repositórios oficiais para vendor/ nas versões fixadas em versoes.txt (sem modificá-los).
set -eu
cd "$(dirname "$0")/.."
mkdir -p vendor
grep -v '^\s*#' versoes.txt | grep -v '^\s*$' | while read -r repo sha _; do
  dir="vendor/$repo"
  if [ ! -d "$dir/.git" ]; then
    git init -q "$dir"
    git -C "$dir" remote add origin "https://github.com/ReceitaFederal/$repo.git"
  fi
  if [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)" = "$sha" ]; then
    echo "$repo: já está em ${sha%"${sha#???????}"}"
  else
    git -C "$dir" fetch -q --depth 1 origin "$sha"
    git -C "$dir" checkout -q -f --detach FETCH_HEAD
    echo "$repo: fixado em ${sha%"${sha#???????}"}"
  fi
done
[ -f .env ] || {
  printf 'AUTH_SECRET=%s\nADMIN_TOKEN=%s\n' "$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/')" "$(head -c 24 /dev/urandom | base64 | tr -d '\n=+/')" > .env
  echo ".env criado com segredos aleatórios."
}
echo "Pronto. Suba com: docker compose up --build"
