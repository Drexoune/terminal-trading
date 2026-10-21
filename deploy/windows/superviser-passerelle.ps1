# Superviseur de la passerelle du terminal sous Windows natif (décision T-001).
#
# Même patron que drexbot/deploy/windows/superviser-service.ps1 : le planificateur
# de tâches lance ce script, qui relance la passerelle quand elle s'arrête sur
# une erreur, avec un délai croissant. Arrêt propre : arreter-passerelle.ps1.
#
# Différences voulues avec les collecteurs du bot :
#   - aucune inhibition de la veille : c'est le bot qui garde la tour éveillée ;
#   - priorité processus « BelowNormal » : en cas de contention CPU, les
#     collecteurs du bot passent devant (règle d'intégration 5).
#
#   .\superviser-passerelle.ps1

param(
    [string]$Racine = "",
    [int]$DelaiMax  = 300
)

$ErrorActionPreference = "Stop"

if (-not $Racine) {
    $Racine = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$python  = Join-Path $Racine ".venv\Scripts\python.exe"
$journal = Join-Path $Racine "logs\superviseur-passerelle.log"

New-Item -ItemType Directory -Force -Path (Split-Path $journal) | Out-Null

function Ecrire([string]$message) {
    $ligne = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), $message
    Write-Host $ligne
    Add-Content -Path $journal -Value $ligne
}

if (-not (Test-Path $python)) {
    throw ("python introuvable : $python`n" +
           "Creer l'environnement : python -m venv .venv ; .\.venv\Scripts\pip install -e .")
}

# La tour annonce le Mode Tour (/api/health, ecran Parametres) meme si son .env
# ne le precise pas.
if (-not $env:GATEWAY_MODE) { $env:GATEWAY_MODE = "tour" }

# Fichier d'arrêt réel, lu par le code de la passerelle (environnement puis .env) :
# il suit GATEWAY_LOG_DIR. Une configuration refusée (OKX_REGION, origines…)
# arrête ici, avec son message, plutôt que dans une boucle de relances.
Push-Location $Racine
try { $config = & $python -m terminal_gateway --print-config } finally { Pop-Location }
if ($LASTEXITCODE -ne 0 -or -not $config) {
    throw "configuration de la passerelle illisible (message ci-dessus, et .env)"
}
$fichierArret = ($config | ConvertFrom-Json).stop_file

# Priorité abaissée sur le superviseur lui-même : le lanceur de la venv
# (.venv\Scripts\python.exe) puis l'interpréteur qu'il démarre en héritent dès
# leur création. Abaisser le seul process lancé ne touchait que le lanceur.
try { (Get-Process -Id $PID).PriorityClass = "BelowNormal" } catch { Ecrire "priorite du superviseur non abaissee ($_)" }

# Une demande d'arret laissee par l'arret precedent ferait refuser le demarrage.
Remove-Item -Path $fichierArret -ErrorAction SilentlyContinue
Ecrire "demarrage du superviseur de la passerelle ($python -m terminal_gateway, arret : $fichierArret)"
$delai = 2
while ($true) {
    if (Test-Path $fichierArret) {
        Ecrire "fichier d'arret present - le superviseur ne relance pas"
        break
    }
    $debut = Get-Date
    $processus = Start-Process -FilePath $python -ArgumentList @("-m", "terminal_gateway") `
                               -WorkingDirectory $Racine -NoNewWindow -PassThru
    # Handle mis en cache tout de suite : sans lui, ExitCode peut rester vide
    # une fois le process terminé (Start-Process -PassThru sans -Wait).
    $null = $processus.Handle
    $processus.WaitForExit()
    $duree = [int]((Get-Date) - $debut).TotalSeconds
    $code  = $processus.ExitCode
    if ($null -eq $code) {
        Ecrire "code de sortie illisible - traite comme un plantage"
        $code = -1
    }
    if ($code -eq 0) {
        Ecrire "passerelle arretee proprement apres ${duree}s"
        break
    }
    if ($duree -ge 300) { $delai = 2 } else { $delai = [Math]::Min($delai * 2, $DelaiMax) }
    Ecrire "passerelle terminee (code $code) apres ${duree}s - relance dans ${delai}s"
    Start-Sleep -Seconds $delai
}
Ecrire "superviseur arrete"
