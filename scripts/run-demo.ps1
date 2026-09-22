param(
    [switch]$WithBridge,
    [string]$GroqApiKey,
    [string]$GroqModel,
    [string]$AwsAccessKeyId,
    [string]$AwsSecretAccessKey,
    [string]$AwsRegion,
    [string]$NovaLiteModel,
    [string]$NovaSonicModel,
    [string]$BackendUrl = "http://127.0.0.1:8080",
    [switch]$EnableStreamingTranscription,
    [switch]$EnableAutoReplace,
    [double]$AutoReplaceConfidence = 0.90,
    [switch]$EnableManagedBrowserFallback,
    [switch]$WarmManagedBrowser,
    [switch]$SkipNpmInstall,
    [switch]$SkipCleanup,
    [switch]$NoHealthCheck,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
    Write-Host "Usage:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\run-demo.ps1 [-WithBridge] [-GroqApiKey <KEY>] [-GroqModel <MODEL>] [-BackendUrl <URL>] [-EnableStreamingTranscription] [-EnableAutoReplace]"
    return
}

$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root "backend\nova-agent"
$browserAgentDir = Join-Path $root "desktop\browser-action-agent"
$extensionBridgeDir = Join-Path $root "desktop\browser-native-host"
$companionProject = Join-Path $root "desktop\corsiri-companion\src\Corsiri.Companion\Corsiri.Companion.csproj"
$bridgeProject = Join-Path $root "plugin\logitech-plugin\src\Corsiri.Logitech.Bridge\Corsiri.Logitech.Bridge.csproj"

Write-Host "Starting Corsiri Groq demo stack..."
Write-Host "Backend: $backendDir"
Write-Host "Browser action agent: $browserAgentDir"
Write-Host "Companion project: $companionProject"

if (-not $SkipCleanup) {
    try {
        Write-Host "Running pre-launch cleanup..."
        & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stop-demo.ps1") | Out-Host
    } catch {
        Write-Warning "Cleanup step failed: $($_.Exception.Message)"
    }
}

# Resolve Groq credentials (param > env > .env file)
if ($GroqApiKey)         { $resolvedGroqKey   = $GroqApiKey }         else { $resolvedGroqKey   = $env:GROQ_API_KEY }
if ($GroqModel)          { $resolvedGroqModel = $GroqModel }          else { $resolvedGroqModel = $env:GROQ_MODEL }

$envFilePath = Join-Path $root ".env"
if (-not (Test-Path $envFilePath)) {
    $envFilePath = Join-Path $backendDir ".env"
}
if (Test-Path $envFilePath) {
    Get-Content $envFilePath | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line -split "=", 2
            $k = $parts[0].Trim()
            $v = $parts[1].Trim()
            if ($k -eq "GROQ_API_KEY" -and -not $resolvedGroqKey) { $resolvedGroqKey = $v }
            if ($k -eq "GROQ_MODEL" -and -not $resolvedGroqModel) { $resolvedGroqModel = $v }
        }
    }
}

if (-not $resolvedGroqModel) { $resolvedGroqModel = "openai/gpt-oss-120b" }

if (-not $resolvedGroqKey) {
    Write-Warning "GROQ_API_KEY was not found. Please configure .env with GROQ_API_KEY."
}

if ($resolvedGroqKey) { $groqKeyEscaped = $resolvedGroqKey.Replace("'", "''") } else { $groqKeyEscaped = "" }
$groqModelEscaped = $resolvedGroqModel.Replace("'", "''")

if ($resolvedKeyId)  { $keyIdEscaped  = $resolvedKeyId.Replace("'", "''")  } else { $keyIdEscaped  = "" }
if ($resolvedSecret) { $secretEscaped = $resolvedSecret.Replace("'", "''") } else { $secretEscaped = "" }
$regionEscaped = if ($resolvedRegion) { $resolvedRegion.Replace("'", "''") } else { "us-east-1" }
$liteModelEscaped = if ($NovaLiteModel) { $NovaLiteModel.Replace("'", "''") } else { "us.amazon.nova-lite-v1:0" }
$sonicModelEscaped = if ($NovaSonicModel) { $NovaSonicModel.Replace("'", "''") } else { "amazon.nova-2-sonic-v1:0" }

# Locate installed runtimes if not in standard PATH
$nodeDir = "$env:LOCALAPPDATA\Programs\nodejs"
$dotnetDir = "$env:USERPROFILE\.dotnet"
if (Test-Path $nodeDir) { $env:Path = "$nodeDir;$env:Path" }
if (Test-Path $dotnetDir) {
    $env:DOTNET_ROOT = $dotnetDir
    $env:Path = "$dotnetDir;$env:Path"
}

$backendCmdParts = @(
    "`$env:Path='$nodeDir;' + `$env:Path"
)
if ($groqKeyEscaped) {
    $backendCmdParts += "`$env:GROQ_API_KEY='$groqKeyEscaped'"
    $backendCmdParts += "`$env:GROQ_MODEL='$groqModelEscaped'"
}
if ($keyIdEscaped) {
    $backendCmdParts += "`$env:AWS_ACCESS_KEY_ID='$keyIdEscaped'"
    $backendCmdParts += "`$env:AWS_SECRET_ACCESS_KEY='$secretEscaped'"
    $backendCmdParts += "`$env:AWS_REGION='$regionEscaped'"
}
$backendCmdParts += "Set-Location -LiteralPath '$backendDir'"

