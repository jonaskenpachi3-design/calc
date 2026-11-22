# Windows (PowerShell): baixa os três repositórios oficiais para vendor\ nas versões fixadas em versoes.txt e cria o .env.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force vendor | Out-Null
foreach ($linha in Get-Content versoes.txt) {
  if ($linha -match '^\s*#' -or $linha -match '^\s*$') { continue }
  $p = ($linha -replace '#.*$', '').Trim() -split '\s+'
  $repo = $p[0]; $sha = $p[1]; $dir = "vendor/$repo"
  if (-not (Test-Path "$dir/.git")) {
    git init -q $dir
    git -C $dir remote add origin "https://github.com/ReceitaFederal/$repo.git"
  }
  $atual = git -C $dir rev-parse HEAD 2>$null
  if ($atual -eq $sha) { Write-Host "${repo}: já está em $($sha.Substring(0,7))" }
  else {
    git -C $dir fetch -q --depth 1 origin $sha
    git -C $dir checkout -q -f --detach FETCH_HEAD
    Write-Host "${repo}: fixado em $($sha.Substring(0,7))"
  }
}
if (-not (Test-Path .env)) {
  $chars = (48..57) + (65..90) + (97..122)
  $s = -join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })
  $a = -join ($chars | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  [IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), "AUTH_SECRET=$s`nADMIN_TOKEN=$a`n")
  Write-Host '.env criado com segredos aleatórios.'
}
Write-Host 'Pronto. Suba com: docker compose up --build'
