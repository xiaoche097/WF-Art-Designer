#target photoshop

function batchRenameFromList() {
    if (!app.documents.length) {
        alert("请先打开一个 PSD 文档！");
        return;
    }
    var doc = app.activeDocument;

    // 1. 仅获取最外层选中的【图层组】（剔除选中组内部嵌套的子群组，按面板从上到下排序）
    var selectedGroups = getTopLevelSelectedGroupsTopToBottom(doc);
    if (selectedGroups.length === 0) {
        alert("请先在图层面板中选中需要重命名的【图层组】（群组）！");
        return;
    }

    // 2. 构建 ScriptUI 界面
    var win = new Window("dialog", "批量按列表重命名群组（从上往下）");
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 10;
    win.margins = 16;

    win.add("statictext", undefined, "当前已在图层面板选中：" + selectedGroups.length + " 个最外层群组（不含组内子群组，按从上往下匹配）");

    // 分隔符设置区
    var sepGroup = win.add("group");
    sepGroup.orientation = "row";
    sepGroup.alignChildren = ["left", "center"];
    sepGroup.add("statictext", undefined, "分隔方式：");
    var rbNewline = sepGroup.add("radiobutton", undefined, "按换行分隔（每行一个）");
    var rbComma   = sepGroup.add("radiobutton", undefined, "按逗号分隔（，或 ,）");
    var rbCustom  = sepGroup.add("radiobutton", undefined, "自定义：");
    var customSepInput = sepGroup.add("edittext", undefined, "|");
    customSepInput.characters = 4;
    customSepInput.enabled = false;
    rbNewline.value = true;

    rbNewline.onClick = function () { customSepInput.enabled = false; updateCount(); };
    rbComma.onClick   = function () { customSepInput.enabled = false; updateCount(); };
    rbCustom.onClick  = function () { customSepInput.enabled = true; customSepInput.active = true; updateCount(); };
    customSepInput.onChanging = updateCount;

    // 多行粘贴框
    win.add("statictext", undefined, "请在下方粘贴命名列表：");
    var listInput = win.add("edittext", undefined, "", { multiline: true, scrolling: true });
    listInput.preferredSize = [480, 260];
    listInput.active = true;

    // 实时行数统计 & 导出安全选项
    var optGroup = win.add("group");
    optGroup.orientation = "row";
    optGroup.alignChildren = ["left", "center"];
    var statusLabel = optGroup.add("statictext", undefined, "已识别名称：0 条（选中 " + selectedGroups.length + " 个群组）");
    statusLabel.characters = 34;

    var cbFixColon = optGroup.add("checkbox", undefined, "自动将英文冒号 : 转为全角 ：（防导出文件报错）");
    cbFixColon.value = true;

    // 解析输入列表的辅助函数
    function parseNames(rawText) {
        if (!rawText) return [];
        var parts = [];
        if (rbNewline.value) {
            parts = rawText.split(/\r\n|\r|\n/);
        } else if (rbComma.value) {
            parts = rawText.split(/[,，]+/);
        } else {
            var sep = customSepInput.text;
            parts = sep ? rawText.split(sep) : [rawText];
        }
        var result = [];
        for (var i = 0; i < parts.length; i++) {
            var trimmed = parts[i].replace(/^\s+|\s+$/g, "");
            if (trimmed !== "") {
                result.push(trimmed);
            }
        }
        return result;
    }

    function updateCount() {
        var names = parseNames(listInput.text);
        statusLabel.text = "已识别名称：" + names.length + " 条（选中 " + selectedGroups.length + " 个群组）";
    }
    listInput.onChanging = updateCount;

    // 底部按钮
    var btnGroup = win.add("group");
    btnGroup.orientation = "row";
    btnGroup.alignment = ["right", "bottom"];
    btnGroup.add("button", undefined, "取消", { name: "cancel" });
    var okBtn = btnGroup.add("button", undefined, "开始重命名", { name: "ok" });

    if (win.show() !== 1) return;

    var finalNames = parseNames(listInput.text);
    if (finalNames.length === 0) {
        alert("未检测到有效名称，已取消操作。");
        return;
    }

    var usedCount = Math.min(selectedGroups.length, finalNames.length);

    // 数量不一致时二次确认，明确提示实际会使用多少个
    if (finalNames.length !== selectedGroups.length) {
        var diffMsg = "数量不一致：\n" +
                      "• 已选中最外层群组：" + selectedGroups.length + " 个\n" +
                      "• 列表名称数量：" + finalNames.length + " 条\n\n" +
                      "将按从上到下顺序使用前 " + usedCount + " 个名称进行重命名，是否继续？";
        if (!confirm(diffMsg)) return;
    }

    // 3. 底层 ActionManager 高速执行重命名（仅针对最外层群组）
    function executeBatchRename() {
        var c2t = charIDToTypeID;
        var fixColon = cbFixColon.value;

        for (var i = 0; i < usedCount; i++) {
            var newName = finalNames[i];
            if (fixColon) {
                newName = newName.replace(/:/g, "：");
            }

            var setDesc = new ActionDescriptor();
            var setRef = new ActionReference();
            setRef.putIdentifier(c2t("Lyr "), selectedGroups[i].id);
            setDesc.putReference(c2t("null"), setRef);

            var nameDesc = new ActionDescriptor();
            nameDesc.putString(c2t("Nm  "), newName);
            setDesc.putObject(c2t("T   "), c2t("Lyr "), nameDesc);

            executeAction(c2t("setd"), setDesc, DialogModes.NO);
        }
    }

    doc.suspendHistory("批量按列表重命名群组 (" + usedCount + "个)", "executeBatchRename()");

    // 完成提示：明确告诉用户实际使用了多少个
    var doneMsg = "重命名完成！本次共使用了 " + usedCount + " 个名称（已重命名 " + usedCount + " 个群组）。";
    if (finalNames.length > usedCount) {
        doneMsg += "\n列表多余 " + (finalNames.length - usedCount) + " 条未用。";
    } else if (selectedGroups.length > usedCount) {
        doneMsg += "\n还有 " + (selectedGroups.length - usedCount) + " 个选中群组未匹配到名称，保持原名。";
    }
    alert(doneMsg);
}

