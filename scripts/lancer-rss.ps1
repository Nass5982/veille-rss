param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$rssRoot = Split-Path -Parent $PSScriptRoot
$rssCli = Join-Path $rssRoot 'node_modules\next\dist\bin\next'
$rssUrl = 'http://localhost:3000'
$rssMutex = $null
$rssLocked = $false

try {
    if (-not (Test-Path -LiteralPath $rssCli)) {
        throw 'Les dependances manquent. Executez npm install dans le dossier RSS, puis relancez ce fichier.'
    }

    # Prefer installed Node; the bundled runtime also works on this computer without npm in PATH.
    $rssCandidates = @()
    $rssCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($rssCommand) { $rssCandidates += $rssCommand.Source }
    $rssCandidates += Join-Path $env:ProgramFiles 'nodejs\node.exe'
    $rssCandidates += Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    $rssNode = $null
    foreach ($rssCandidate in ($rssCandidates | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $rssCandidate) {
            $rssVersion = & $rssCandidate -p 'process.versions.node' 2>$null
            if ($LASTEXITCODE -eq 0 -and [version]$rssVersion -ge [version]'22.13.0') {
                $rssNode = $rssCandidate
                break
            }
        }
    }
    if (-not $rssNode) { throw 'Node.js 22.13 minimum est requis. Installez Node.js 24 LTS, puis relancez Lancer RSS.' }
    if ($CheckOnly) {
        Write-Host "Verification OK : Node $rssVersion et Next.js disponibles."
        exit 0
    }

    $rssMutex = New-Object System.Threading.Mutex($false, 'Local\SourceRSSLauncher3000')
    try { $rssLocked = $rssMutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $rssLocked = $true }
    if (-not $rssLocked) {
        Write-Host 'Le demarrage de RSS est deja en cours dans une autre fenetre.'
        exit 0
    }

    function Get-RssPageState {
        try {
            $rssPage = Invoke-WebRequest -Uri $rssUrl -UseBasicParsing -TimeoutSec 3
            if ($rssPage.Content -match '<title>Source[^<]*RSS</title>') { return 'ready' }
            return 'occupied'
        } catch {
            if ($_.Exception.Response) { return 'occupied' }
            return 'waiting'
        }
    }

    $rssState = Get-RssPageState
    if ($rssState -eq 'occupied') {
        throw 'Le port 3000 repond, mais ce n est pas la page RSS attendue. Aucun autre programme ne sera arrete.'
    }
    if ($rssState -ne 'ready') {
        # A listener may be starting or unresponsive: do not launch a second server on its port.
        $rssListener = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
            Where-Object { $_.Port -eq 3000 }
        $rssProcess = $null
        if (-not $rssListener) {
            $rssLogDir = Join-Path $rssRoot 'data'
            New-Item -ItemType Directory -Path $rssLogDir -Force | Out-Null
            $rssOutput = Join-Path $rssLogDir 'launcher-output.log'
            $rssErrors = Join-Path $rssLogDir 'launcher-errors.log'
            Write-Host 'Demarrage de RSS en arriere-plan...'
            $rssProcess = Start-Process -FilePath $rssNode `
                -ArgumentList @(('"' + $rssCli + '"'), 'dev', '--hostname', '127.0.0.1', '--port', '3000') `
                -WorkingDirectory $rssRoot -WindowStyle Hidden `
                -RedirectStandardOutput $rssOutput -RedirectStandardError $rssErrors -PassThru
        } else { Write-Host 'Un serveur ecoute deja sur le port 3000. Verification de RSS...' }

        $rssDeadline = [DateTime]::UtcNow.AddSeconds(90)
        do {
            if ($rssProcess -and $rssProcess.HasExited) {
                if (Test-Path -LiteralPath $rssErrors) { Get-Content -LiteralPath $rssErrors -Tail 15 | Write-Host }
                throw 'Le serveur s est arrete pendant le demarrage. Consultez data\launcher-errors.log.'
            }
            $rssState = Get-RssPageState
            if ($rssState -eq 'ready') { break }
            if ($rssState -eq 'occupied') { throw 'Le port 3000 renvoie une autre page ou une erreur. Consultez les journaux dans data.' }
            Start-Sleep -Milliseconds 700
        } while ([DateTime]::UtcNow -lt $rssDeadline)
        if ($rssState -ne 'ready') {
            throw 'RSS ne repond pas apres 90 secondes. Consultez data\launcher-output.log et data\launcher-errors.log.'
        }
    }

    Write-Host "RSS est pret : $rssUrl"
    Start-Process -FilePath $rssUrl
    Write-Host 'Le serveur reste en arriere-plan. Fermer le navigateur ne l arrete pas.'
} catch {
    Write-Host "ERREUR : $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($rssLocked) { $rssMutex.ReleaseMutex() }
    if ($rssMutex) { $rssMutex.Dispose() }
}
