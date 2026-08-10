<#
.SYNOPSIS
  Starts the local AI endpoint and publishes it through a Cloudflare tunnel.

.DESCRIPTION
  One command for the whole chain the dashboard's "local" provider needs:

    Ollama on 127.0.0.1:11434  ->  cloudflared quick tunnel  ->  public https URL

  The detail that matters: cloudflared forwards the public hostname as the Host
  header by default, and Ollama answers 403 to any request whose Host is not
  local (its guard against a random web page driving your model). So the tunnel
  is started with --http-host-header localhost:<port>. That single flag is why
  this script exists instead of a one-liner people get wrong once and then debug
  for an hour.

  The finished URL is verified end to end before it is printed, so a 403 shows up
  here rather than inside the dashboard.

  ASCII only on purpose: Windows PowerShell 5.1 reads a .ps1 without a BOM as
  ANSI, and non-ASCII characters break the parse.

.PARAMETER Port
  Port Ollama listens on.

.PARAMETER CloudflaredPath
  Full path to cloudflared.exe. Only needed when it is not on PATH - a manually
  downloaded binary usually is not.

.PARAMETER NoTunnel
  Start (or check) Ollama only. Use this when the dashboard runs on this same
  machine: it calls the model server-side, so http://127.0.0.1:11434 is enough
  and no tunnel is needed.

.EXAMPLE
  .\scripts\start-local-ai.ps1
  .\scripts\start-local-ai.ps1 -NoTunnel
#>

[CmdletBinding()]
param(
  [int]$Port = 11434,
  [string]$CloudflaredPath,
  [switch]$NoTunnel
)

$ErrorActionPreference = 'Stop'

# Everything tunable in one place, as with the app's own config files.
$Config = @{
  ModelsPath     = '/v1/models'
  OllamaWaitSec  = 30
  TunnelWaitSec  = 45
  VerifyRetries  = 5
  VerifyDelaySec = 2
  UrlPattern     = 'https://[a-z0-9-]+\.trycloudflare\.com'
}

$base = "http://127.0.0.1:$Port"

function Write-Step($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "  OK   $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  ..   $text" -ForegroundColor Yellow }
function Write-Fail($text) { Write-Host "  FAIL $text" -ForegroundColor Red }

# Does something answer the OpenAI-compatible model list? Returns the model
# count, or $null when the endpoint is unreachable or refuses us.
function Get-ModelCount([string]$Url) {
  try {
    $res = Invoke-RestMethod -Uri "$Url$($Config.ModelsPath)" -TimeoutSec 10
    return @($res.data).Count
  } catch {
    return $null
  }
}

function Test-Listening([int]$P) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $P -ErrorAction SilentlyContinue)
}

# --- 1. Ollama --------------------------------------------------------------
Write-Step "Local AI endpoint on port $Port"

if (Test-Listening $Port) {
  Write-Ok 'already listening'
} else {
  $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
  if (-not $ollama) {
    Write-Fail 'ollama is not installed. Install it, then re-run:'
    Write-Host '         winget install --id Ollama.Ollama' -ForegroundColor Gray
    exit 1
  }
  Write-Host '  starting ollama serve ...' -ForegroundColor Gray
  Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds($Config.OllamaWaitSec)
  while (-not (Test-Listening $Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Listening $Port)) {
    Write-Fail "ollama did not start within $($Config.OllamaWaitSec)s"
    exit 1
  }
  Write-Ok 'started'
}

$count = Get-ModelCount $base
if ($null -eq $count) {
  Write-Fail "$base$($Config.ModelsPath) did not answer - is another service on port $Port?"
  exit 1
}
if ($count -eq 0) {
  Write-Warn 'reachable, but no models are pulled yet. e.g.: ollama pull gemma3:4b'
} else {
  Write-Ok "$count model(s) available"
}

Write-Host ''
Write-Host '  Dashboard on THIS machine -> set the local AI endpoint to:' -ForegroundColor Gray
Write-Host "    $base" -ForegroundColor White

if ($NoTunnel) {
  Write-Host ''
  Write-Host '  -NoTunnel given: skipping the Cloudflare tunnel.' -ForegroundColor DarkGray
  exit 0
}

# --- 2. Tunnel --------------------------------------------------------------
Write-Step 'Cloudflare tunnel'

