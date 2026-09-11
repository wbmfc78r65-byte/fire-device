/* ============================================================
 * vector.js - 地图矢量图形绘制（矩形/圆形/多边形/线条/文本）
 * 依赖：db.js, map.js
 * 数据存 SVEC store，按 floorId 索引
 * ============================================================ */

let drawMode = null, drawTempLayer = null, drawPoints = [], vectorLayers = [];
let vecColor = "#ff4444", vecFillOpacity = 0.3, vecStrokeOpacity = 1, vecWeight = 2, vecFill = true, vecDash = false;
let vecZIndex = 0; // 图层层级
let selectedVector = null, selectedVectors = []; // 支持多选
let selectionLayers = []; // 选中高亮框图层

/* ---------- 绘制工具栏 ---------- */
let vectorMenuBound = false;
function initVectorToolbar() {
  const bar = $("vector-toolbar");
  if (!bar) return;
  bar.classList.remove("vec-visible");
  bar.querySelectorAll(".vec-btn").forEach(btn => {
    btn.onclick = () => {
      if (!manageMode) { showToast("请先开启管理模式"); return; }
      const mode = btn.dataset.mode;
      if (drawMode === mode) { cancelDraw(); return; }
      startDraw(mode);
    };
  });
  // 只绑定一次隐藏菜单事件
  if (!vectorMenuBound) {
    vectorMenuBound = true;
    // 点击菜单外隐藏（包括地图空白处）
    document.addEventListener("click", e => {
      const menu = $("vector-context-menu");
      if (menu && menu.style.display === "block" && !menu.contains(e.target)) {
        hideVectorMenu();
      }
      // 点击地图空白处清除选中
      if (e.target.closest("#map-container") && !e.target.closest(".leaflet-interactive") && !e.target.closest(".vec-text-icon") && !e.target.closest("#vector-toolbar")) {
        if (selectedVectors.length > 0) {
          selectedVectors = [];
          selectedVector = null;
          clearSelectionBoxes();
        }
      }
    });
    // 右键地图空白处隐藏菜单
    setTimeout(() => {
      if (map && map.getContainer()) {
        map.getContainer().addEventListener("contextmenu", e => {
          if (!e.target.closest(".leaflet-interactive") && !e.target.closest("#vector-context-menu")) {
            hideVectorMenu();
          }
        });
      }
    }, 500);
    // ESC键取消选中
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && selectedVectors.length > 0) {
        selectedVectors = [];
        selectedVector = null;
        clearSelectionBoxes();
        hideVectorMenu();
      }
    });
  }
  $("vec-color").onchange = e => { vecColor = e.target.value; if (selectedVectors.length > 1) applyStyleToSelected(); else if (selectedVector) updateVectorStyle(selectedVector); };
  $("vec-fill-opacity").oninput = e => { vecFillOpacity = parseFloat(e.target.value); $("vec-fill-opacity-val").innerText = Math.round(vecFillOpacity * 100) + "%"; if (selectedVectors.length > 1) applyStyleToSelected(); else if (selectedVector) updateVectorStyle(selectedVector); };
  $("vec-stroke-opacity").oninput = e => { vecStrokeOpacity = parseFloat(e.target.value); $("vec-stroke-opacity-val").innerText = Math.round(vecStrokeOpacity * 100) + "%"; if (selectedVectors.length > 1) applyStyleToSelected(); else if (selectedVector) updateVectorStyle(selectedVector); };
  $("vec-weight").oninput = e => { vecWeight = parseInt(e.target.value); $("vec-weight-val").innerText = vecWeight; if (selectedVectors.length > 1) applyStyleToSelected(); else if (selectedVector) updateVectorStyle(selectedVector); };
  $("vec-fill").onchange = e => { vecFill = e.target.checked; if (selectedVectors.length > 1) applyStyleToSelected(); else if (selectedVector) updateVectorStyle(selectedVector); };
  $("vec-dash").onchange = e => { vecDash = e.target.checked; if (selectedVectors.length > 1) applyStyleToSelected(); else if (selectedVector) updateVectorStyle(selectedVector); };
  $("vec-clear").onclick = () => { if (!manageMode) { showToast("请先开启管理模式"); return; } clearAllVectors(); };
  $("vec-delete").onclick = () => { if (!manageMode) { showToast("请先开启管理模式"); return; } deleteSelectedVectors(); };
  $("vec-copy").onclick = () => { if (!manageMode) { showToast("请先开启管理模式"); return; } copySelectedVector(); };
  $("vec-top").onclick = () => { if (!manageMode) { showToast("请先开启管理模式"); return; } bringVectorToTop(); };
  $("vec-bottom").onclick = () => { if (!manageMode) { showToast("请先开启管理模式"); return; } sendVectorToBottom(); };
  // 框选按钮
  const boxBtn = $("vec-box-select");
  if (boxBtn) {
    boxBtn.onclick = () => {
      if (!manageMode) { showToast("请先开启管理模式"); return; }
      if (boxSelectMode) { endBoxSelect(); } else { startBoxSelect(); }
    };
  }
}