if (-not $SkipNpmInstall) { $backendCmdParts += "npm install" }
$backendCmdParts += "npm start"
$backendCmd = $backendCmdParts -join "; "
$backendProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -PassThru

$browserAgentCmdParts = @(
    "`$env:Path='$nodeDir;' + `$env:Path",
    "`$env:CORSIRI_BROWSER_CHANNEL='chrome'",
    "`$env:CURSIVIS_BROWSER_CHANNEL='chrome'",
    "Set-Location -LiteralPath '$browserAgentDir'"
)
if (-not $SkipNpmInstall) { $browserAgentCmdParts += "npm install" }
$browserAgentCmdParts += "npm start"
$browserAgentCmd = $browserAgentCmdParts -join "; "
$browserAgentProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", $browserAgentCmd -PassThru

$extensionBridgeCmd = "`$env:Path='$nodeDir;' + `$env:Path; Set-Location -LiteralPath '$extensionBridgeDir'; .\launch.cmd"
$extensionBridgeProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", $extensionBridgeCmd -PassThru

Start-Sleep -Seconds 2

$streamingValue = if ($EnableStreamingTranscription) { "true" } else { "false" }
$autoReplaceConfidenceInvariant = $AutoReplaceConfidence.ToString([System.Globalization.CultureInfo]::InvariantCulture)
$managedBrowserFallbackValue = if ($EnableManagedBrowserFallback) { "true" } else { "false" }

$escapedBackendUrl = $BackendUrl.Replace("'", "''")
$companionCmdParts = @(
    "`$env:DOTNET_ROOT='$dotnetDir'",
    "`$env:Path='$dotnetDir;' + `$env:Path",
    "`$env:CORSIRI_BACKEND_URL='$escapedBackendUrl'",
    "`$env:CURSIVIS_BACKEND_URL='$escapedBackendUrl'",
    "`$env:CORSIRI_ENABLE_STREAMING_TRANSCRIPTION='$streamingValue'",
    "`$env:CURSIVIS_ENABLE_STREAMING_TRANSCRIPTION='$streamingValue'",
    "`$env:CORSIRI_ENABLE_MANAGED_BROWSER_FALLBACK='$managedBrowserFallbackValue'",
    "`$env:CURSIVIS_ENABLE_MANAGED_BROWSER_FALLBACK='$managedBrowserFallbackValue'"
)

if ($EnableAutoReplace) {
    $companionCmdParts += "`$env:CORSIRI_ENABLE_AUTO_REPLACE='true'"
    $companionCmdParts += "`$env:CURSIVIS_ENABLE_AUTO_REPLACE='true'"
    $companionCmdParts += "`$env:CORSIRI_AUTO_REPLACE_CONFIDENCE='$autoReplaceConfidenceInvariant'"
    $companionCmdParts += "`$env:CURSIVIS_AUTO_REPLACE_CONFIDENCE='$autoReplaceConfidenceInvariant'"
}

$companionCmdParts += "dotnet run --project '$companionProject'"
$companionCmd = $companionCmdParts -join "; "
$companionProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", $companionCmd -PassThru

if ($WithBridge) {
    Start-Sleep -Seconds 1
    $bridgeProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", "dotnet run --project '$bridgeProject'" -PassThru
    Write-Host "Bridge PID: $($bridgeProcess.Id)"
}

if (-not $NoHealthCheck) {
    $healthOk = $false
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline) {
        try {
            $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8080/health" -TimeoutSec 4
            if ($health.StatusCode -eq 200) { $healthOk = $true; Write-Host "Backend health: OK"; break }
        } catch { Start-Sleep -Milliseconds 700 }
    }
    if (-not $healthOk) { Write-Warning "Backend health check did not return 200 yet. Check backend terminal output." }

    $browserHealthOk = $false
    $browserDeadline = (Get-Date).AddSeconds(25)
    while ((Get-Date) -lt $browserDeadline) {
        try {
            $browserHealth = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:48820/health" -TimeoutSec 4
            if ($browserHealth.StatusCode -eq 200) { $browserHealthOk = $true; Write-Host "Browser action agent health: OK"; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $browserHealthOk) { Write-Warning "Browser action agent health check did not return 200 yet." }
    elseif ($WarmManagedBrowser -and $EnableManagedBrowserFallback) {
        try {
            Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:48820/ensure-browser" -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 12 | Out-Null
            Write-Host "Managed action browser session: ready"
        } catch { Write-Warning "Could not warm the managed action browser session yet." }
    }

    $extensionBridgeHealthOk = $false
    $extensionBridgeDeadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $extensionBridgeDeadline) {
        try {
            $extensionBridgeHealth = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:48830/health" -TimeoutSec 4
            if ($extensionBridgeHealth.StatusCode -eq 200) { $extensionBridgeHealthOk = $true; Write-Host "Extension bridge host health: OK"; break }
        } catch { Start-Sleep -Milliseconds 400 }
    }
    if (-not $extensionBridgeHealthOk) { Write-Warning "Extension bridge host health check did not return 200 yet." }
}

if ($resolvedKeyId) {
    Write-Host "Launched with AWS credentials injected into backend process."
} else {
    Write-Host "Launched. Make sure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set for the backend terminal."
}
Write-Host "Backend PID: $($backendProcess.Id)"
Write-Host "Browser action agent PID: $($browserAgentProcess.Id)"
Write-Host "Extension bridge host PID: $($extensionBridgeProcess.Id)"
Write-Host "Companion PID: $($companionProcess.Id)"
Write-Host "Tip: close the spawned PowerShell windows to stop each component."
