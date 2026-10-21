# Arrêt PROPRE de la passerelle : dépose le fichier d'arrêt qu'elle surveille,
# puis attend qu'elle ne réponde plus. Ne jamais utiliser « taskkill /F ».
#
#   .\arreter-passerelle.ps1

param(
    [string]$Racine = "",
    [int]$Attente   = 20
)

$ErrorActionPreference = "Stop"
if (-not $Racine) {
    $Racine = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$python = Join-Path $Racine ".venv\Scripts\python.exe"
if (-not $env:GATEWAY_MODE) { $env:GATEWAY_MODE = "tour" }

# Fichier d'arrêt et adresse de santé réels (GATEWAY_LOG_DIR, GATEWAY_PORT),
# lus par le code de la passerelle comme dans superviser-passerelle.ps1.
$fichierArret = Join-Path $Racine "logs\_control\gateway.stop"
$sante = "http://127.0.0.1:8710/api/health"
if (Test-Path $python) {
    Push-Location $Racine
    try { $config = & $python -m terminal_gateway --print-config } finally { Pop-Location }
    if ($LASTEXITCODE -eq 0 -and $config) {
        $lu = $config | ConvertFrom-Json
        $fichierArret = $lu.stop_file
        $sante = $lu.health_url
    } else {
        Write-Warning "configuration illisible : emplacements par defaut ($fichierArret)"
    }
}

New-Item -ItemType Directory -Force -Path (Split-Path $fichierArret) | Out-Null
Set-Content -Path $fichierArret -Value "arret demande"
Write-Host "Demande d'arret deposee : $fichierArret (la passerelle l'efface a son prochain demarrage)"

# La passerelle relit le fichier chaque seconde, puis ferme ses flux.
$fin = (Get-Date).AddSeconds($Attente)
while ((Get-Date) -lt $fin) {
    try {
        $null = Invoke-WebRequest -Uri $sante -UseBasicParsing -TimeoutSec 2
    } catch {
        # Une réponse HTTP d'erreur prouve qu'elle tourne encore ; sinon, elle est arrêtée.
        if (-not $_.Exception.Response) {
            Write-Host "Passerelle arretee."
            exit 0
        }
    }
    Start-Sleep -Seconds 1
}
Write-Warning ("La passerelle repond encore apres ${Attente}s ($sante). " +
               "Voir logs\gateway.log ; ne pas utiliser taskkill /F.")
exit 1
