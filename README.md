# WF美工助手

这是一个 Photoshop UXP 插件。网页预览与插件共用 React 组件和样式。

## 网页预览

```sh
npm ci
npm run build:web
npm run serve:web
```

打开 `http://127.0.0.1:4173/`。网页产物在 `web-dist/`，可以交给任意静态服务器。编辑时在另一个终端运行 `npm run watch:web`，编译完成后刷新网页。

- 网页入口和外框样式在 `web/`。
- 主界面在 `src/runninghub/ui/RunninghubShell.jsx` 和同目录的 CSS。
- 参数区在 `src/runninghub/ui/RhWorkPanel.jsx`，共享组件在 `src/components/`。

网页使用当前浏览器的本地存储。RunningHub 的内置应用参数可直接从下拉列表预览和调整，无需 API Key。RunningHub 任务提交及 Photoshop 画布、图层和插件缓存功能需从插件面板使用。

## Photoshop 插件

运行 `npm run build:prod` 生成 `dist/`，或运行 `npm run release:plain` 生成 CCX 安装包。插件要求 Photoshop 25.0 或更新版本。新插件 ID `WfArtAssistant` 使用独立的 UXP 数据目录。

Windows 安装器由 Inno Setup 编译。可用 `ISCC` 环境变量指定编译器路径。运行 EXE 安装完成后，重启 Photoshop 并从「增效工具」菜单打开「WF美工助手」。

## 织影供应商

在「织影 → 设置 → 账户管理」填写自己的 API Base URL 和 API Key，选择 Gemini 或 OpenAI Images 兼容格式。点击「拉取模型」，在返回的列表里搜索并选择，选中后会自动保存。供应商不提供模型列表时，可展开「手动填写模型 ID」。选择「自定义」后可添加多套供应商配置。

## 精修工具

- **批量调色**。在 Photoshop 中打开原图，将服装区域做成图层组的像素蒙版，保持组的混合模式为「穿透」。在「精修工具 → 批量调色」扫描、选择组并读取原图，添加最多 40 张 SKU 参考图。分析后可预览，也可在参考图上重框取色。写入后，每个 SKU 都是目标组内一组可编辑的原生调整层。
- **成片质检**。按白底商品图检查当前文档的尺寸、背景、主体越界、边缘、曝光和清晰度。

两项功能均在本地运行，支持 1200 万像素以内的 Photoshop 文档。网页使用相同的精修界面，读取和写入文档由 Photoshop 面板完成。调色算法、原生图层配方及质检规则参考 [Life-ai 商业精修](https://github.com/xiaoche0907/Life-ai/tree/005d77b)。

## 插件与更新

在顶部打开独立的「设置」板块，进入「插件与更新」。「检测更新」会比较当前版本和 GitHub 的最新稳定版。「安装插件」下载最新的 Windows 安装包，「重新安装插件」下载当前版本的安装包。下载后运行 EXE，按 Windows 提示完成安装，再重启 Photoshop。

发布时同步更新 `plugin/manifest.json`、`package.json` 和锁文件的版本。构建后在目标仓库发布同版本的正式 Release，使用 `vX.Y.Z` 标签，附上 `WfArtAssistant-X.Y.Z-Installer.exe`。在 GitHub 标记为最新稳定版后，用户即可在插件内查到更新。历史版本的 EXE 可用于重装。[目标仓库的 Releases](https://github.com/xiaoche097/WF-Art-Designer/releases)

## 衣物美化 P0 / P1

在 Photoshop 打开 8 位 sRGB 文档，进入「精修工具 → 衣物美化」。可以先建立 Photoshop 选区或选择已有像素蒙版，读取后直接使用蒙版。使用 SAM 时，在 PowerShell 运行下列命令。首次需要 `uv` 和 Python 3.12，并下载运行时及官方权重。安装版的同一脚本位于 Photoshop 插件目录下的 `cloth-engine/start.ps1`：

```powershell
& .\local-engine\start.ps1
```

将终端显示的配对码填入面板。点衣物加正点，点手或背景加负点，再运行分割。预览可以叠色、用画笔修改、撤销和重做，或在图上点选位置查看 100% 原始像素。写入会创建一个默认隐藏的像素图层和可编辑蒙版，原有图层保持原样。若原稿有半透明区域，可单独显示分割副本检查 Alpha，避免与原合成图重叠显示。

P1 的模型同屏预览最大边为 640 像素，写入按原尺寸恢复。已导入的 Photoshop 选区和像素蒙版在原尺寸约束写入。项目使用官方 SAM 2.1 Tiny，仅做衣物分割及蒙版工作流。实现和验证范围见 [衣物美化验收记录](docs/cloth-retouch-acceptance.md)。
