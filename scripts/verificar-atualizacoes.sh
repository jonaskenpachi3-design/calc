#!/usr/bin/env sh
# Mostra se os repositórios oficiais têm versão mais nova que a fixada em versoes.txt. Não altera nada.
set -eu
cd "$(dirname "$0")/.."
grep -v '^\s*#' versoes.txt | grep -v '^\s*$' | while read -r repo sha _; do
  novo=$(git ls-remote "https://github.com/ReceitaFederal/$repo.git" HEAD | cut -f1)
  if [ "$novo" = "$sha" ]; then echo "$repo: em dia"; else echo "$repo: HÁ ATUALIZAÇÃO (fixado ${sha%"${sha#???????}"}, atual ${novo%"${novo#???????}"}). Veja https://github.com/ReceitaFederal/$repo/commits"; fi
done
