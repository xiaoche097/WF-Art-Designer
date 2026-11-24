param(
    [string]$PluginsRoot,
    [string]$CatalogPath
)

$ErrorActionPreference = 'Stop'
$commonFiles = $env:CommonProgramW6432
if (-not $commonFiles) { $commonFiles = [Environment]::GetFolderPath('CommonProgramFiles') }
$uxpRoot = Join-Path $commonFiles 'Adobe\UXP'
if (-not $PluginsRoot) { $PluginsRoot = Join-Path $uxpRoot 'Plugins' }
if (-not $CatalogPath) { $CatalogPath = Join-Path $uxpRoot 'PluginsInfo\v1\PS.json' }

$manifestPath = Join-Path $PluginsRoot 'External\WfArtAssistant\manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.id -cne 'WfArtAssistant' -or $manifest.host.app -cne 'PS') {
    throw 'Unexpected WF Art Assistant manifest.'
}

$directory = Split-Path -Parent $CatalogPath
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$existed = Test-Path -LiteralPath $CatalogPath -PathType Leaf
$original = if ($existed) { [IO.File]::ReadAllText($CatalogPath, [Text.Encoding]::UTF8) } else { '{"plugins":[]}' }
$catalog = ConvertFrom-Json -InputObject $original
if (-not $catalog -or $catalog.plugins -isnot [Array]) {
    throw 'The Photoshop plugin catalog has an unexpected format.'
}

$entry = [PSCustomObject][ordered]@{
    hostMinVersion = $manifest.host.minVersion
    name = $manifest.name
    path = '$systemPlugins\External\WfArtAssistant'
    pluginId = $manifest.id
    status = 'enabled'
    type = 'uxp'
    versionString = $manifest.version
}

$current = @($catalog.plugins | Where-Object { $_.pluginId -ceq $manifest.id })
if ($current.Count -eq 1) {
    $left = $current[0]
    $same = $true
    foreach ($key in $entry.PSObject.Properties.Name) {
        if ($left.$key -cne $entry.$key) { $same = $false; break }
    }
    if ($same) { return }
}

$catalog.plugins = @($catalog.plugins | Where-Object { $_.pluginId -cne $manifest.id }) + @($entry)
$token = [Guid]::NewGuid().ToString('N')
$temp = Join-Path $directory "PS.wf-${token}.tmp"
$backup = Join-Path $directory "PS.wf-${token}.bak"
$utf8 = [Text.UTF8Encoding]::new($false)
try {
    $json = (ConvertTo-Json -InputObject $catalog -Depth 64) + [Environment]::NewLine
    [IO.File]::WriteAllText($temp, $json, $utf8)
    if ($existed) {
        if ([IO.File]::ReadAllText($CatalogPath, [Text.Encoding]::UTF8) -cne $original) {
            throw 'The Photoshop plugin catalog changed. Restart Setup to try again.'
        }
        [IO.File]::Replace($temp, $CatalogPath, $backup)
    } else {
        [IO.File]::Move($temp, $CatalogPath)
    }
} finally {
    if (Test-Path -LiteralPath $temp -PathType Leaf) { Remove-Item -LiteralPath $temp }
}
