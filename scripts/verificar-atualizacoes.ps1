# Mostra se os repositórios oficiais têm versão mais nova que a fixada em versoes.txt. Não altera nada.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
foreach ($linha in Get-Content versoes.txt) {
  if ($linha -match '^\s*#' -or $linha -match '^\s*$') { continue }
  $p = ($linha -replace '#.*$', '').Trim() -split '\s+'
  $repo = $p[0]; $sha = $p[1]
  $novo = ((git ls-remote "https://github.com/ReceitaFederal/$repo.git" HEAD) -split '\s+')[0]
  if ($novo -eq $sha) { Write-Host "${repo}: em dia" }
  else { Write-Host "${repo}: HÁ ATUALIZAÇÃO (fixado $($sha.Substring(0,7)), atual $($novo.Substring(0,7))). Veja https://github.com/ReceitaFederal/$repo/commits" }
}
