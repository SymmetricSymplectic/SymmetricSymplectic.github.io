<#
.SYNOPSIS
    Bootstrap selectivo de la infraestructura UZDoom-WASM (edicion Windows/PowerShell).

.DESCRIPTION
    Equivalente nativo de scripts/bootstrap_infra.sh para maquinas sin bash/make.
    Clona UNICAMENTE la subcarpeta /doom/ de joeheyming/joeheyming.github.com
    (git sparse-checkout + filtro blob:none), descarta los PK3 de franquicias de
    terceros, copia el runtime a public/engine/ y registra PROVENANCE.json.

    A diferencia del script bash de la especificacion (que clona todo /doom/ y
    luego borra ~155 MB de mods ajenos), aqui los patrones de sparse-checkout ya
    excluyen esos blobs: git nunca los descarga.

    Compatible con Windows PowerShell 5.1 y PowerShell 7+.

.PARAMETER TargetDir
    Carpeta destino, relativa a la raiz del demo. Por defecto public/engine.

.PARAMETER Ref
    Rama o commit de origen. Por defecto: la rama por defecto del remoto.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_infra.ps1
#>
[CmdletBinding()]
param(
    [string] $RepoUrl   = 'https://github.com/joeheyming/joeheyming.github.com.git',
    [string] $Ref       = '',
    [string] $TargetDir = 'public/engine'
)

$ErrorActionPreference = 'Stop'

$Root   = Split-Path -Parent $PSScriptRoot
$Tmp    = Join-Path $Root '.tmp_joeheyming_clone'
$Target = Join-Path $Root $TargetDir

function Write-Step {
    param([string] $Message)
    Write-Output $Message
}

function Remove-Path {
    # Remove-Item -Force no siempre puede con los .pack de git (atributo
    # read-only + bloqueos de OneDrive/antivirus): cmd rmdir como respaldo.
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    try {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
    } catch {
        & cmd /c "rmdir /s /q `"$Path`"" 2>&1 | Out-Null
    }
    if (Test-Path -LiteralPath $Path) {
        Start-Sleep -Milliseconds 400
        & cmd /c "rmdir /s /q `"$Path`"" 2>&1 | Out-Null
    }
}

function Invoke-Git {
    param(
        [string[]] $GitArgs,
        [string]   $WorkDir = ''
    )
    $prefix = @()
    if ($WorkDir) { $prefix = @('-C', $WorkDir) }
    $env:GIT_TERMINAL_PROMPT = '0'

    # En PowerShell 5.1, cualquier escritura a stderr de un comando nativo se
    # convierte en ErrorRecord y, con ErrorActionPreference='Stop', aborta el
    # script (git escribe el progreso del clone en stderr). Se relaja dentro.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $run = {
        param([string[]] $Extra)
        # No mezclar el progreso con el valor de retorno: se devuelve un objeto
        # con las dos cosas y el llamador decide.
        $out = & git @Extra @prefix @GitArgs 2>&1
        return [pscustomobject]@{
            Code   = $LASTEXITCODE
            Output = @($out)
        }
    }

    $res = & $run @()
    foreach ($line in $res.Output) { Write-Output "  $line" }
    $code = $res.Code
    if ($code -ne 0) {
        # Algunos entornos (sandbox corporativo, sesiones sin credenciales) no
        # pueden usar el backend TLS schannel de Git: SEC_E_NO_CREDENTIALS.
        # Git for Windows incluye OpenSSL, que si funciona en ese caso.
        Write-Output '  (reintentando con http.sslBackend=openssl)'
        # El intento fallido deja un .git a medias: hay que limpiarlo o
        # `git clone` aborta con "destination path already exists".
        if ($GitArgs[0] -eq 'clone') { Remove-Path $Tmp }
        $res = & $run @('-c', 'http.sslBackend=openssl')
        foreach ($line in $res.Output) { Write-Output "  $line" }
        $code = $res.Code
    }
    $ErrorActionPreference = $prevEap
    if ($code -ne 0) { throw "git $($GitArgs -join ' ') fallo con codigo $code" }
}

