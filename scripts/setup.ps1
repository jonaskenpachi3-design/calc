# Windows (PowerShell): baixa os três repositórios oficiais para vendor\ e cria o .env.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force vendor | Out-Null
foreach ($r in 'calculadora-rtc-regime-regular', 'calculadora-rtc-simples-nacional', 'calculadora-rtc-gerador-danfse') {
  if (Test-Path "vendor/$r/.git") { git -C "vendor/$r" pull --ff-only }
  else { git clone --depth 1 "https://github.com/ReceitaFederal/$r.git" "vendor/$r" }
}
if (-not (Test-Path .env)) {
  $chars = (48..57) + (65..90) + (97..122)
  $s = -join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })
  $a = -join ($chars | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  [IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), "AUTH_SECRET=$s`nADMIN_TOKEN=$a`n")
  Write-Host '.env criado com segredos aleatórios.'
}
Write-Host 'Pronto. Suba com: docker compose up --build'
