<p align="center">
  <img src="plugin/icons/wf-brand.png" width="96" alt="WF 美工助手">
</p>

# WF 美工助手

面向电商修图的 Photoshop UXP 插件。把 AI 工作流、服装批量调色、白底成片质检和衣物蒙版编辑放进同一个面板。

**[下载最新 Windows 安装包](https://github.com/xiaoche097/WF-Art-Designer/releases/latest)** · [版本记录](https://github.com/xiaoche097/WF-Art-Designer/releases) · [衣物美化验收记录](docs/cloth-retouch-acceptance.md)

## 安装

支持 Windows 上的 Photoshop 25.0 及更新版本。

1. 打开 [最新发布页](https://github.com/xiaoche097/WF-Art-Designer/releases/latest)，在 **Assets** 下载 `WfArtAssistant-<版本>-Installer.exe`。
2. 保存文档，退出 Photoshop，运行 EXE 安装。
3. 重新打开 Photoshop，从 **增效工具 → WF美工助手** 打开面板。

## 功能

| 板块 | 主要用途 |
| --- | --- |
| RunningHub | 提交工作流任务，把结果回传 Photoshop。 |
| 织影 | 配置自己的 API 地址和密钥，拉取并选择模型。支持 Gemini 和 OpenAI Images 兼容接口。 |
| Comfy UI | 连接自己的 ComfyUI，选择并运行工作流。 |
| 精修工具 | 批量调色、白底成片质检、衣物分割与蒙版编辑。 |
| 设置 | 检查 GitHub 最新稳定版，下载更新或当前版本安装包。 |

织影拉取模型后可在「参数设置」里选择该模型的分辨率和比例。供应商返回的选项优先，标准模型可使用其公开规格。未提供可用选项的模型会使用供应商默认值。

### 批量调色

在 Photoshop 给服装图层组添加像素蒙版，组的混合模式保持「穿透」。在 **精修工具 → 批量调色** 读取蒙版组，加入最多 40 张 SKU 参考图。可自动取色、手动框选修正和逐款预览。写入后，每个 SKU 都有一组可编辑的 Photoshop 原生调整层。

### 成片质检

在 **精修工具 → 成片质检** 检查白底商品图的尺寸、背景、主体越界、边缘溢色、曝光和清晰度。批量调色与质检均在本地运行，支持 1200 万像素以内的文档。相关算法参考 [Life-ai 商业精修](https://github.com/xiaoche0907/Life-ai/tree/005d77b)。

### 衣物美化

在 **精修工具 → 衣物美化** 打开 8 位 sRGB 文档。可以直接读取 Photoshop 选区和像素蒙版，也可以用本地 SAM 2.1 Tiny 通过正负点分割衣物。支持画笔、撤销重做、蒙版叠色和 100% 原始像素检查。写入会创建默认隐藏的独立图层和可编辑蒙版。

SAM 首次使用需要 `uv`、Python 3.12 和网络连接来下载官方权重。之后分割在本机运行。在插件安装目录打开 PowerShell，运行下列命令，再把终端显示的配对码填入面板：

```powershell
& .\cloth-engine\start.ps1
```

从源码运行时使用 `& .\local-engine\start.ps1`。P1 的分割与画笔工作图长边上限为 640 像素，写入按原尺寸映射并应用 Photoshop 的原尺寸约束。当前版本交付分割与蒙版工作流，去褶属于后续阶段。[衣物美化验收记录](docs/cloth-retouch-acceptance.md)

## 检测更新

打开 **设置 → 插件与更新**。v2.3.3 起，进入设置会立即查询，停留在设置时每 5 分钟复查，也可以随时点击「检测更新」。每次查询直接读取 GitHub 的最新正式 Release。发现新版后，下载 EXE、运行安装器，再重启 Photoshop。需要修复当前安装时，使用「重新安装插件」下载当前版本的 EXE。

## 网页预览与开发

```sh
npm ci
npm run build:web
npm run serve:web
```

在浏览器打开 `http://127.0.0.1:4173/`。使用 `npm run watch:web` 持续构建，刷新网页查看改动。网页与插件共用 React 界面，Photoshop 文档、图层、任务提交及插件缓存操作在 Photoshop 面板中完成。

- `src/` 是 React 界面，`plugin/host/` 是 UXP 宿主桥接，`local-engine/` 是本地 SAM 服务。
- `npm run build:prod` 生成插件目录 `dist/`。
- `npm run release:plain` 生成 Windows EXE 和 CCX。可以通过 `ISCC` 环境变量指定 Inno Setup 编译器。

### 发布新版

1. 同步更新 `plugin/manifest.json`、`package.json` 和锁文件的版本，构建并校验安装包。
2. 推送源码，在本仓库创建正式 Release，使用 `vX.Y.Z` 标签，附上 `WfArtAssistant-X.Y.Z-Installer.exe` 和对应 SHA-256 文件。发布时设置为最新稳定版。
3. 核对 [最新发布页](https://github.com/xiaoche097/WF-Art-Designer/releases/latest) 可以匿名下载，再用前一版插件的「检测更新」检查新版本。保留已发布的 EXE，以便对应版本重装。

插件追踪的是 GitHub 的正式 Release。源码提交、草稿和预发布不会触发稳定版更新提示。[GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