Push-Location $Root
try {
    Write-Step '[1/5] Clonando de forma selectiva /doom/ desde joeheyming/joeheyming.github.com ...'
    Remove-Path $Tmp

    # --no-checkout evita materializar el arbol completo (incluye mods de ~155 MB).
    $cloneArgs = @('clone', '--depth', '1', '--filter=blob:none', '--no-checkout')
    if ($Ref) { $cloneArgs += @('--branch', $Ref) }
    $cloneArgs += @($RepoUrl, $Tmp)
    Invoke-Git -GitArgs $cloneArgs

    Write-Step '[2/5] Aplicando sparse-checkout (solo /doom/, sin franquicias de terceros) ...'
    # Modo --no-cone para poder mezclar inclusiones y exclusiones. Los patrones de
    # exclusion evitan descargar Mario / Metroid / Castlevania / Sonic / Zelda.
    Invoke-Git -WorkDir $Tmp -GitArgs @(
        'sparse-checkout', 'set', '--no-cone',
        '/doom/**',
        '/coi-serviceworker.js',
        '!/doom/*mario*',
        '!/doom/met2*',
        '!/doom/*Castlevania*',
        '!/doom/*sonic*',
        '!/doom/*LegendOfDoom*'
    )
    Invoke-Git -WorkDir $Tmp -GitArgs @('checkout')

    $Commit = (& git -C $Tmp rev-parse HEAD).Trim()
    $Short  = (& git -C $Tmp rev-parse --short HEAD).Trim()
    Write-Step "  commit: $Commit"

    Write-Step '[3/5] Copiando runtime WASM, Service Worker y recursos base a public/engine ...'
    if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    Copy-Item -Path (Join-Path $Tmp (Join-Path 'doom' '*')) -Destination $Target -Recurse -Force

    # Limpieza defensiva (idempotente si ya se excluyeron del checkout).
    $junk = @('*mario*', 'met2*', '*Castlevania*', '*sonic*', '*LegendOfDoom*')
    foreach ($pattern in $junk) {
        Get-ChildItem -Path $Target -Filter $pattern -Force -ErrorAction SilentlyContinue |
            ForEach-Object {
                Write-Step "  eliminando asset de franquicia ajeno: $($_.Name)"
                Remove-Item -Recurse -Force $_.FullName
            }
    }

    $swSrc = Join-Path $Tmp 'coi-serviceworker.js'
    $swDst = Join-Path $Root 'public/coi-serviceworker.js'
    if (Test-Path $swSrc) {
        Copy-Item -Force $swSrc $swDst
        Write-Step '  coi-serviceworker.js (COOP/COEP) copiado a public/'
    } else {
        Write-Step '  AVISO: no se encontro coi-serviceworker.js en el upstream; se conserva el local.'
    }

    Write-Step '[4/5] Registrando metadatos de procedencia ...'
    $prov = [ordered]@{
        upstream_repo   = 'https://github.com/joeheyming/joeheyming.github.com'
        upstream_path   = 'doom/'
        upstream_url    = 'https://joeheyming.github.io/doom/'
        upstream_commit = $Commit
        upstream_short  = $Short
        fetched_at_utc  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        author          = 'Joe Heyming'
        engine          = 'uzdoom-wasm (GPL v3)'
        iwad            = 'Freedoom Phase 1 (BSD 3-Clause)'
        pruned          = @('mariodoom.pk3', 'met2.pk3', 'Castlevania.ipk3', 'sonicdoom-legacy.pk3', 'LegendOfDoom-1.1.0.pk3')
        entry_points    = [ordered]@{
            engine_glue = 'engine/uzdoom.js'
            engine_wasm = 'engine/uzdoom.wasm'
            engine_data = 'engine/uzdoom.data'
            preload_set = 'engine/uzdoom.pk3, game_support.pk3, brightmaps.pk3, lights.pk3, game_widescreen_gfx.pk3'
        }
    }
    $json = $prov | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText(
        (Join-Path $Target 'PROVENANCE.json'),
        $json + [Environment]::NewLine,
        (New-Object System.Text.UTF8Encoding($false))
    )

    Write-Step '[5/5] Limpiando directorio temporal ...'
    Remove-Item -Recurse -Force $Tmp

    $bytes = (Get-ChildItem -Recurse -File $Target | Measure-Object -Property Length -Sum).Sum
    Write-Step ('Infraestructura base lista en {0} ({1:N1} MB, commit {2})' -f $TargetDir, ($bytes / 1MB), $Short)
} finally {
    Pop-Location
}