function updateVectorToolbarVisibility() {
  const bar = $("vector-toolbar");
  if (!bar) return;
  if (manageMode) bar.classList.add("vec-visible");
  else { bar.classList.remove("vec-visible"); if (drawMode) cancelDraw(); }
}

function startDraw(mode) {
  cancelDraw();
  drawMode = mode;
  drawPoints = [];
  document.querySelectorAll(".vec-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  $("map-container").classList.add("drawing");
  showToast(`绘制模式：${modeName(mode)}，点击地图放置点，双击或右键结束`);
  if (!map) return;
  map.dragging.disable();
  map.doubleClickZoom.disable();
  map.getContainer().style.cursor = "crosshair";
  map.on("click", onDrawClick);
  map.on("mousemove", onDrawMove);
  map.on("dblclick", onDrawFinish);
  // 右键结束绘制（线/箭头/多边形）
  map.on("contextmenu", onDrawRightClick);
}

function onDrawRightClick(e) {
  if (!drawMode) return;
  L.DomEvent.stopPropagation(e);
  e.originalEvent.preventDefault();
  hideVectorMenu();
  // 矩形和圆形只需要2个点，右键不结束（第二点已经结束了）
  if (drawMode === "line" || drawMode === "arrow" || drawMode === "polygon") {
    if (drawPoints.length >= 2) {
      finishDraw();
    } else {
      showToast("至少需要2个点");
    }
  }
}

function onDrawMove(e) {
  if (!drawMode || drawPoints.length === 0) return;
  if (drawTempLayer) map.removeLayer(drawTempLayer);
  if (drawMode === "rect") {
    const a = drawPoints[0], b = e.latlng;
    drawTempLayer = L.rectangle([[Math.min(a.lat, b.lat), Math.min(a.lng, b.lng)], [Math.max(a.lat, b.lat), Math.max(a.lng, b.lng)]], { color: vecColor, weight: vecWeight, opacity: vecStrokeOpacity, dashArray: "5,5", fillOpacity: vecFillOpacity * 0.5 }).addTo(map);
  } else if (drawMode === "circle") {
    const a = drawPoints[0], b = e.latlng;
    const dx = a.lng - b.lng, dy = a.lat - b.lat;
    const r = Math.sqrt(dx * dx + dy * dy);
    drawTempLayer = L.circle([a.lat, a.lng], { radius: r, color: vecColor, weight: vecWeight, opacity: vecStrokeOpacity, dashArray: "5,5", fillOpacity: vecFillOpacity * 0.5 }).addTo(map);
  } else if (drawMode === "polygon") {
    drawTempLayer = L.polygon([...drawPoints, e.latlng], { color: vecColor, weight: vecWeight, opacity: vecStrokeOpacity, dashArray: "5,5", fillOpacity: vecFillOpacity * 0.3 }).addTo(map);
  } else if (drawMode === "line" || drawMode === "arrow") {
    drawTempLayer = L.polyline([...drawPoints, e.latlng], { color: vecColor, weight: vecWeight, opacity: vecStrokeOpacity, dashArray: vecDash ? "8,6" : null }).addTo(map);
  }
}

function modeName(m) {
  return { rect: "矩形", circle: "圆形", polygon: "多边形", line: "线条", arrow: "箭头线", text: "文本标注" }[m] || m;
}

function onDrawClick(e) {
  if (!drawMode) return;
  L.DomEvent.stopPropagation(e);
  // 文本标注：点击一次就完成
  if (drawMode === "text") {
    drawPoints.push(e.latlng);
    finishDraw();
    return;
  }
  drawPoints.push(e.latlng);
  if (drawMode === "rect" && drawPoints.length === 2) { finishDraw(); return; }
  if (drawMode === "circle" && drawPoints.length === 2) { finishDraw(); return; }
  if ((drawMode === "line" || drawMode === "arrow") && drawPoints.length >= 2) {
    if (drawTempLayer) map.removeLayer(drawTempLayer);
    drawTempLayer = L.polyline(drawPoints, { color: vecColor, weight: vecWeight, opacity: vecStrokeOpacity, dashArray: vecDash ? "8,6" : null }).addTo(map);
  }
  if (drawMode === "polygon" && drawPoints.length >= 2) {
    if (drawTempLayer) map.removeLayer(drawTempLayer);
    drawTempLayer = L.polygon(drawPoints, { color: vecColor, weight: vecWeight, opacity: vecStrokeOpacity, dashArray: vecDash ? "8,6" : null, fillOpacity: vecFillOpacity * 0.3 }).addTo(map);
  }
}

function onDrawFinish(e) {
  if (!drawMode) return;
  L.DomEvent.stopPropagation(e);
  if (drawPoints.length >= 2) finishDraw();
}

async function finishDraw() {
  if (!drawMode || !curF) { cancelDraw(); if (!curF) showToast("请先选择楼层"); return; }
  // 文本标注：只需要1个点
  if (drawMode === "text") {
    if (drawPoints.length < 1) { cancelDraw(); return; }
    const text = prompt("请输入标注文字：", "标注");
    if (!text) { cancelDraw(); return; }
    const p = drawPoints[0];
    const o = { id: genId(), floorId: curF, shape: { type: "text", position: [p.lat, p.lng] }, color: vecColor, fillOpacity: vecFillOpacity, strokeOpacity: vecStrokeOpacity, weight: vecWeight, fill: vecFill, dash: vecDash, label: text, name: "文本-" + text, zIndex: ++vecZIndex };
    await dbPut(SVEC, o);
    cancelDraw();
    const layer = createVectorLayer(o);
    if (layer) vectorLayers.push(layer);
    showToast("文本标注已保存");
    return;
  }
  if (drawPoints.length < 2) { cancelDraw(); return; }
  let shape;
  if (drawMode === "rect") {
    const a = drawPoints[0], b = drawPoints[1];
    shape = { type: "rect", bounds: [[Math.min(a.lat, b.lat), Math.min(a.lng, b.lng)], [Math.max(a.lat, b.lat), Math.max(a.lng, b.lng)]] };
  } else if (drawMode === "circle") {
    const a = drawPoints[0], b = drawPoints[1];
    const dx = a.lng - b.lng, dy = a.lat - b.lat;
    const r = Math.sqrt(dx * dx + dy * dy);
    shape = { type: "circle", center: [a.lat, a.lng], radius: r };
  } else if (drawMode === "polygon") {
    shape = { type: "polygon", latlngs: drawPoints.map(p => [p.lat, p.lng]) };
  } else if (drawMode === "line" || drawMode === "arrow") {
    shape = { type: drawMode, latlngs: drawPoints.map(p => [p.lat, p.lng]) };
  }
  const o = { id: genId(), floorId: curF, shape, color: vecColor, fillOpacity: vecFillOpacity, strokeOpacity: vecStrokeOpacity, weight: vecWeight, fill: vecFill, dash: vecDash, label: "", name: modeName(drawMode), zIndex: ++vecZIndex };
  await dbPut(SVEC, o);
  cancelDraw();
  const layer = createVectorLayer(o);
  if (layer) vectorLayers.push(layer);
  showToast("矢量图形已保存");
}

function cancelDraw() {
  drawMode = null; drawPoints = [];
  if (drawTempLayer) { map && map.removeLayer(drawTempLayer); drawTempLayer = null; }
  document.querySelectorAll(".vec-btn").forEach(b => b.classList.remove("active"));
  $("map-container").classList.remove("drawing");
  if (map) {
    // 管理模式下保持禁用拖拽（左键用于框选），非管理模式才启用
    if (!manageMode) map.dragging.enable();
    map.doubleClickZoom.enable();
    map.getContainer().style.cursor = "";
    map.off("click", onDrawClick);
    map.off("mousemove", onDrawMove);
    map.off("dblclick", onDrawFinish);
    map.off("contextmenu", onDrawRightClick);
  }
}

/* ---------- 加载/渲染矢量图形 ---------- */
async function loadVectorShapes() {
  if (!map || !curF) return;
  vectorLayers.forEach(l => map.removeLayer(l));
  vectorLayers = [];
  const shapes = await getVectorShapesByFloor(curF);
  // 计算最大 zIndex
  let maxZ = 0;
  shapes.forEach(s => { if (s.zIndex && s.zIndex > maxZ) maxZ = s.zIndex; });
  vecZIndex = maxZ;
  // 按 zIndex 排序后渲染
  shapes.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  shapes.forEach(s => vectorLayers.push(createVectorLayer(s)));
  // 刷新选中框
  if (selectedVectors.length > 0) refreshSelectionBoxes();
}

function createVectorLayer(s) {
  try {
    let layer;
    const fillOp = s.fillOpacity != null ? s.fillOpacity : (s.opacity != null ? s.opacity : 0.3);
    const strokeOp = s.strokeOpacity != null ? s.strokeOpacity : 1;
    const dashArr = s.dash ? "8,6" : null;
    const hitStyle = { color: 'transparent', weight: Math.max(8, (s.weight || 2)), opacity: 0, fillOpacity: 0, fill: true, dashArray: null };
    const visStyle = { color: s.color || "#ff4444", weight: s.weight || 2, opacity: strokeOp, fillOpacity: s.fill ? fillOp : 0, dashArray: dashArr, interactive: false };

    // 统一绑定事件的函数
    function bindEvents(hitLayer) {
      if (!manageMode) return;
      hitLayer.on("click", e => { L.DomEvent.stopPropagation(e); selectVector(s.id); });
      hitLayer.on("contextmenu", e => { L.DomEvent.stopPropagation(e); e.originalEvent.preventDefault(); showVectorMenu(s.id, e.originalEvent.clientX, e.originalEvent.clientY); });
    }

    if (s.shape.type === "rect") {
      // 矩形：透明点击层 + 显示层
      layer = L.layerGroup();
      const hit = L.rectangle(s.shape.bounds, hitStyle);
      layer.addLayer(hit);
      const vis = L.rectangle(s.shape.bounds, visStyle);
      layer.addLayer(vis);
      bindEvents(hit);
    }
    else if (s.shape.type === "circle") {
      layer = L.layerGroup();
      const hit = L.circle(s.shape.center, { radius: s.shape.radius || 10, ...hitStyle });
      layer.addLayer(hit);
      const vis = L.circle(s.shape.center, { radius: s.shape.radius || 10, ...visStyle });
      layer.addLayer(vis);
      bindEvents(hit);
    }
    else if (s.shape.type === "polygon") {
      layer = L.layerGroup();
      const hit = L.polygon(s.shape.latlngs, hitStyle);
      layer.addLayer(hit);
      const vis = L.polygon(s.shape.latlngs, visStyle);
      layer.addLayer(vis);
      bindEvents(hit);
    }
    else if (s.shape.type === "line") {
      // 线条：透明粗线(点击区) + 实际细线
      layer = L.layerGroup();
      const hitLine = L.polyline(s.shape.latlngs, { color: 'transparent', weight: Math.max(14, (s.weight || 2) * 5), opacity: 0, fillOpacity: 0 });
      layer.addLayer(hitLine);
      const line = L.polyline(s.shape.latlngs, { color: s.color || "#ff4444", weight: s.weight || 2, opacity: strokeOp, dashArray: dashArr, interactive: false });
      layer.addLayer(line);
      bindEvents(hitLine);
    }
    else if (s.shape.type === "arrow") {
      // 箭头线：透明粗线(点击区) + 实际细线 + 末端箭头
      const pts = s.shape.latlngs;
      layer = L.layerGroup();
      const hitLine = L.polyline(pts, { color: 'transparent', weight: Math.max(14, (s.weight || 2) * 5), opacity: 0, fillOpacity: 0 });
      layer.addLayer(hitLine);
      const line = L.polyline(pts, { color: s.color || "#ff4444", weight: s.weight || 2, opacity: strokeOp, dashArray: dashArr, interactive: false });
      layer.addLayer(line);
      bindEvents(hitLine);
      // 在末端添加箭头
      if (pts.length >= 2) {
        const p1 = pts[pts.length - 2], p2 = pts[pts.length - 1];
        const angle = Math.atan2(p2[0] - p1[0], p2[1] - p1[1]) * 180 / Math.PI;
        const arrowSize = (s.weight || 2) * 4;
        const arrowIcon = L.divIcon({
          html: `<div style="width:0;height:0;border-left:${arrowSize}px solid transparent;border-right:${arrowSize}px solid transparent;border-bottom:${arrowSize*1.5}px solid ${s.color || '#ff4444'};transform:rotate(${angle+90}deg);opacity:${strokeOp}"></div>`,
          className: 'vec-arrow-icon', iconSize: [arrowSize*2, arrowSize*1.5], iconAnchor: [arrowSize, arrowSize*0.75]
        });
        const arrow = L.marker([p2[0], p2[1]], { icon: arrowIcon, interactive: false });
        layer.addLayer(arrow);
      }
    }
    else if (s.shape.type === "text") {
      const fontSize = (s.weight || 2) * 6 + 8;
      const textIcon = L.divIcon({
        html: `<div style="color:${s.color || '#ff4444'};font-size:${fontSize}px;font-weight:bold;white-space:nowrap;text-shadow:1px 1px 2px #fff, -1px -1px 2px #fff, 1px -1px 2px #fff, -1px 1px 2px #fff;opacity:${strokeOp};pointer-events:auto;cursor:pointer;padding:4px 8px;">${s.label || '文本'}</div>`,
        className: 'vec-text-icon', iconSize: null
      });
      layer = L.marker([s.shape.position[0], s.shape.position[1]], { icon: textIcon });
      if (manageMode) {
        layer.on("click", e => { L.DomEvent.stopPropagation(e); selectVector(s.id); });
        layer.on("contextmenu", e => { L.DomEvent.stopPropagation(e); e.originalEvent.preventDefault(); showVectorMenu(s.id, e.originalEvent.clientX, e.originalEvent.clientY); });
      }
    }
    if (!layer) return null;
    layer._vecId = s.id;
    // 设置层级
    if (layer.setZIndexOffset) layer.setZIndexOffset((s.zIndex || 0) * 100);
    layer.addTo(map);
    return layer;
  } catch (e) {
    console.error("创建矢量图层失败:", e, s);
    return null;
  }
}

async function selectVector(id) {
  selectedVector = id;
  selectedVectors = [id]; // 点击单个时，只选中这一个
  await refreshSelectionBoxes();
  const data = await getVectorData(id);
  if (data) {
    vecColor = data.color || "#ff4444";
    vecFillOpacity = data.fillOpacity != null ? data.fillOpacity : (data.opacity != null ? data.opacity : 0.3);
    vecStrokeOpacity = data.strokeOpacity != null ? data.strokeOpacity : 1;
    vecWeight = data.weight || 2;
    vecFill = data.fill !== false;
    vecDash = data.dash === true;
    $("vec-color").value = vecColor;
    $("vec-fill-opacity").value = vecFillOpacity;
    $("vec-stroke-opacity").value = vecStrokeOpacity;
    $("vec-weight").value = vecWeight;
    $("vec-fill").checked = vecFill;
    $("vec-dash").checked = vecDash;
    $("vec-fill-opacity-val").innerText = Math.round(vecFillOpacity * 100) + "%";
    $("vec-stroke-opacity-val").innerText = Math.round(vecStrokeOpacity * 100) + "%";
    $("vec-weight-val").innerText = vecWeight;
  }
}

async function getVectorData(id) {
  const all = await dbGetAll(SVEC);
  return all.find(x => x.id === id);
}

async function updateVectorStyle(id) {
  const data = await getVectorData(id);
  if (!data) return;
  data.color = vecColor; data.fillOpacity = vecFillOpacity; data.strokeOpacity = vecStrokeOpacity; data.weight = vecWeight; data.fill = vecFill; data.dash = vecDash;
  await dbPut(SVEC, data);
  loadVectorShapes();
}

async function deleteSelectedVector() {
  if (!selectedVector) { showToast("请先点击选中一个矢量图形"); return; }
  if (!await confirmDialog("确认删除选中的矢量图形？")) return;
  const data = await getVectorData(selectedVector);
  if (data) { pushUndo(SVEC, data, `矢量图形-${data.name}`); await dbDel(SVEC, selectedVector); showUndoBar(`矢量图形-${data.name}`); }
  selectedVector = null;
  selectedVectors = [];
  clearSelectionBoxes();
  loadVectorShapes();
  showToast("矢量图形已删除");
}

async function clearAllVectors() {
  if (!curF) return;
  if (!await confirmDialog("确认清空当前楼层所有矢量图形？")) return;
  const shapes = await getVectorShapesByFloor(curF);
  if (!shapes.length) { showToast("当前楼层没有矢量图形"); return; }
  pushUndo('cascade', { vectors: shapes }, `当前楼层全部矢量图形（${shapes.length}个）`);
  for (let s of shapes) await dbDel(SVEC, s.id);
  loadVectorShapes();
  showToast(`已清空 ${shapes.length} 个矢量图形`);
  showUndoBar(`当前楼层全部矢量图形（${shapes.length}个）`);
}

function showVectorMenu(id, cx, cy) {
  const menu = $("vector-context-menu");
  // 如果菜单已显示且是同一个图形，则隐藏（切换效果）
  if (menu.style.display === "block" && selectedVector === id) {
    hideVectorMenu();
    return;
  }
  selectedVector = id;
  const r = $("map-container").getBoundingClientRect();
  menu.style.left = (cx - r.left) + "px";
  menu.style.top = (cy - r.top) + "px";
  menu.style.display = "block";
}
function hideVectorMenu() { $("vector-context-menu").style.display = "none"; }
async function vecMenuEdit() { hideVectorMenu(); if (!selectedVector) return; const d = await getVectorData(selectedVector); const name = prompt("图形名称：", d.name || ""); if (name !== null) { d.name = name; await dbPut(SVEC, d); loadVectorShapes(); showToast("已更新名称"); } }
async function vecMenuDelete() { hideVectorMenu(); await deleteSelectedVectors(); }
async function vecMenuCopy() { hideVectorMenu(); await copySelectedVector(); }
async function vecMenuTop() { hideVectorMenu(); await bringVectorToTop(); }
async function vecMenuBottom() { hideVectorMenu(); await sendVectorToBottom(); }

// 复制选中图形
async function copySelectedVector() {
  if (!selectedVector) { showToast("请先点击选中一个矢量图形"); return; }
  const data = await getVectorData(selectedVector);
  if (!data) { showToast("图形不存在"); return; }
  const copy = JSON.parse(JSON.stringify(data));
  copy.id = genId();
  copy.name = (data.name || "图形") + "-副本";
  copy.zIndex = ++vecZIndex;
  // 位置偏移一点，避免完全重叠
  if (copy.shape.type === "rect") {
    const offset = 0.0005;
    copy.shape.bounds = copy.shape.bounds.map(b => [b[0] + offset, b[1] + offset]);
  } else if (copy.shape.type === "circle") {
    copy.shape.center = [copy.shape.center[0] + 0.0005, copy.shape.center[1] + 0.0005];
  } else if (copy.shape.type === "polygon" || copy.shape.type === "line" || copy.shape.type === "arrow") {
    copy.shape.latlngs = copy.shape.latlngs.map(p => [p[0] + 0.0005, p[1] + 0.0005]);
  } else if (copy.shape.type === "text") {
    copy.shape.position = [copy.shape.position[0] + 0.0005, copy.shape.position[1] + 0.0005];
  }
  await dbPut(SVEC, copy);
  selectedVector = copy.id;
  loadVectorShapes();
  showToast("图形已复制，可拖拽调整位置");
}

// 置顶
async function bringVectorToTop() {
  if (!selectedVector) { showToast("请先点击选中一个矢量图形"); return; }
  const data = await getVectorData(selectedVector);
  if (!data) return;
  data.zIndex = ++vecZIndex;
  await dbPut(SVEC, data);
  loadVectorShapes();
  showToast("已置顶");
}

// 置底
async function sendVectorToBottom() {
  if (!selectedVector) { showToast("请先点击选中一个矢量图形"); return; }
  const data = await getVectorData(selectedVector);
  if (!data) return;
  data.zIndex = --vecZIndex;
  await dbPut(SVEC, data);
  loadVectorShapes();
  showToast("已置底");
}

/* ---------- 管理模式切换时更新样式 ---------- */
function refreshVectorDrag() {
  vectorLayers.forEach(l => {
    if (l.setStyle) l.setStyle({ weight: l.options.weight });
  });
}

// 清除所有选中框
function clearSelectionBoxes() {
  selectionLayers.forEach(l => { if (map) map.removeLayer(l); });
  selectionLayers = [];
}

// 为指定图形显示选中框
async function showSelectionBox(id) {
  const data = await getVectorData(id);
  if (!data || !map) return;
  const s = data;
  let box = null;
  const boxStyle = { color: "#3388ff", weight: 2, dashArray: "6,4", fillOpacity: 0, opacity: 0.9, interactive: false };
  if (s.shape.type === "rect") {
    box = L.rectangle(s.shape.bounds, boxStyle);
  } else if (s.shape.type === "circle") {
    box = L.circle(s.shape.center, { radius: s.shape.radius || 10, ...boxStyle });
  } else if (s.shape.type === "polygon") {
    box = L.polygon(s.shape.latlngs, boxStyle);
  } else if (s.shape.type === "line" || s.shape.type === "arrow") {
    // 线条用粗一点的半透明线作为选中框
    box = L.polyline(s.shape.latlngs, { color: "#3388ff", weight: (s.weight || 2) + 6, opacity: 0.4, dashArray: "6,4", interactive: false });
  } else if (s.shape.type === "text") {
    // 文本用一个小矩形框包裹
    const p = s.shape.position;
    const offset = 0.0008;
    box = L.rectangle([[p[0]-offset, p[1]-offset], [p[0]+offset, p[1]+offset]], boxStyle);
  }
  if (box) {
    box.addTo(map);
    selectionLayers.push(box);
  }
}

// 更新所有选中图形的高亮框
async function refreshSelectionBoxes() {
  clearSelectionBoxes();
  for (const id of selectedVectors) {
    await showSelectionBox(id);
  }
}

// 根据图形数据计算地理边界框
function getShapeBounds(s) {
  if (!s || !s.shape) return null;
  const sh = s.shape;
  if (sh.type === "rect") {
    return L.latLngBounds(sh.bounds[0], sh.bounds[1]);
  } else if (sh.type === "circle") {
    const r = sh.radius || 10;
    const c = sh.center;
    return L.latLngBounds([c[0]-r, c[1]-r], [c[0]+r, c[1]+r]);
  } else if (sh.type === "polygon" || sh.type === "line" || sh.type === "arrow") {
    const pts = sh.latlngs;
    if (!pts || pts.length === 0) return null;
    let minLat=Infinity, maxLat=-Infinity, minLng=Infinity, maxLng=-Infinity;
    pts.forEach(p => { minLat=Math.min(minLat,p[0]); maxLat=Math.max(maxLat,p[0]); minLng=Math.min(minLng,p[1]); maxLng=Math.max(maxLng,p[1]); });
    return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
  } else if (sh.type === "text") {
    const p = sh.position;
    const offset = 0.001;
    return L.latLngBounds([p[0]-offset, p[1]-offset], [p[0]+offset, p[1]+offset]);
  }
  return null;
}

// 批量修改样式
async function applyStyleToSelected() {
  if (selectedVectors.length === 0) return;
  for (const id of selectedVectors) {
    const data = await getVectorData(id);
    if (!data) continue;
    data.color = vecColor; data.fillOpacity = vecFillOpacity; data.strokeOpacity = vecStrokeOpacity; data.weight = vecWeight; data.fill = vecFill; data.dash = vecDash;
    await dbPut(SVEC, data);
  }
  loadVectorShapes();
  showToast(`已批量修改 ${selectedVectors.length} 个图形`);
}

// 批量删除（支持单个和多个）
async function deleteSelectedVectors() {
  // 保存要删除的ID列表，避免过程中被修改
  const idsToDelete = [...selectedVectors];
  if (idsToDelete.length === 0) { showToast("请先选中矢量图形"); return; }
  if (!await confirmDialog(`确认删除选中的 ${idsToDelete.length} 个图形？`)) return;
  // 收集数据用于撤销
  const deletedData = [];
  for (const id of idsToDelete) {
    const data = await getVectorData(id);
    if (data) {
      deletedData.push(data);
      await dbDel(SVEC, id);
    }
  }
  // 撤销支持
  if (deletedData.length === 1) {
    pushUndo(SVEC, deletedData[0], `矢量图形-${deletedData[0].name}`);
    showUndoBar(`矢量图形-${deletedData[0].name}`);
  } else if (deletedData.length > 1) {
    pushUndo('cascade', { vectors: deletedData }, `批量删除矢量图形（${deletedData.length}个）`);
    showUndoBar(`批量删除矢量图形（${deletedData.length}个）`);
  }
  selectedVectors = [];
  selectedVector = null;
  clearSelectionBoxes();
  loadVectorShapes();
  showToast(`已删除 ${deletedData.length} 个图形`);
}
