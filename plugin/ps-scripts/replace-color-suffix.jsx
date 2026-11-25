#target photoshop

function fastBatchRenameSuffix() {
    if (!app.documents.length) return;
    var doc = app.activeDocument;

    // 1. 双模式弹窗
    var win = new Window("dialog", "极速修改组后缀");
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 12;
    win.margins = 16;

    // 模式选择
    var modeGroup = win.add("panel", undefined, "处理模式");
    modeGroup.orientation = "column";
    modeGroup.alignChildren = ["left", "top"];
    modeGroup.margins = [12, 16, 12, 10];
    var rbReplace = modeGroup.add("radiobutton", undefined, "替换末尾后缀（如 -1 改为 -2）");
    var rbAppend  = modeGroup.add("radiobutton", undefined, "直接追加后缀（如 -RL-20-81 改为 -RL-20-81-1）");
    rbReplace.value = true;

    // 数字输入
    var row = win.add("group");
    row.add("statictext", undefined, "目标后缀数字：");
    var input = row.add("edittext", undefined, "2");
    input.characters = 8;
    input.active = true;

    // 切换模式时自动调整默认数字，方便直接回车
    rbAppend.onClick = function () { input.text = "1"; input.active = true; };
    rbReplace.onClick = function () { input.text = "2"; input.active = true; };

    var btns = win.add("group");
    btns.alignment = ["right", "bottom"];
    btns.add("button", undefined, "取消", { name: "cancel" });
    btns.add("button", undefined, "确定", { name: "ok" });

    if (win.show() !== 1) return;

    var targetNum = input.text.replace(/^\s+|\s+$/g, "").replace(/^-+/, "");
    if (!targetNum) return;

    var isAppendMode = rbAppend.value;

    // 2. 底层高速执行
    function runFastRename() {
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

        for (var k = 0; k < targetIDs.length; k++) {
            var id = targetIDs[k];
            var lyrRef = new ActionReference();
            lyrRef.putIdentifier(c2t("Lyr "), id);
            var lyrDesc = executeActionGet(lyrRef);

            // 仅处理图层组
            var sectionType = typeIDToStringID(lyrDesc.getEnumerationValue(s2t("layerSection")));
            if (sectionType !== "layerSectionStart") continue;

            var oldName = lyrDesc.getString(c2t("Nm  "));
            var newName = null;

            if (isAppendMode) {
                // 追加模式：去掉末尾可能存在的空格后，直接拼上 "-1"（或你输入的数字）
                newName = oldName.replace(/\s+$/, "") + "-" + targetNum;
            } else {
                // 替换模式：仅替换末尾的 "-数字"
                if (/-\d+\s*$/.test(oldName)) {
                    newName = oldName.replace(/-\d+\s*$/, "-" + targetNum);
                }
            }

            if (newName !== null && newName !== oldName) {
                var setDesc = new ActionDescriptor();
                var setRef = new ActionReference();
                setRef.putIdentifier(c2t("Lyr "), id);
                setDesc.putReference(c2t("null"), setRef);

                var nameDesc = new ActionDescriptor();
                nameDesc.putString(c2t("Nm  "), newName);
                setDesc.putObject(c2t("T   "), c2t("Lyr "), nameDesc);

                executeAction(c2t("setd"), setDesc, DialogModes.NO);
            }
        }
    }

    doc.suspendHistory((isAppendMode ? "追加组后缀 -" : "修改组后缀 -") + targetNum, "runFastRename()");
}

fastBatchRenameSuffix();