# PATH first, then the two places a manual download tends to land, then the
# explicit override - a binary that was downloaded rather than installed is the
# normal case for cloudflared on Windows.
$candidates = @()
if ($CloudflaredPath) { $candidates += $CloudflaredPath }
$candidates += (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
$candidates += Join-Path $PSScriptRoot 'cloudflared.exe'
$candidates += Join-Path $env:USERPROFILE 'Downloads\cloudflared.exe'

$cloudflared = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $cloudflared) {
  Write-Fail 'cloudflared was not found. Either install it:'
  Write-Host '         winget install --id Cloudflare.cloudflared' -ForegroundColor Gray
  Write-Host '       or point at a downloaded copy:' -ForegroundColor Gray
  Write-Host '         .\scripts\start-local-ai.ps1 -CloudflaredPath C:\tools\cloudflared.exe' -ForegroundColor Gray
  Write-Host '       or skip the tunnel when the dashboard runs on this machine:' -ForegroundColor Gray
  Write-Host '         .\scripts\start-local-ai.ps1 -NoTunnel' -ForegroundColor Gray
  exit 1
}
Write-Host "  using $cloudflared" -ForegroundColor DarkGray

# cloudflared prints the assigned URL to stderr inside a banner, so both streams
# go to files we poll rather than being parsed from the pipeline.
$log = Join-Path $env:TEMP "env-monitor-tunnel-$PID.log"
$errLog = "$log.err"
foreach ($f in @($log, $errLog)) { if (Test-Path $f) { Remove-Item $f -Force } }

$tunnelArgs = @(
  'tunnel', '--url', $base,
  # The whole point: Ollama 403s anything whose Host is not local.
  '--http-host-header', "localhost:$Port",
  '--no-autoupdate'
)

$proc = Start-Process -FilePath $cloudflared -ArgumentList $tunnelArgs `
  -RedirectStandardOutput $log -RedirectStandardError $errLog `
  -WindowStyle Hidden -PassThru

Write-Host '  waiting for the public URL ...' -ForegroundColor Gray
$url = $null
$deadline = (Get-Date).AddSeconds($Config.TunnelWaitSec)
while (-not $url -and (Get-Date) -lt $deadline) {
  if ($proc.HasExited) {
    Write-Fail "cloudflared exited with code $($proc.ExitCode)"
    if (Test-Path $errLog) {
      Get-Content $errLog -Tail 15 | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
    }
    exit 1
  }
  foreach ($file in @($log, $errLog)) {
    if (Test-Path $file) {
      $hit = Select-String -Path $file -Pattern $Config.UrlPattern -AllMatches | Select-Object -Last 1
      if ($hit) { $url = $hit.Matches[-1].Value; break }
    }
  }
  if (-not $url) { Start-Sleep -Milliseconds 700 }
}

if (-not $url) {
  Write-Fail "no tunnel URL appeared within $($Config.TunnelWaitSec)s"
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Ok "tunnel up: $url"

# --- 3. Prove it end to end -------------------------------------------------
# A tunnel that resolves is not the same as a tunnel Ollama will answer through:
# that is exactly the 403 this script is built to avoid.
Write-Step 'Verifying through the tunnel'
$through = $null
for ($i = 1; $i -le $Config.VerifyRetries; $i++) {
  $through = Get-ModelCount $url
  if ($null -ne $through) { break }
  Start-Sleep -Seconds $Config.VerifyDelaySec
}

if ($null -eq $through) {
  Write-Fail "the tunnel answered, but $($Config.ModelsPath) did not."
  Write-Host '       A 403 here means the Host rewrite did not take effect - check that' -ForegroundColor Gray
  Write-Host '       this cloudflared build supports --http-host-header.' -ForegroundColor Gray
} else {
  Write-Ok "$through model(s) visible through the tunnel"
  try { Set-Clipboard -Value $url; Write-Ok 'URL copied to the clipboard' } catch {}
  Write-Host ''
  Write-Host '  Hosted dashboard (Vercel) -> Settings -> local AI endpoint:' -ForegroundColor Gray
  Write-Host "    $url" -ForegroundColor White
  Write-Host '  Then press the "test connection" button under that field.' -ForegroundColor Gray
}

Write-Host ''
Write-Host "Tunnel PID $($proc.Id) - log $log" -ForegroundColor DarkGray
Write-Host 'Press Ctrl+C to stop the tunnel (Ollama keeps running).' -ForegroundColor DarkGray

try {
  while (-not $proc.HasExited) { Start-Sleep -Seconds 1 }
} finally {
  # A quick tunnel's URL is disposable: leaving the process behind would keep a
  # stale URL alive that nobody has written down.
  if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Write-Host "`nTunnel stopped." -ForegroundColor DarkGray
  }
}
