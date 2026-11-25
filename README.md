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

安装完成页可以打开 **WF 美工助手启动器**，之后也能从 Windows 开始菜单找到。启动器显示插件版本、Adobe UXP 登记状态和 Photoshop 是否运行。打开插件面板后，启动器会显示它在本次 Photoshop 会话中的启动记录。

## 功能

| 板块 | 主要用途 |
| --- | --- |
| RunningHub | 提交工作流任务，把结果回传 Photoshop。 |
| 织影 | 配置自己的 API 地址和密钥，拉取并选择模型。支持 Gemini 和 OpenAI Images 兼容接口。 |
| Comfy UI | 连接自己的 ComfyUI，选择并运行工作流。 |
| 精修工具 | 批量调色、白底成片质检、衣物分割与蒙版编辑。 |
| 设置 | 检查 GitHub 最新稳定版，下载更新或当前版本安装包。 |

织影拉取模型时只显示可识别的图像生成和编辑模型。供应商使用无法识别的别名时，可手动填写图像模型 ID。选好模型后，可在「参数设置」里选择该模型的分辨率和比例。供应商返回的选项优先，标准模型可使用其公开规格。未提供可用选项时使用供应商默认值。

### 批量调色

在 Photoshop 给服装图层组添加像素蒙版，组的混合模式保持「穿透」。在 **精修工具 → 批量调色** 读取蒙版组，加入最多 40 张 SKU 参考图。可自动取色、手动框选修正和逐款预览。写入后，每个 SKU 都有一组可编辑的 Photoshop 原生调整层。

### 成片质检

在 **精修工具 → 成片质检** 检查白底商品图的尺寸、背景、主体越界、边缘溢色、曝光和清晰度。批量调色与质检均在本地运行，支持 1200 万像素以内的文档。相关算法参考 [Life-ai 商业精修](https://github.com/xiaoche0907/Life-ai/tree/005d77b)。

### 衣物美化

在 **精修工具 → 衣物美化** 导入图片或读取当前 Photoshop 文档。本地模型识别上装、裤子、裙子和连衣裙。可调整上装、下装、细褶和粗褶，也可在大图预览中核对识别区域。Photoshop 选区、图层蒙版和画笔都会受衣物识别范围约束，识别边缘向内收缩后才允许写入。结果写入独立可见图层，处理范围之外的结果像素保持透明。

「局部修复 · AI」提供去毛球与灰尘、去汗渍、衣缘修整、衣物精修、裙子蓬松、裙摆平整及独立鞋面去污。需要在织影账户管理中配置图片编辑模型，并确认发送。只发送授权区域内的像素。生成后可比较原图、调节效果强度，再写入新图层。衣缘和裙摆的修饰限于原轮廓内。

平铺衣物或边缘识别不完整时，可以在「高级 · 蒙版」中使用 Photoshop 选区、图层蒙版或画笔。常见非 sRGB 和 16 位文档会自动准备 8 位 sRGB 工作副本，原文档保留原格式。美化主要减弱可见的褶皱明暗，适合适度修饰。通过源码构建时，首次构建会下载并校验随包附带的识别模型。[衣物美化验收记录](docs/cloth-retouch-acceptance.md)

## 提示词库与 Skills Wiki

「提示词库」位于 Comfy UI 旁边。任务与风格按分类浏览，搜索可查当前库的全部分类。收录整套换装、仅换上装或下装、图 1 印花迁移到图 2、风格复刻及场景复刻。点「使用」会打开织影，并把所选内容追加到提示词框。

场景复刻模板使用 5S，从主体、风格、镜头与构图、场景环境、光照与影调读取参考，并明确两张参考图各自的作用。[5S 提示法公开教程](https://www.bilibili.com/video/BV112pg6cEeP/)

推荐先选任务提示词，再按需叠加一项风格。使用参考图做局部编辑时，写清目标和保留内容，例如只换商品颜色，同时保留轮廓、材质与标识。适合复用的版本可在库内保存。

## 创意中心

在「工具库」右侧进入「创意中心」。

- **套图**。按项目保存商品事实、参考图和分镜稿。使用内置方案或从最多八张参考图反推新方案，逐张编辑与生成。审核通过的成片可导出 ZIP，随包附有分镜顺序、生成提示词与审核记录。
- **花型**。从商品图提取印花，按主题起稿、用 AI 改色或生成衍生款。「本地改色」可从图中取色，按颜色范围替换并即时对比。图案可以继续验缝、导出 300 DPI 平铺 PNG，或根据图案和已知事实生成跨境 Listing。
- **模特**。用导入或库存的模特参考图生成不同机位的定妆照。
- **素材库**。分类保存商品、套图、花型和模特图片，用作参考或置入 Photoshop 独立图层。

生成使用织影当前配置的图像模型。套图反推需要单独填写同一供应商支持的视觉理解模型 ID。流程参考 [EcomGen](https://github.com/linbei0/EcomGen/tree/894e7fb62d50eb8f1f79959cadba97bb791bdc03)，验缝算法的许可证随包提供。

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