// 查找某个群组（startIndex）对应的闭合标记（layerSectionEnd）的 itemIndex
function findGroupEndIndex(startIndex) {
    var s2t = stringIDToTypeID;
    var c2t = charIDToTypeID;
    var depth = 0;

    // 图层栈从上往下是 itemIndex 递减，组闭合标记在下方（更小的 index）
    for (var idx = startIndex - 1; idx >= 1; idx--) {
        try {
            var ref = new ActionReference();
            ref.putIndex(c2t("Lyr "), idx);
            var desc = executeActionGet(ref);
            var sec = typeIDToStringID(desc.getEnumerationValue(s2t("layerSection")));
            if (sec === "layerSectionStart") {
                depth++;
            } else if (sec === "layerSectionEnd") {
                if (depth === 0) {
                    return idx;
                }
                depth--;
            }
        } catch (e) {
            break;
        }
    }
    return 0;
}

// 仅获取选中的【最外层图层组】（排除被其他选中组包在里面的子群组）并按从上到下排序
function getTopLevelSelectedGroupsTopToBottom(doc) {
    var s2t = stringIDToTypeID;
    var c2t = charIDToTypeID;
    var ref = new ActionReference();
    ref.putEnumerated(c2t("Dcmn"), c2t("Ordn"), c2t("Trgt"));
    var docDesc = executeActionGet(ref);

    var targetIDs = [];
    if (docDesc.hasKey(s2t("targetLayersIDs"))) {
        var idList = docDesc.getList(s2t("targetLayersIDs"));
        for (var i = 0; i < idList.count; i++) {
            targetIDs.push(idList.getReference(i).getIdentifier());
        }
    } else if (docDesc.hasKey(s2t("targetLayers"))) {
        var idxList = docDesc.getList(s2t("targetLayers"));
        var hasBg = false;
        try { hasBg = doc.backgroundLayer != null; } catch (e) {}
        for (var j = 0; j < idxList.count; j++) {
            var r = new ActionReference();
            r.putIndex(c2t("Lyr "), idxList.getReference(j).getIndex() + (hasBg ? 0 : 1));
            targetIDs.push(executeActionGet(r).getInteger(s2t("layerID")));
        }
    } else {
        var rSingle = new ActionReference();
        rSingle.putEnumerated(c2t("Lyr "), c2t("Ordn"), c2t("Trgt"));
        targetIDs.push(executeActionGet(rSingle).getInteger(s2t("layerID")));
    }

    var rawGroups = [];
    var seenIds = {};
    for (var k = 0; k < targetIDs.length; k++) {
        var id = targetIDs[k];
        if (seenIds[id]) continue;
        seenIds[id] = true;

        var lyrRef = new ActionReference();
        lyrRef.putIdentifier(c2t("Lyr "), id);
        var lyrDesc = executeActionGet(lyrRef);
        var sectionType = typeIDToStringID(lyrDesc.getEnumerationValue(s2t("layerSection")));
        if (sectionType !== "layerSectionStart") continue;

        var startIdx = lyrDesc.getInteger(s2t("itemIndex"));
        var endIdx = findGroupEndIndex(startIdx);

        rawGroups.push({
            id: id,
            startIndex: startIdx,
            endIndex: endIdx
        });
    }

    // 过滤掉嵌套在另一个选中群组内部的“子群组”
    var topGroups = [];
    for (var a = 0; a < rawGroups.length; a++) {
        var cur = rawGroups[a];
        var isNestedInsideSelected = false;
        for (var b = 0; b < rawGroups.length; b++) {
            if (a === b) continue;
            var parentCand = rawGroups[b];
            // 如果 parentCand 的范围严格包住 cur（startIndex 更大，endIndex 更小）
            if (parentCand.startIndex > cur.startIndex && cur.startIndex > parentCand.endIndex) {
                isNestedInsideSelected = true;
                break;
            }
        }
        if (!isNestedInsideSelected) {
            topGroups.push(cur);
        }
    }

    // startIndex 从大到小排序 = 图层面板从上到下
    topGroups.sort(function (x, y) {
        return y.startIndex - x.startIndex;
    });

    return topGroups;
}

batchRenameFromList();