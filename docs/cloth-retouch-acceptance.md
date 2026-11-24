# 衣物美化 P0 / P1 验收记录

版本 v2.3.2，Windows，2026-11-24。

## 仓库审计

- WF 的 React 网页和 Photoshop 面板共用界面，宿主通过 UXP 消息处理器访问 Photoshop。衣物工具使用该桥接，SAM 只接收来自宿主的本机请求。
- PRD §6 中的 `wrinkle.html` 和 `wrinkle.host.js` 位于 Life-ai 参考仓库。核实了前者引用缺失的 `pShadow`，后者在写回时把 Alpha 固定成 255。WF 不包含这条旧功能路径，本次改动落在 WF 的新桥接。Life-ai 工作树未被更改。
- WF 现有 RunningHub、织影、Comfy UI、批量调色、成片质检继续使用原入口。插件维护卡放在顶层「设置」，平台自己的配置入口继续保留。

## P0 验收

| 项目 | 结果与证据 |
| --- | --- |
| Alpha 与蒙版外字节 | Node 单测通过。包含 Alpha 0、117、250、255，验证透明像素的隐含 RGB、蒙版外 RGBA 和内部 Alpha 按字节保留。 |
| 原尺寸与坐标 | 模拟 UXP 测试通过。8 × 8 捕获范围位于文档偏移 (3, 5)，16 个像素的图层蒙版与 Photoshop 选区取交集，写回时偏移保持 (3, 5)。 |
| 写回隔离 | 模拟 UXP 测试通过。图层与蒙版独立创建，结果默认隐藏。蒙版写失败时取消事务，成功时提交一个历史步骤。历史状态变化和重复提交被拒绝。 |
| 位深与色彩 | 接受 8 位 sRGB，其他类型会提示先转换文档副本。16 位及其他配置的无损往返待验收。 |

## P1 验收

| 项目 | 结果与证据 |
| --- | --- |
| 本地 SAM 2.1 Tiny | 真实 CPU 推理通过。Intel i7-11800H，Python 3.12.14，PyTorch 2.7.1+cpu。256 × 256 合成上衣，权重加载 12.70 秒，正点首次 HTTP 推理 2.13 秒，复用同图特征后的正负点推理 0.15 秒。通过点内、点外及软边断言。错误配对码返回 HTTP 401。 |
| 画笔与预览 | Chromium 模拟 UXP 测试通过。覆盖独立设置、PS 蒙版导入、画笔、撤销及重做、正负点、叠色预览、100% 原像素查看和写回请求。测试宽度 320、350、768 px。 |
| 蒙版边缘 | SAM 输出使用向内羽化。P1 推理和画笔工作图的长边上限为 640 px，写回按原尺寸映射并应用原尺寸 Photoshop 约束。只有直接使用 Photoshop 蒙版且未编辑时，才逐像素使用原蒙版结果。 |
| 工具回归与构建 | 模拟 UXP 批量调色回归通过，覆盖两张 SKU 自动分析、预览、调整层配方和质检结果。网页、插件、EXE 均构建成功。实际联网生图本次未提交。 |
| 真实 Photoshop 验收 | 待安装 v2.3.2 后，按以下步骤核对 Adobe 宿主的实际结果。此次验证包含真实模型、本机 HTTP 和模拟 UXP 三个环节。 |

合成上衣指标只用于复现单次功能测试。真实服装 IoU、商业自然度、GPU、2K/3K/4K 延迟分位未统计。可选 Grounding DINO、P2 去褶与 P3 训练未纳入此次实现。官方权重由启动脚本下载，按固定 SHA-256 校验。[Meta SAM 2 模型和许可](https://github.com/facebookresearch/sam2#license)

[350 px 模拟 UXP 面板截图](assets/cloth-p1-panel.png)

## 复现

```powershell
node --test scripts/cloth-host.test.cjs
npm run build:web
npm run build:prod
$engine = Join-Path $env:LOCALAPPDATA 'WF-Art-Designer/cloth-engine'
$env:PYTHONDONTWRITEBYTECODE = '1'
& "$engine/venv/Scripts/python.exe" scripts/cloth-sam-smoke.py "$engine/sam2.1_hiera_tiny.pt"
```

真实 Photoshop 验收用独立的 8 位 sRGB 测试文档，包含透明像素、半透明衣物边缘及与衣物交叉的软选区。安装包完成后重启 Photoshop，先在断开本地服务的情况下用 PS 蒙版写出分割副本，再启服务用正负点复测。检查背景、Alpha、图层坐标、原层和选区。确认只新增隐藏的结果层及其像素蒙版，且一步撤销可清除。最后读取原图后切换文档或执行一个历史操作，验证写回被阻止。[Adobe Photoshop Imaging API](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging)
