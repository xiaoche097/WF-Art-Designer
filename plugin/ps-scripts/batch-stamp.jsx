#target photoshop

(function () {
    if (!app.documents.length) {
        alert("请先打开一个文档！");
        return;
    }

    var selectedIds = uniqueArray(getSelectedIds());
    if (!selectedIds.length) {
        alert("当前没有选中任何图层或组。");
        return;
    }

    // 1. 先筛选出所有图层组 ID，并过滤掉被包含在已选组内部的“子组”
    var allGroupIds = uniqueArray(filterGroupIds(selectedIds));
    var groupIds = filterTopMostSelectedGroups(allGroupIds);

    if (!groupIds.length) {
        alert("当前共选中了 " + selectedIds.length + " 项，但未识别到【图层组】。");
        return;
    }

    // 读取最外层组名方便确认
    var groupNames = [];
    for (var n = 0; n < groupIds.length; n++) {
        groupNames.push(getLayerNameById(groupIds[n]));
    }

    var previewNames = groupNames.slice(0, 10).join("、");
    if (groupNames.length > 10) {
        previewNames += " 等共 " + groupNames.length + " 个";
    }

    if (!confirm("检测到 " + groupIds.length + " 个图层组：\n【" + previewNames + "】\n\n将逐个盖印、标红并统一移至最上方，是否确认执行？")) {
        return;
    }

    // 2. 先把所有选中的外层组隐藏，防止多组同时显示导致盖印串色
    var groupObjs = [];
    for (var i = 0; i < groupIds.length; i++) {
        selectLayerById(groupIds[i]);
        var g = app.activeDocument.activeLayer;
        groupObjs.push(g);
        g.visible = false;
    }

    var doneCount = 0;
    var stampedLayers = [];
    var doc = app.activeDocument;

    // 3. 逐个显示并盖印
    for (var j = 0; j < groupObjs.length; j++) {
        var grp = groupObjs[j];
        try {
            grp.visible = true;
            selectLayerById(grp.id);

            executeMergeVisible();
            var mergedLayer = doc.activeLayer;
            mergedLayer.name = grp.name;
            mergedLayer.visible = false;

            setLayerColor(mergedLayer, "red");
            stampedLayers.push(mergedLayer);

            grp.visible = false;
            doneCount++;
        } catch (e) {
            alert("处理第 " + (j + 1) + " 个组【" + grp.name + "】时出错：\n" + e.message);
            break;
        }
    }

    // 4. 将所有盖印出来的图层统一移动到文档最上方（保持从上到下的对应顺序）
    for (var m = stampedLayers.length - 1; m >= 0; m--) {
        try {
            stampedLayers[m].move(doc, ElementPlacement.PLACEATBEGINNING);
        } catch (e) {}
    }

    alert("完成！已盖印并标红移至最上方 " + doneCount + " / " + groupObjs.length + " 个组。");

    // 过滤嵌套子组：只要某个组的祖先级也在选中列表里，就剔除它
    function filterTopMostSelectedGroups(ids) {
        var idSet = {};
        for (var i = 0; i < ids.length; i++) {
            idSet[String(ids[i])] = true;
        }

        var topGroups = [];
        for (var j = 0; j < ids.length; j++) {
            selectLayerById(ids[j]);
            var curr = app.activeDocument.activeLayer.parent;
            var hasSelectedAncestor = false;

            while (curr && curr.typename === "LayerSet") {
                if (idSet[String(curr.id)]) {
                    hasSelectedAncestor = true;
                    break;
                }
                curr = curr.parent;
            }

            if (!hasSelectedAncestor) {
                topGroups.push(ids[j]);
            }
        }
        return topGroups;
    }

    function uniqueArray(arr) {
        var seen = {};
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var key = String(arr[i]);
            if (!seen[key]) {
                seen[key] = true;
                out.push(arr[i]);
            }
        }
        return out;
    }

    function getLayerNameById(id) {
        try {
            var ref = new ActionReference();
            ref.putIdentifier(charIDToTypeID("Lyr "), id);
            var desc = executeActionGet(ref);
            if (desc.hasKey(stringIDToTypeID("name"))) {
                return desc.getString(stringIDToTypeID("name"));
            }
        } catch (e) {}
        return "ID:" + id;
    }

    function setLayerColor(layer, colorName) {
        var colorMap = {
            "none": "none",
            "red": "red",
            "orange": "orange",
            "yellow": "yellowColor",
            "green": "green",
            "blue": "blue",
            "violet": "violet",
            "gray": "gray"
        };
        var val = colorMap[colorName] || "red";

        doc.activeLayer = layer;
        var desc = new ActionDescriptor();
        var ref = new ActionReference();
        ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        desc.putReference(charIDToTypeID("null"), ref);

        var colorDesc = new ActionDescriptor();
        colorDesc.putEnumerated(charIDToTypeID("Clr "), charIDToTypeID("Clr "), stringIDToTypeID(val));
        desc.putObject(charIDToTypeID("T   "), charIDToTypeID("Lyr "), colorDesc);
        executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
    }

    function executeMergeVisible() {
        var desc = new ActionDescriptor();
        desc.putBoolean(charIDToTypeID("Dplc"), true);
        executeAction(stringIDToTypeID("mergeVisible"), desc, DialogModes.NO);
    }

    function getSelectedIds() {
        var res = [];
        var ref = new ActionReference();
        ref.putEnumerated(charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        var desc = executeActionGet(ref);

        if (desc.hasKey(stringIDToTypeID("targetLayersIDs"))) {
            var idList = desc.getList(stringIDToTypeID("targetLayersIDs"));
            for (var i = 0; i < idList.count; i++) {
                res.push(idList.getReference(i).getIdentifier());
            }
        } else if (app.activeDocument.activeLayer) {
            res.push(app.activeDocument.activeLayer.id);
        }
        return res;
    }

    function filterGroupIds(ids) {
        var groups = [];
        for (var i = 0; i < ids.length; i++) {
            try {
                var ref = new ActionReference();
                ref.putIdentifier(charIDToTypeID("Lyr "), ids[i]);
                var desc = executeActionGet(ref);
                if (desc.hasKey(stringIDToTypeID("layerSection"))) {
                    var sec = typeIDToStringID(desc.getEnumerationValue(stringIDToTypeID("layerSection")));
                    if (sec === "layerSectionStart") {
                        groups.push(ids[i]);
                    }
                }
            } catch (e) {}
        }
        return groups;
    }

    function selectLayerById(id) {
        var desc = new ActionDescriptor();
        var ref = new ActionReference();
        ref.putIdentifier(charIDToTypeID("Lyr "), id);
        desc.putReference(charIDToTypeID("null"), ref);
        desc.putBoolean(charIDToTypeID("MkVs"), false);
        executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
    }
})();