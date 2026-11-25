const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const launcherName = "WfArtAssistant-Launcher.exe";

function buildLauncher(releaseDir, icon) {
    const framework = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319");
    const compiler = process.env.WF_CSC || path.join(framework, "csc.exe");
    if (!fs.existsSync(compiler)) throw new Error("Windows .NET Framework C# compiler not found. Set WF_CSC to csc.exe.");
    const launcher = path.join(releaseDir, launcherName);
    execFileSync(compiler, [
        "/nologo", "/target:winexe", "/platform:x64", "/optimize+", "/codepage:65001",
        "/reference:System.Drawing.dll", "/reference:System.Windows.Forms.dll", "/reference:System.Web.Extensions.dll",
        "/win32icon:" + icon, "/out:" + launcher, path.join(__dirname, "Launcher.cs"),
    ], { stdio: "inherit" });
    return launcher;
}

function launcherEntries(releaseDir) {
    return [
        `Source: "${path.join(releaseDir, launcherName)}"; DestDir: "{app}"; Flags: ignoreversion`,
        "",
        "[Icons]",
        `Name: "{autoprograms}\\WF美工助手"; Filename: "{app}\\${launcherName}"; WorkingDir: "{app}"`,
        'Name: "{autoprograms}\\WF美工助手 · 启动本地 SAM"; Filename: "{sys}\\WindowsPowerShell\\v1.0\\powershell.exe"; Parameters: "-NoProfile -NoExit -ExecutionPolicy RemoteSigned -File ""{app}\\cloth-engine\\start.ps1"""; WorkingDir: "{app}\\cloth-engine"',
        'Name: "{autoprograms}\\WF美工助手 · 启动 EcomGen"; Filename: "{sys}\\WindowsPowerShell\\v1.0\\powershell.exe"; Parameters: "-NoProfile -NoExit -ExecutionPolicy RemoteSigned -File ""{app}\\ecomgen\\start.ps1"""; WorkingDir: "{app}\\ecomgen"',
        "",
        "[Run]",
        `Filename: "{app}\\${launcherName}"; Description: "打开 WF 美工助手启动器"; Flags: postinstall nowait skipifsilent runasoriginaluser`,
    ];
}

module.exports = { buildLauncher, launcherEntries };
