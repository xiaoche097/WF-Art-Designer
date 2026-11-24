const fs = require("node:fs");
const path = require("node:path");

const pluginDir = "{commoncf}\\Adobe\\UXP\\Plugins\\External\\WfArtAssistant";
const scriptPath = path.join(__dirname, "register-uxp.ps1");
const script = Buffer.from(fs.readFileSync(scriptPath, "utf8"), "utf16le").toString("base64");
const chunks = script.match(/.{1,160}/g);

const registrationCode = [
    "function PrepareToInstall(var NeedsRestart: Boolean): String;",
    "begin",
    "  Result := '';",
    "  if CompareText(RemoveBackslashUnlessRoot(ExpandConstant('{app}')),",
    `      ExpandConstant('${pluginDir}')) <> 0 then`,
    "    Result := '请选择安装程序指定的 Adobe UXP 插件目录。';",
    "end;",
    "",
    "procedure RegisterWfArtAssistant;",
    "var",
    "  Args: String;",
    "  ResultCode: Integer;",
    "begin",
    "  Args := '-NoLogo -NoProfile -NonInteractive -EncodedCommand '",
    ...chunks.map((chunk, index) => `    + '${chunk}'${index === chunks.length - 1 ? ";" : ""}`),
    "  if not Exec(ExpandConstant('{sys}\\WindowsPowerShell\\v1.0\\powershell.exe'),",
    "      Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then",
    "    RaiseException('无法启动 Photoshop 插件注册。');",
    "  if ResultCode <> 0 then",
    "    RaiseException('Photoshop 插件注册失败。请关闭 Photoshop 后重试安装。');",
    "end;",
    "",
];

module.exports = { pluginDir, registrationCode };
