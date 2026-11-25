param([switch]$NoOpen)

$ErrorActionPreference = 'Stop'
$revision = '894e7fb62d50eb8f1f79959cadba97bb791bdc03'
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (!$docker) { throw '请安装 Docker Desktop 并启动 Docker 引擎。' }
$git = Get-Command git -ErrorAction SilentlyContinue
if (!$git) { throw '请安装 Git for Windows，然后重新打开此启动项。' }
& $docker.Source info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 引擎未就绪，请启动 Docker Desktop 后重试。' }

$root = Join-Path $env:LOCALAPPDATA 'WF-Art-Designer/EcomGen'
New-Item -ItemType Directory -Path $root -Force | Out-Null
$source = Join-Path $root 'source'
if (!(Test-Path -LiteralPath $source)) {
    & $git.Source clone --depth 1 https://github.com/linbei0/EcomGen.git $source
    if ($LASTEXITCODE -ne 0) { throw 'EcomGen 源码下载失败。' }
}
$head = & $git.Source -C $source rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw '本地 EcomGen 源码目录无效。' }
if ($head -ne $revision) {
    & $git.Source -C $source fetch --depth 1 origin $revision
    if ($LASTEXITCODE -ne 0) { throw 'EcomGen 固定版本下载失败。' }
    & $git.Source -C $source checkout --detach $revision
    if ($LASTEXITCODE -ne 0) { throw '无法切换到 EcomGen 固定版本。' }
}

$envFile = Join-Path $root '.env'
if (!(Test-Path -LiteralPath $envFile)) {
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $bytes = New-Object byte[] 32
        $random.GetBytes($bytes)
        $newFile = [IO.File]::Open($envFile, [IO.FileMode]::CreateNew)
        try {
            $content = [Text.Encoding]::ASCII.GetBytes('ECOMGEN_MASTER_KEY=' + [Convert]::ToBase64String($bytes) + "`n")
            $newFile.Write($content, 0, $content.Length)
        } finally { $newFile.Dispose() }
    } finally { $random.Dispose() }
}
$compose = Join-Path $root 'compose.yml'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'compose.yml') -Destination $compose -Force
$argsForCompose = @('compose', '--project-name', 'wf-ecomgen', '--env-file', $envFile, '--file', $compose)
& $docker.Source @argsForCompose up --detach --build
if ($LASTEXITCODE -ne 0) { throw 'EcomGen 部署失败，请查看上方的 Docker 输出。' }

for ($attempt = 0; $attempt -lt 35; $attempt++) {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 3
        if ($health.status -eq 'ok') {
            Write-Output 'EcomGen 已启动：http://127.0.0.1:8787'
            if (!$NoOpen) { Start-Process 'http://127.0.0.1:8787' }
            exit 0
        }
    } catch {
        # The API may still be listening or opening the database.
    }
    Start-Sleep -Seconds 2
}
throw 'EcomGen API 尚未通过健康检查。'
