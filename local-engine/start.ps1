param()
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $env:LOCALAPPDATA 'WF-Art-Designer\cloth-engine'
$python = Join-Path $runtime 'venv\Scripts\python.exe'
$weights = Join-Path $runtime 'sam2.1_hiera_tiny.pt'
$sha = '7402E0D864FA82708A20FBD15BC84245C2F26DFF0EB43A4B5B93452DEB34BE69'

function Get-CheckpointHash([string] $FilePath) {
    $stream = [IO.File]::OpenRead($FilePath)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
    } finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

New-Item -ItemType Directory -Path $runtime -Force | Out-Null
if (-not (Test-Path -LiteralPath $python)) {
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'Install uv and Python 3.12 first.' }
    uv venv --python 3.12 "$runtime/venv"
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
}
& $python -c 'import torch, torchvision, sam2'
if ($LASTEXITCODE -ne 0) {
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'Install uv to set up the local SAM dependencies.' }
    uv pip install --python $python --index-url https://download.pytorch.org/whl/cpu 'torch==2.7.1' 'torchvision==0.22.1'
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the CPU inference runtime.' }
    $env:SAM2_BUILD_CUDA = '0'
    uv pip install --python $python 'https://github.com/facebookresearch/sam2/archive/2b90b9f5ceec907a1c18123530e92e794ad901a4.zip'
    if ($LASTEXITCODE -ne 0) { throw 'Could not install SAM 2.1.' }
}
if (-not (Test-Path -LiteralPath $weights)) {
    $temporary = Join-Path $runtime ('checkpoint-'+[guid]::NewGuid()+'.download')
    curl.exe --fail --location --retry 2 --output $temporary 'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt'
    if ($LASTEXITCODE -ne 0) { throw 'Could not download the official Tiny checkpoint.' }
    if ((Get-CheckpointHash $temporary) -ne $sha) { throw 'Checkpoint hash mismatch.' }
    Move-Item -LiteralPath $temporary -Destination $weights
}
if ((Get-CheckpointHash $weights) -ne $sha) { throw 'Checkpoint hash mismatch. Remove the invalid file and retry.' }
& $python (Join-Path $PSScriptRoot 'service.py') --checkpoint $weights --device cpu
if ($LASTEXITCODE -ne 0) { throw 'The local SAM service stopped with an error.' }
