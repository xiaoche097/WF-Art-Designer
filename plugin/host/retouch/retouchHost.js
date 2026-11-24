// 批量改色专用桥接。只读取用户文档；结果追加到明确指定的蒙版组。
const { app, action, core, imaging, constants } = require('photoshop');
const native = require('./recolorNative');
const qualityCheck = require('./qualityCheckCore');

function documentById(id) {
  const doc = id ? Array.from(app.documents).find(d => d.id === id) : app.activeDocument;
  if (!doc) throw Error('源文档已关闭，请重新读取PS文档');
  return doc;
}
function findGroup(layers, id) {
  for (const layer of layers) {
    if (layer.id === id && layer.kind === constants.LayerKind.GROUP) return layer;
    if (layer.layers) { const found = findGroup(layer.layers, id); if (found) return found; }
  }
  return null;
}
async function descriptor(layerId, docId) {
  return play({ _obj: 'get', _target: [{ _ref: 'layer', _id: layerId }, { _ref: 'document', _id: docId }] });
}
async function play(command) {
  const [result] = await action.batchPlay([command], {});
  if (!result || result._obj === 'error') throw Error(result?.message || 'Photoshop 图层操作失败');
  return result;
}
async function targetGroup(doc, id) {
  const group = findGroup(doc.layers, id);
  if (!group) throw Error('目标蒙版组已被删除或不是图层组，请重新读取');
  const info = await descriptor(id, doc.id);
  if (!info.hasUserMask || info.userMaskEnabled === false) throw Error('目标组没有启用的像素蒙版');
  if (info.hasVectorMask) throw Error('目标组同时有矢量蒙版，当前版本不支持自动合成，请改用仅带像素蒙版的组');
  return group;
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(bytes) {
  const chunks = [];
  for (let start = 0; start < bytes.length; start += 12288) {
    let out = '';
    for (let i = start; i < Math.min(start + 12288, bytes.length); i += 3) {
      const value = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += alphabet[(value >>> 18) & 63] + alphabet[(value >>> 12) & 63] + (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=') + (i + 2 < bytes.length ? alphabet[value & 63] : '=');
    }
    chunks.push(out);
  }
  return chunks.join('');
}
async function inspect() {
  const doc = documentById();
  const groups = [];
  async function walk(layers, parent) {
    for (const layer of layers) {
      if (layer.kind !== constants.LayerKind.GROUP) continue;
      const name = parent ? parent + ' / ' + layer.name : layer.name;
      const info = await descriptor(layer.id, doc.id);
      if (info.hasUserMask) groups.push({ id: layer.id, name: layer.name, path: name, enabled: info.userMaskEnabled !== false && !info.hasVectorMask });
      await walk(layer.layers || [], name);
    }
  }
  await walk(doc.layers, '');
  return { ok: true, docId: doc.id, name: doc.title || doc.name || 'PS文档', width: Number(doc.width), height: Number(doc.height), groups };
}

async function read(params) {
  validateTarget(params);
  return core.executeAsModal(() => readInsideModal(params), { commandName: 'WF美工助手：读取文档与组蒙版' });
}

function validateTarget(params) {
  if (!Number.isSafeInteger(params?.docId) || params.docId <= 0 ||
      !Number.isSafeInteger(params.layerId) || params.layerId <= 0) {
    throw Error('请重新读取文档并选择目标蒙版组');
  }
}

function sampleImage(image, raw, maxEdge, channels, convert) {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const row = Math.floor((y + .5) * image.height / height) * image.width;
    for (let x = 0; x < width; x++) {
      const source = (row + Math.floor((x + .5) * image.width / width)) * image.components;
      convert(raw, source, data, (y * width + x) * channels);
    }
  }
  return { width, height, data };
}

function rgbaSample(image, raw, maxEdge) {
  return sampleImage(image, raw, maxEdge, 4, (bytes, source, out, target) => {
    out[target] = bytes[source];
    out[target + 1] = bytes[source + 1];
    out[target + 2] = bytes[source + 2];
    out[target + 3] = image.components === 4 ? bytes[source + 3] : 255;
  });
}

function documentBounds(doc) {
  const right = Number(doc.width), bottom = Number(doc.height);
  if (right * bottom > 12000000) throw Error('当前精修工具支持 1200 万像素以内的文档，请在较小的文档副本中处理');
  return { left: 0, top: 0, right, bottom };
}

function readComposite(doc, bounds) {
  return imaging.getPixels({ documentID: doc.id, sourceBounds: bounds, componentSize: 8, colorSpace: 'RGB', colorProfile: 'sRGB IEC61966-2.1', applyAlpha: false });
}

async function readInsideModal(params) {
  const doc = documentById(params.docId);
  const layer = await targetGroup(doc, params.layerId);
  if (typeof imaging.getLayerMask !== 'function') throw Error('此 Photoshop 版本不支持读取图层蒙版');
  const full = documentBounds(doc);
  let pixels, mask;
  try {
    // Read at pyramid level zero so mask and composite bounds have matching document coordinates.
    pixels = await readComposite(doc, full);
    mask = await imaging.getLayerMask({ documentID: doc.id, layerID: layer.id, kind: 'user', sourceBounds: full });
    const bounds = pixels.sourceBounds || full;
    const mb = mask.sourceBounds || full;
    const mi = mask.imageData, pi = pixels.imageData;
    const rgba = rgbaSample(pi, await pi.getData({ chunky: true }), 640);
    const max = mi.componentSize === 16 ? 65535 : mi.componentSize === 32 ? 1 : 255;
    const weights = sampleImage(mi, await mi.getData({ chunky: true, fullRange: true }), 640, 1, (bytes, source, out, target) => {
      out[target] = Math.round(Math.max(0, Math.min(1, bytes[source] / max)) * 255);
    });
    if (!weights.data.some(Boolean)) throw Error('目标蒙版没有足够的可用像素，请检查蒙版范围');
    return {
      docId: doc.id, layerId: layer.id, width: rgba.width, height: rgba.height, rgbaB64: toBase64(rgba.data),
      selection: bounds,
      bounds: { x: mb.left, y: mb.top, width: mb.right - mb.left, height: mb.bottom - mb.top },
      maskWidth: weights.width, maskHeight: weights.height, weightB64: toBase64(weights.data),
    };
  } finally {
    if (pixels) pixels.imageData.dispose();
    if (mask) mask.imageData.dispose();
  }
}


async function place(params) {
  validateTarget(params);
  const doc = documentById(params.docId);
  const items = params.items || [];
  if (!Array.isArray(items) || !items.length || items.length > 40) throw Error('SKU数量必须在1到40之间');
  for (const item of items) {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 160) throw Error('SKU名称无效');
    native.validate(item.recipe);
  }
  const results = [];
  let targetName = '';
  await core.executeAsModal(async executionContext => {
    const target = await targetGroup(doc, params.layerId);
    targetName = target.name;
    const targetInfo = await descriptor(target.id, doc.id);
    const blend = targetInfo.mode && targetInfo.mode._value;
    if (blend && blend !== 'passThrough') throw Error('目标蒙版组必须为「穿透」混合模式，才能调整组下方的原始图层；请在PS修改后重试');
    if (app.activeDocument?.id !== doc.id) throw Error('请切回读取时的 Photoshop 文档再写入');
    documentBounds(doc);
    const history = await executionContext.hostControl.suspendHistory({ documentID: doc.id, name: 'WF美工助手：批量创建原生调色组' });
    let success = false, savedSelection = null;
    try {
      if (doc.selection.bounds) {
        savedSelection = await imaging.getSelection({ documentID: doc.id });
        if (!savedSelection?.imageData) throw Error('无法保留当前选区，请取消选区后重试');
        await doc.selection.deselect();
      }
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const group = await doc.createLayerGroup({ name: item.name });
        group.visible = false;
        await group.move(target, constants.ElementPlacement.PLACEINSIDE);
        await play({ _obj: 'set', _target: [{ _ref: 'layer', _id: group.id }], to: { _obj: 'layer', mode: { _enum: 'blendMode', _value: 'passThrough' } } });
        const layerIds = [];
        for (const layer of item.recipe.layers) {
          await play(native.descriptor(layer));
          const created = doc.activeLayers[0];
          if (!created || created.id === group.id || created.kind === constants.LayerKind.GROUP) throw Error('PS没有返回新创建的调整层');
          await created.move(group, constants.ElementPlacement.PLACEINSIDE);
          if (layer.fillOpacity !== 1) await play({ _obj: 'set', _target: [{ _ref: 'layer', _id: created.id }], to: { _obj: 'layer', fillOpacity: { _unit: 'percentUnit', _value: layer.fillOpacity * 100 } } });
          layerIds.push(created.id);
        }
        results.push({ id: group.id, name: item.name, layerIds });
      }
      const first = findGroup(doc.layers, results[0].id);
      if (first) first.visible = true;
      success = true;
    } finally {
      try { if (savedSelection?.imageData && success) await imaging.putSelection({ documentID: doc.id, imageData: savedSelection.imageData, targetBounds: { left: savedSelection.sourceBounds?.left ?? 0, top: savedSelection.sourceBounds?.top ?? 0 }, replace: true }); }
      catch (error) { success = false; throw error; }
      finally {
        savedSelection?.imageData?.dispose();
        await executionContext.hostControl.resumeHistory(history, success);
      }
    }
  }, { commandName: 'WF美工助手：创建可编辑调色工程' });
  return { ok: true, count: results.length, layerId: params.layerId, layerName: targetName, groups: results, native: true };
}
async function check() {
  return core.executeAsModal(async () => {
    const doc = documentById();
    const bounds = documentBounds(doc);
    if (Math.min(bounds.right, bounds.bottom) < 16) throw Error('质检要求文档的两条边都至少为 16 px');
    const pixels = await readComposite(doc, bounds);
    try {
      const source = pixels.imageData;
      if (Math.min(source.width, source.height) < 16) throw Error('文档的有效图像区域太小，无法质检');
      const image = rgbaSample(source, await source.getData({ chunky: true }), Infinity);
      // 白底商品图质检按白色衬底检查合成外观。
      for (let i = 0; i < image.data.length; i += 4) {
        const alpha = image.data[i + 3] / 255;
        if (alpha === 1) continue;
        for (let c = 0; c < 3; c++) image.data[i + c] = Math.round(image.data[i + c] * alpha + 255 * (1 - alpha));
      }
      const report = qualityCheck.inspect(image);
      report.items[0] = qualityCheck.checkSize({ width: bounds.right, height: bounds.bottom }, {});
      const errors = report.items.filter(item => item.level === 'error').length;
      const warns = report.items.filter(item => item.level === 'warn').length;
      return { name: doc.title || doc.name, items: report.items, errors, warns };
    } finally { pixels.imageData.dispose(); }
  }, { commandName: 'WF美工助手：成片质检' });
}

module.exports = { inspect, read, place, check, toBase64 };
