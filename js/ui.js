/* ============================================================
 * ui.js - 界面交互（侧边栏/树/图例/建筑楼层设备CRUD）
 * 依赖：db.js, map.js, search.js
 * ============================================================ */

let curB = null, curF = null;
let visibleTypeSet = new Set();
let leftCollapsed = false, rightCollapsed = true;
let legendConfigOnMap = false, draggedLegendType = null;
let buildingFoldState = {};
const catState = { building: false, legend: false, batch: false, report: false, data: false };
let headerConfig = { title: "🔥消防设施管理", desc: "数字化管理系统" };
let tempPhoto = "", tempLegendIcon = "", tempLegendIconW = 0, tempLegendIconH = 0, tempFloorImgRemoved = false;

/* ---------- 侧边栏收起（状态持久化） ---------- */
function toggleLeftSidebar() {
  leftCollapsed = !leftCollapsed;
  $("sidebar").classList.toggle("collapsed", leftCollapsed);
  $("toggle-left-icon").innerText = leftCollapsed ? "▶" : "◀";
  try { localStorage.setItem("firemap_left_collapsed", leftCollapsed ? "1" : "0"); } catch (e) {}
  setTimeout(() => map && map.invalidateSize(), 350);
}
function toggleRightSidebar() {
  rightCollapsed = !rightCollapsed;
  $("right-panel").classList.toggle("collapsed", rightCollapsed);
  $("toggle-right-icon").innerText = rightCollapsed ? "◀" : "▶";
  try { localStorage.setItem("firemap_right_collapsed", rightCollapsed ? "1" : "0"); } catch (e) {}
  setTimeout(() => map && map.invalidateSize(), 350);
}
function initSidebarState() {
  try {
    const sb = $("sidebar");
    if (!sb) return;
    const lc = localStorage.getItem("firemap_left_collapsed");
    if (lc === "1") {
      leftCollapsed = true;
      sb.classList.add("collapsed");
      $("toggle-left-icon").innerText = "▶";
    } else {
      leftCollapsed = false;
      sb.classList.remove("collapsed");
      $("toggle-left-icon").innerText = "◀";
    }
    const rc = localStorage.getItem("firemap_right_collapsed");
    rightCollapsed = rc !== null ? (rc === "1") : true;
    $("right-panel").classList.toggle("collapsed", rightCollapsed);
    $("toggle-right-icon").innerText = rightCollapsed ? "◀" : "▶";
  } catch (e) {}
  // 页面完全加载后再确认一次，防止被其他代码覆盖
  window.addEventListener("load", () => {
    try {
      const sb = $("sidebar");
      if (leftCollapsed) sb.classList.add("collapsed");
      else sb.classList.remove("collapsed");
      $("toggle-left-icon").innerText = leftCollapsed ? "▶" : "◀";
    } catch (e) {}
  });
}
function toggleCategory(catId) {
  const body = $(catId), arrow = $(catId + '-arrow'), header = body.previousElementSibling, key = catId.replace('cat-', '');
  const c = body.classList.contains('collapsed');
  body.classList.toggle('collapsed', !c);
  arrow.style.transform = c ? 'rotate(0)' : 'rotate(-90deg)';
  header.classList.toggle('collapsed', !c);
  catState[key] = c;
  saveCatState();
}
function saveCatState() {
  try { localStorage.setItem("firemap_cat_state", JSON.stringify(catState)); } catch (e) {}
}
function toggleBuildingFold(bid) { buildingFoldState[bid] = buildingFoldState[bid] === false ? true : false; saveBuildingFoldState(); renderTree(); }
function saveBuildingFoldState() {
  try { localStorage.setItem("firemap_building_fold", JSON.stringify(buildingFoldState)); } catch (e) {}
}
function loadBuildingFoldState() {
  try {
    const s = localStorage.getItem("firemap_building_fold");
    if (s) buildingFoldState = JSON.parse(s);
  } catch (e) {}
}
function initCategoriesCollapsed() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("firemap_cat_state") || "null"); } catch (e) {}
  ['building', 'legend', 'batch', 'report', 'data'].forEach(key => {
    const body = $("cat-" + key), arrow = $("cat-" + key + "-arrow"), header = body.previousElementSibling;
    const expanded = saved ? (saved[key] === true) : false;
    if (expanded) {
      body.classList.remove('collapsed');
      arrow.style.transform = 'rotate(0)';
      header.classList.remove('collapsed');
      catState[key] = true;
    } else {
      body.classList.add('collapsed');
      arrow.style.transform = 'rotate(-90deg)';
      header.classList.add('collapsed');
      catState[key] = false;
    }
  });
}

/* ---------- 标题自定义 ---------- */
let tempHeaderBg = "";
function loadHeaderConfig() { try { const s = localStorage.getItem("firemap_header_config"); if (s) headerConfig = JSON.parse(s); } catch (e) { } applyHeaderConfig(); }
function applyHeaderConfig() {
  // 防止图片data URL或异常数据被错误地当作文字显示
  const rawTitle = headerConfig.title || "";
  const rawDesc = headerConfig.desc || "";
  const isBad = (s) => s.startsWith("data:") || s.length > 100 || s.includes("base64");
  const safeTitle = isBad(rawTitle) ? "🔥消防设施管理" : (rawTitle || "🔥消防设施管理");
  const safeDesc = isBad(rawDesc) ? "数字化管理系统" : (rawDesc || "数字化管理系统");
  // 如果发现异常数据，自动修复并保存
  if (isBad(rawTitle) || isBad(rawDesc)) {
    headerConfig.title = safeTitle;
    headerConfig.desc = safeDesc;
    saveHeaderConfig();
  }
  $("header-title").innerText = safeTitle;
  $("header-desc").innerText = safeDesc;
  document.title = safeTitle.replace(/[🔥🎨📊💾]/g, '').trim() + " - " + safeDesc;
  const hdr = $("sidebar").querySelector(".sidebar-header");
  if (headerConfig.bgImage) {
    hdr.style.backgroundImage = `url(${headerConfig.bgImage})`;
    hdr.style.backgroundSize = "cover";
    hdr.style.backgroundPosition = "center";
    hdr.style.color = "#fff";
    hdr.style.textShadow = "0 1px 3px rgba(0,0,0,.6)";
  } else {
    hdr.style.backgroundImage = "";
    hdr.style.backgroundSize = "";
    hdr.style.backgroundPosition = "";
    hdr.style.color = "";
    hdr.style.textShadow = "";
  }
}
function saveHeaderConfig() { try { localStorage.setItem("firemap_header_config", JSON.stringify(headerConfig)); } catch (e) { } }
function editHeaderTitle() {
  $("hdr-title").value = headerConfig.title || "";
  $("hdr-desc").value = headerConfig.desc || "";
  tempHeaderBg = headerConfig.bgImage || "";
  updateHeaderBgPreview();
  openModal("modal-header");
}
function updateHeaderBgPreview() {
  const p = $("hdr-bg-preview");
  if (tempHeaderBg) { p.style.backgroundImage = `url(${tempHeaderBg})`; p.innerText = ""; }
  else { p.style.backgroundImage = ""; p.innerText = "无背景"; }
}
function onHeaderBgChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => { tempHeaderBg = ev.target.result; updateHeaderBgPreview(); };
  reader.readAsDataURL(file);
}
function clearHeaderBg() { tempHeaderBg = ""; updateHeaderBgPreview(); }
function saveHeaderTitle() {
  headerConfig.title = $("hdr-title").value.trim() || "🔥消防设施管理";
  headerConfig.desc = $("hdr-desc").value.trim() || "数字化管理系统";
  headerConfig.bgImage = tempHeaderBg || "";
  applyHeaderConfig(); saveHeaderConfig(); closeModal("modal-header"); showToast("标题已更新");
}
function resetHeaderTitle() {
  headerConfig = { title: "🔥消防设施管理", desc: "数字化管理系统", bgImage: "" };
  tempHeaderBg = "";
  $("hdr-title").value = headerConfig.title;
  $("hdr-desc").value = headerConfig.desc;
  updateHeaderBgPreview();
  applyHeaderConfig(); saveHeaderConfig(); showToast("已恢复默认标题");
}

/* ---------- 图例渲染 ---------- */
function renderLegendList(containerId, mode) {
  getAllLegend().then(list => {
    const el = $(containerId); if (!el) return;
    if (!list.length) { el.innerHTML = '<div style="padding:12px;color:#64748b;font-size:12px;text-align:center">暂无图例</div>'; return; }
    const canEdit = typeof isAdmin === 'function' ? isAdmin() : true;
    let html = "";
    list.forEach((item, idx) => {
      if (mode === 'toggle') { const ck = visibleTypeSet.has(item.name) ? "✅" : ""; html += `<div class="legend-item" onclick="toggleLegend('${item.name}')">${draggableHTML(item, 20)}<span style="font-size:12px">${ck}</span></div>`; }
      else {
        const legendOps = canEdit ? `<div class="legend-edit-op">
            <button onclick="editLegendItem('${item.id}')">编辑</button>
            <button onclick="deleteLegendItemById('${item.id}')">删除</button>
          </div>` : '';
        const dragHandle = canEdit ? '<span class="legend-sort-handle" draggable="true" title="拖拽排序">⋮⋮</span>' : '';
        html += `<div class="legend-edit-item" data-legend-id="${item.id}">
          ${dragHandle}
          ${draggableHTML(item, 24)}
          ${legendOps}
        </div>`;
      }
    });
    el.innerHTML = html; bindDragEvents(); bindLegendSort(containerId);
  });
}
function renderAllLegend() {
  getAllLegend().then(l => $("cat-legend-count").innerText = l.length);
  renderLegendList("sidebar-legend-edit-wrap", "edit");
  renderLegendList("float-legend-config-list", "edit");
  renderLegendList("legend-list", "toggle");
  renderLegendList("float-legend-list", "toggle");
}
function toggleLegend(n) {
  // 切换图例时退出复制模式
  if (typeof exitSingleCopy === 'function' && typeof singleCopyTemplate !== 'undefined' && singleCopyTemplate) exitSingleCopy();
  if (typeof exitMultiCopy === 'function' && typeof multiCopyTemplate !== 'undefined' && multiCopyTemplate) exitMultiCopy();
  visibleTypeSet.has(n) ? visibleTypeSet.delete(n) : visibleTypeSet.add(n); renderAllLegend(); renderDeviceMarkers();
}
async function moveLegend(id, dir) {
  const list = await getAllLegend();
  const idx = list.findIndex(l => l.id === id);
  if (idx < 0) return;
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= list.length) return;
  const a = list[idx], b = list[swapIdx];
  const aOrder = a.sortOrder != null ? a.sortOrder : idx;
  const bOrder = b.sortOrder != null ? b.sortOrder : swapIdx;
  a.sortOrder = bOrder; b.sortOrder = aOrder;
  await dbPut(SLEG, a);
  await dbPut(SLEG, b);
  renderAllLegend();
  showToast(dir < 0 ? "已上移" : "已下移");
}
let sortDragId = null, sortDragEl = null;
function bindLegendSort(containerId) {
  const container = $(containerId);
  if (!container) return;
  const items = container.querySelectorAll('.legend-edit-item');
  items.forEach(item => {
    if (item.dataset.sortBound) return;
    item.dataset.sortBound = "1";
    const handle = item.querySelector('.legend-sort-handle');
    if (handle) {
      handle.addEventListener('dragstart', e => {
        sortDragId = item.dataset.legendId;
        sortDragEl = item;
        item.classList.add('sort-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'sort-' + sortDragId);
      });
      handle.addEventListener('dragend', () => {
        item.classList.remove('sort-dragging');
        items.forEach(i => i.classList.remove('sort-over'));
        sortDragId = null; sortDragEl = null;
      });
    }
    item.addEventListener('dragover', e => {
      if (!sortDragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      items.forEach(i => i.classList.remove('sort-over'));
      item.classList.add('sort-over');
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('sort-over');
    });
    item.addEventListener('drop', async e => {
      e.preventDefault();
      if (!sortDragId || sortDragId === item.dataset.legendId) return;
      const targetId = item.dataset.legendId;
      await reorderLegend(sortDragId, targetId);
    });
  });
}
async function reorderLegend(dragId, targetId) {
  const list = await getAllLegend();
  const dragIdx = list.findIndex(l => l.id === dragId);
  const targetIdx = list.findIndex(l => l.id === targetId);
  if (dragIdx < 0 || targetIdx < 0) return;
  const [moved] = list.splice(dragIdx, 1);
  list.splice(targetIdx, 0, moved);
  list.forEach((item, i) => { item.sortOrder = i; });
  await dbBulkPut(SLEG, list);
  renderAllLegend();
  showToast("排序已更新");
}
async function showAllLegend() { visibleTypeSet = new Set((await getAllLegend()).map(i => i.name)); renderAllLegend(); renderDeviceMarkers(); }
const hideAllLegend = () => { visibleTypeSet.clear(); renderAllLegend(); renderDeviceMarkers(); };

/* ---------- 图例拖拽到地图（仅管理模式有效） ---------- */
function bindDragEvents() {
  document.querySelectorAll('.draggable-legend').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = "1";
    el.addEventListener('dragstart', function (e) {
      if (!manageMode) { e.preventDefault(); showToast("请先开启管理模式"); return; }
      // 拖拽新图例时退出复制模式
      if (typeof exitSingleCopy === 'function' && typeof singleCopyTemplate !== 'undefined' && singleCopyTemplate) exitSingleCopy();
      if (typeof exitMultiCopy === 'function' && typeof multiCopyTemplate !== 'undefined' && multiCopyTemplate) exitMultiCopy();
      draggedLegendType = this.dataset.type; this.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', this.dataset.type);
      const ic = this.querySelector('img,div');
      if (ic) try { e.dataTransfer.setDragImage(ic, 12, 12); } catch (e) { }
    });
    el.addEventListener('dragend', function () {
      this.classList.remove('dragging'); draggedLegendType = null;
      $("map-container").classList.remove('drag-over'); $("drop-hint").classList.remove('show');
    });
  });
}
function initMapDropZone() {
  const c = $("map-container");
  c.addEventListener('dragover', e => { if (!manageMode) return; e.preventDefault(); if (draggedLegendType) { c.classList.add('drag-over'); $("drop-hint").classList.add('show'); } });
  c.addEventListener('dragleave', e => { if (e.target === c || !c.contains(e.relatedTarget)) { c.classList.remove('drag-over'); $("drop-hint").classList.remove('show'); } });
  c.addEventListener('drop', async e => {
    if (!manageMode) return;
    e.preventDefault(); c.classList.remove('drag-over'); $("drop-hint").classList.remove('show');
    const type = e.dataTransfer.getData('text/plain') || draggedLegendType;
    // 防止批量移动时误触发drop，type被设置为图片data URL
    if (!type || type.startsWith("data:") || type.length > 100) return;
    if (!curF || !map) { if (!curF) showToast("请先选择建筑和楼层"); return; }
    const r = c.getBoundingClientRect();
    const ll = map.containerPointToLatLng(L.point(e.clientX - r.left, e.clientY - r.top));
    const dev = {
      id: genId(), floorId: curF, deviceType: type, deviceCode: "",
      posX: ll.lng, posY: ll.lat,
      positionDesc: "", installDate: "", lifeYears: 0, nextMaintain: "",
      status: "正常", remark: "", manufacturer: "", model: "", person: "", phone: "",
      customFields: {}, customIcon: null
    };
    await dbPut(SD, dev);
    renderDeviceMarkers();
    if (typeof calcStat === 'function') calcStat();
    showToast(`已添加【${type}】，双击可编辑`);
  });
}

/* ---------- 图例配置悬浮 ---------- */
function toggleLegendOnMap() {
  legendConfigOnMap = !legendConfigOnMap;
  const p = $("float-legend-config-panel");
  if (legendConfigOnMap) { p.style.display = "flex"; p.classList.remove("collapsed"); $("collapsed-legend-config-bar").style.display = "none"; showToast("图例配置已悬浮到地图"); }
  else { legendConfigOnMap = false; p.style.display = "none"; $("collapsed-legend-config-bar").style.display = "none"; showToast("图例配置已收回侧边栏"); }
}
const closeLegendConfigOnMap = () => { legendConfigOnMap = false; $("float-legend-config-panel").style.display = "none"; $("collapsed-legend-config-bar").style.display = "none"; };

/* ---------- 图例编辑 ---------- */
$("leg-icon-file").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  tempLegendIcon = await new Promise(r => { const rd = new FileReader(); rd.onload = x => r(x.target.result); rd.readAsDataURL(f); });
  const img = new Image();
  img.onload = () => { tempLegendIconW = img.naturalWidth; tempLegendIconH = img.naturalHeight; updateLegendIconPreview(); updateLegSizePreview(); };
  img.src = tempLegendIcon;
};
function updateLegendIconPreview() {
  const box = $("leg-icon-preview");
  if (tempLegendIcon) box.innerHTML = `<img src="${tempLegendIcon}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;display:block"/>`;
  else box.innerHTML = `<div style="width:40px;height:40px;background:${$("leg-color").value};border-radius:6px"></div>`;
}
function onLegendColorChange() {
  if (typeof syncIconColor === 'function') syncIconColor();
  if (typeof renderIconPicker === 'function') renderIconPicker();
  updateLegendIconPreview();
  updateLegSizePreview();
}
$("leg-color").onchange = onLegendColorChange;
$("leg-color").oninput = onLegendColorChange;
function clearLegendIcon() { tempLegendIcon = ""; tempLegendIconW = 0; tempLegendIconH = 0; $("leg-icon-file").value = null; updateLegendIconPreview(); updateLegSizePreview(); showToast("已清除自定义图标"); }
function setLegendColor(color) {
  $("leg-color").value = color;
  onLegendColorChange();
}
function updateLegSizePreview() {
  const sz = parseInt($("leg-size").value); $("leg-size-val").innerText = sz;
  const dot = $("leg-size-preview-dot"), color = $("leg-color").value;
  const boxSize = 72; // 预览框内可用尺寸
  let w, h;
  if (tempLegendIcon) {
    const r = (tempLegendIconW && tempLegendIconH) ? tempLegendIconW / tempLegendIconH : 1;
    if (r >= 1) { w = sz; h = Math.round(sz / r); } else { w = Math.round(sz * r); h = sz; }
    dot.style.background = "transparent"; dot.style.borderRadius = "4px"; dot.style.border = "2px solid #fff";
    dot.innerHTML = `<img src="${tempLegendIcon}" alt="" style="width:100%;height:100%;display:block"/>`;
  } else {
    w = h = Math.round(sz * .7);
    const shape = document.querySelector("input[name='leg-shape']:checked")?.value || "circle";
    dot.style.background = color; dot.style.borderRadius = shape === "square" ? "4px" : "50%"; dot.style.border = "2px solid #fff"; dot.innerHTML = "";
  }
  dot.style.width = w + "px"; dot.style.height = h + "px";
  // 大图标自动缩放到预览框内
  const scale = Math.min(1, boxSize / Math.max(w, h));
  dot.style.transform = "scale(" + scale + ")";
  dot.style.transformOrigin = "center center";
}
function showAddLegendItem() {
  $("leg-id").value = ""; $("leg-name").value = ""; $("leg-color").value = "#3388dd"; $("leg-size").value = 32;
  $("leg-shape-circle").checked = true;
  $("leg-border-opacity").value = 1; $("leg-border-opacity-val").innerText = "100%";
  $("leg-icon-file").value = null; tempLegendIcon = ""; tempLegendIconW = 0; tempLegendIconH = 0;
  updateLegendIconPreview(); updateLegSizePreview();
  if (typeof renderIconPicker === 'function') renderIconPicker();
  openModal("modal-legend-item");
}
async function editLegendItem(id) {
  const item = (await getAllLegend()).find(x => x.id === id);
  $("leg-id").value = item.id; $("leg-name").value = item.name; $("leg-color").value = item.color; $("leg-size").value = item.size || 32;
  const shape = item.shape || "circle";
  document.getElementById("leg-shape-" + shape).checked = true;
  const bop = item.borderOpacity != null ? item.borderOpacity : 1;
  $("leg-border-opacity").value = bop; $("leg-border-opacity-val").innerText = Math.round(bop * 100) + "%";
  $("leg-icon-file").value = null; tempLegendIcon = item.icon || ""; tempLegendIconW = item.iconW || 0; tempLegendIconH = item.iconH || 0;
  updateLegendIconPreview(); updateLegSizePreview();
  if (typeof renderIconPicker === 'function') renderIconPicker();
  openModal("modal-legend-item");
}
async function saveLegendItem() {
  const lid = $("leg-id").value.trim(), name = $("leg-name").value.trim(), color = $("leg-color").value, size = parseInt($("leg-size").value);
  const borderOpacity = parseFloat($("leg-border-opacity").value);
  const shape = document.querySelector("input[name='leg-shape']:checked")?.value || "circle";
  if (!name) { showToast("名称不能为空"); return; }
  const old = lid ? (await getAllLegend()).find(x => x.id === lid) : null;
  const oldName = old?.name;
  const o = { id: lid || genId(), name, color, icon: tempLegendIcon, iconW: tempLegendIconW, iconH: tempLegendIconH, size, borderOpacity, shape, sortOrder: old?.sortOrder ?? Date.now() };
  await dbPut(SLEG, o);
  if (oldName && oldName !== name) {
    const devs = await dbGetAll(SD);
    const toUpdate = devs.filter(d => d.deviceType === oldName);
    toUpdate.forEach(d => { d.deviceType = name; });
    if (toUpdate.length > 0) await dbBulkPut(SD, toUpdate);
    if (visibleTypeSet.has(oldName)) { visibleTypeSet.delete(oldName); visibleTypeSet.add(name); }
  } else if (!lid) {
    visibleTypeSet.add(name);
  }
  closeModal("modal-legend-item");
  await initDevTypeSelect(); renderAllLegend(); renderDeviceMarkers();
  showToast(lid ? "图例已更新" : "新增图例成功");
}
async function deleteLegendItem() { const lid = $("leg-id").value.trim(); if (lid) await deleteLegendItemById(lid); else closeModal("modal-legend-item"); }
async function deleteLegendItemById(id) {
  hideContextMenu();
  if (!await confirmDialog("确认删除该设施图例类型？")) return;
  const item = (await getAllLegend()).find(x => x.id === id);
  if (!item) { showToast("图例不存在"); return; }
  // 检查该类型是否有设备（兼容deviceType为空或有空格的情况）
  const allDevs = await dbGetAll(SD);
  const typeDevs = allDevs.filter(d => (d.deviceType || '').trim() === item.name.trim());
  let deletedDevs = [];
  if (typeDevs.length > 0) {
    if (await confirmDialog(`该类型下有 ${typeDevs.length} 个设备，是否同时删除这些设备？\n\n点击「确定」：同时删除设备（重新添加图例不会恢复）\n点击「取消」：仅删除图例，设备数据保留（重新添加图例后自动恢复显示）`)) {
      // 同时删除设备
      for (const d of typeDevs) {
        await dbDel(SD, d.id);
        deletedDevs.push(d);
      }
    }
  }
  pushUndo(SLEG, item, `图例-${item.name}`);
  await dbDel(SLEG, id); visibleTypeSet.delete(item.name);
  closeModal("modal-legend-item");
  await initDevTypeSelect(); renderAllLegend(); renderDeviceMarkers();
  if (typeof calcStat === 'function') calcStat();
  if (deletedDevs.length > 0) {
    showToast(`图例及 ${deletedDevs.length} 个设备已删除`);
  } else {
    showToast("图例已删除，设备数据已保留");
  }
  showUndoBar(`图例-${item.name}`);
}

async function initDevTypeSelect() { const sel = $("dev-type"); sel.innerHTML = ""; (await getAllLegend()).forEach(t => sel.innerHTML += `<option value="${t.name}">${t.name}</option>`); }

/* ---------- 统计 ---------- */
async function calcStat() {
  const dev = await dbGetAll(SD);
  $("stat-total").innerText = dev.length;
  $("stat-normal").innerText = dev.filter(d => d.status === "正常").length;
  
  // 故障数：只统计当前存在的设备中状态为"故障"的数量
  // （被删除设备的历史故障记录不计数，巡检记录里仍保留完整历史）
  const faultDeviceCount = dev.filter(d => d.status === "故障").length;
  $("stat-fault").innerText = faultDeviceCount;
  console.log('故障统计：当前状态为故障的设备共', faultDeviceCount, '台');
  
  $("stat-waitcheck").innerText = dev.filter(d => d.status === "待维保").length;
  $("stat-life-warn").innerText = dev.filter(d => calcDeviceLife(d).status === 'warn').length;
  $("stat-life-expire").innerText = dev.filter(d => calcDeviceLife(d).status === 'expire').length;
}

/* ---------- 树渲染 ---------- */
async function renderTree() {
  const bs = sortBuildings(await dbGetAll(SB)), fs = await dbGetAll(SF);
  $("building-count").innerText = `共 ${bs.length} 栋建筑`;
  $("cat-building-count").innerText = bs.length;
  const canEdit = typeof isAdmin === 'function' ? isAdmin() : true;
  let html = "";
  bs.forEach((b, bIdx) => {
    const cf = sortFloors(fs.filter(f => f.buildingId === b.id)), folded = buildingFoldState[b.id] !== false;
    const bUp = canEdit && bIdx > 0 ? `<button class="btn-up" onclick="moveBuilding('${b.id}','up',event)" title="上移">↑</button>` : '';
    const bDown = canEdit && bIdx < bs.length - 1 ? `<button class="btn-down" onclick="moveBuilding('${b.id}','down',event)" title="下移">↓</button>` : '';
    const bOps = canEdit ? `${bUp}${bDown}<button class="btn-edit" onclick="editBuilding('${b.id}')">编辑</button><button class="btn-copy" onclick="quickCopyBuilding('${b.id}')">复制</button><button class="btn-del" onclick="deleteBuilding('${b.id}')">删除</button>` : '';
    const dragAttr = canEdit ? 'draggable="true"' : '';
    html += `<div class="tree-building ${curB === b.id ? 'active' : ''}" ${dragAttr} data-type="building" data-id="${b.id}" ${canEdit ? 'ondragstart="onTreeDragStart(event)" ondragover="onTreeDragOver(event)" ondragleave="onTreeDragLeave(event)" ondrop="onTreeDrop(event)" ondragend="onTreeDragEnd(event)"' : ''}><span class="tree-arrow ${folded ? 'collapsed' : ''}" onclick="toggleBuildingFold('${b.id}')">▼</span>${canEdit ? '<span class="drag-handle" title="拖拽排序">⋮⋮</span>' : ''}<div class="tree-text" onclick="selectBuilding('${b.id}')" ondblclick="toggleBuildingFold('${b.id}')" title="单击选中，双击折叠/展开楼层">${b.name}</div><div class="tree-op">${bOps}</div></div>`;
    html += `<div class="tree-floor-wrap ${folded ? 'collapsed' : ''}">`;
    cf.forEach((f, fIdx) => {
      const fUp = canEdit && fIdx > 0 ? `<button class="btn-up" onclick="moveFloor('${b.id}','${f.id}','up',event)">↑</button>` : '';
      const fDown = canEdit && fIdx < cf.length - 1 ? `<button class="btn-down" onclick="moveFloor('${b.id}','${f.id}','down',event)">↓</button>` : '';
      const fOps = canEdit ? `${fUp}${fDown}<button class="btn-edit" onclick="editFloor('${f.id}')">编辑</button><button class="btn-copy" onclick="quickCopyFloor('${f.id}')">复制</button><button class="btn-del" onclick="deleteFloor('${f.id}')">删除</button>` : '';
      const floorDbl = canEdit ? `ondblclick="editFloor('${f.id}')"` : '';
      html += `<div class="tree-floor ${curF === f.id ? 'active' : ''}" ${dragAttr} data-type="floor" data-building="${b.id}" data-id="${f.id}" ${canEdit ? 'ondragstart="onTreeDragStart(event)" ondragover="onTreeDragOver(event)" ondragleave="onTreeDragLeave(event)" ondrop="onTreeDrop(event)" ondragend="onTreeDragEnd(event)"' : ''}><span class="drag-handle" title="拖拽排序">⋮⋮</span><div class="tree-text" onclick="selectFloor('${b.id}','${f.id}')" ${floorDbl} title="单击选中">└ ${f.floorName}</div><div class="tree-op">${fOps}</div></div>`;
    });
    html += `</div>`;
  });
  if (!bs.length) html = `<div style="padding:14px;color:#64748b;font-size:12px;text-align:center">暂无建筑<br>${canEdit ? '点击上方「新增建筑」开始' : '请联系管理员添加建筑'}</div>`;
  $("tree-container").innerHTML = html;
}
async function moveBuilding(bid, dir, ev) {
  if (ev) ev.stopPropagation();
  let bs = await dbGetAll(SB);
  bs.forEach((b, i) => { if (b.sortOrder === undefined) b.sortOrder = i; });
  bs = sortBuildings(bs);
  const idx = bs.findIndex(b => b.id === bid), t = dir === 'up' ? idx - 1 : idx + 1;
  if (t < 0 || t >= bs.length) return;
  const tmp = bs[idx].sortOrder; bs[idx].sortOrder = bs[t].sortOrder; bs[t].sortOrder = tmp;
  await dbPut(SB, bs[idx]); await dbPut(SB, bs[t]);
  renderTree(); showToast(dir === 'up' ? '建筑已上移' : '建筑已下移');
}
async function moveFloor(bid, fid, dir, ev) {
  if (ev) ev.stopPropagation();
  let fs = (await dbGetAll(SF)).filter(f => f.buildingId === bid);
  fs.forEach((f, i) => { if (f.sortOrder === undefined) f.sortOrder = i; });
  fs = sortFloors(fs);
  const idx = fs.findIndex(f => f.id === fid), t = dir === 'up' ? idx - 1 : idx + 1;
  if (t < 0 || t >= fs.length) return;
  const tmp = fs[idx].sortOrder; fs[idx].sortOrder = fs[t].sortOrder; fs[t].sortOrder = tmp;
  await dbPut(SF, fs[idx]); await dbPut(SF, fs[t]);
  renderTree(); showToast(dir === 'up' ? '楼层已上移' : '楼层已下移');
}

/* ---------- 拖拽排序 ---------- */
let dragSrcEl = null;
function onTreeDragStart(e) {
  dragSrcEl = e.currentTarget;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragSrcEl.dataset.id);
  dragSrcEl.classList.add('dragging');
  e.stopPropagation();
}
function onTreeDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.currentTarget;
  if (target === dragSrcEl) return;
  const srcType = dragSrcEl.dataset.type;
  const tgtType = target.dataset.type;
  if (srcType !== tgtType) return;
  if (srcType === 'floor' && dragSrcEl.dataset.building !== target.dataset.building) return;
  target.classList.add('drag-over');
  e.stopPropagation();
}
function onTreeDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}
async function onTreeDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget;
  target.classList.remove('drag-over');
  if (!dragSrcEl || target === dragSrcEl) return;
  const srcType = dragSrcEl.dataset.type;
  const tgtType = target.dataset.type;
  if (srcType !== tgtType) return;
  if (srcType === 'building') {
    await reorderBuildings(dragSrcEl.dataset.id, target.dataset.id);
  } else if (srcType === 'floor') {
    if (dragSrcEl.dataset.building !== target.dataset.building) return;
    await reorderFloors(dragSrcEl.dataset.building, dragSrcEl.dataset.id, target.dataset.id);
  }
}
function onTreeDragEnd(e) {
  if (dragSrcEl) dragSrcEl.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragSrcEl = null;
}
async function reorderBuildings(srcId, tgtId) {
  let bs = await dbGetAll(SB);
  bs.forEach((b, i) => { if (b.sortOrder === undefined) b.sortOrder = i; });
  bs = sortBuildings(bs);
  const srcIdx = bs.findIndex(b => b.id === srcId);
  const tgtIdx = bs.findIndex(b => b.id === tgtId);
  if (srcIdx < 0 || tgtIdx < 0) return;
  const src = bs[srcIdx];
  bs.splice(srcIdx, 1);
  bs.splice(tgtIdx, 0, src);
  bs.forEach((b, i) => { b.sortOrder = i; dbPut(SB, b); });
  renderTree();
  showToast("建筑排序已更新");
}
async function reorderFloors(bid, srcId, tgtId) {
  let fs = (await dbGetAll(SF)).filter(f => f.buildingId === bid);
  fs.forEach((f, i) => { if (f.sortOrder === undefined) f.sortOrder = i; });
  fs = sortFloors(fs);
  const srcIdx = fs.findIndex(f => f.id === srcId);
  const tgtIdx = fs.findIndex(f => f.id === tgtId);
  if (srcIdx < 0 || tgtIdx < 0) return;
  const src = fs[srcIdx];
  fs.splice(srcIdx, 1);
  fs.splice(tgtIdx, 0, src);
  fs.forEach((f, i) => { f.sortOrder = i; dbPut(SF, f); });
  renderTree();
  showToast("楼层排序已更新");
}

/* ---------- 管理模式 ---------- */
$("btn-mode").onclick = function () {
  if (typeof isAdmin === 'function' && !isAdmin()) { showToast("仅管理员可使用管理模式"); return; }
  manageMode = !manageMode;
  this.innerText = manageMode ? "🔓退出管理模式" : "🔧管理模式";
  document.body.classList.toggle("manage-mode", manageMode);
  const bgBtn = $("btn-bgimg");
  if (bgBtn) {
    bgBtn.disabled = !manageMode;
    bgBtn.style.opacity = manageMode ? "1" : "0.4";
    bgBtn.style.cursor = manageMode ? "pointer" : "not-allowed";
    bgBtn.title = manageMode ? "更换底图（保留设备位置）" : "请先开启管理模式";
  }
  const h = $("drag-hint");
  if (manageMode) { h.classList.add("show"); setTimeout(() => h.classList.remove("show"), 4000); }
  showToast(manageMode ? "已开启管理模式" : "已退出管理模式");
  // 比例尺：非管理模式自动隐藏，管理模式恢复之前状态
  const scaleEl = document.getElementById('scale-indicator');
  if (scaleEl) {
    if (manageMode) {
      if (localStorage.getItem('scale_hidden') !== '1') scaleEl.classList.remove('hidden');
    } else {
      scaleEl.classList.add('hidden');
    }
  }
  // 管理模式下禁用左键拖拽（左键用于框选），非管理模式启用
  if (map) {
    if (manageMode) map.dragging.disable();
    else map.dragging.enable();
  }
  renderDeviceMarkers();
  if (typeof refreshVectorDrag === 'function') refreshVectorDrag();
  if (typeof updateVectorToolbarVisibility === 'function') updateVectorToolbarVisibility();
  if (typeof loadVectorShapes === 'function') loadVectorShapes();
};
async function selectBuilding(id) { curB = id; curF = null; $("page-location").innerText = "请选择楼层"; saveCurrentFloor(); renderTree(); }
async function selectFloor(bid, fid) {
  curB = bid; curF = fid;
  const b = (await dbGetAll(SB)).find(x => x.id === bid), f = (await dbGetAll(SF)).find(x => x.id === fid);
  currentFloorScale = f.scale || "";
  $("page-location").innerText = `${b.name} / ${f.floorName}${currentFloorScale ? `  [${currentFloorScale}]` : ""}`;
  saveCurrentFloor();
  renderTree(); calcStat(); initMap(f.id);
}
function saveCurrentFloor() {
  try { localStorage.setItem("firemap_current", JSON.stringify({ b: curB, f: curF })); } catch (e) {}
}
async function loadCurrentFloor() {
  try {
    const s = localStorage.getItem("firemap_current");
    if (!s) return;
    const { b, f } = JSON.parse(s);
    if (b && f) {
      const bs = await dbGetAll(SB), fs = await dbGetAll(SF);
      if (bs.find(x => x.id === b) && fs.find(x => x.id === f)) {
        await selectFloor(b, f);
      }
    }
  } catch (e) {}
}

/* ---------- 设备关联数据级联删除辅助函数 ---------- */
// 收集指定设备ID列表的所有关联数据（巡检记录、维保记录、工单、表单数据、图片）
async function collectDeviceRelatedData(deviceIds) {
  const idSet = new Set(deviceIds);
  const result = { inspectLogs: [], maintainLogs: [], workOrders: [], formDataList: [], images: [] };

  const allInspectLogs = await dbGetAll(S_LOG);
  const allMaintainLogs = await dbGetAll(SL);
  const allWorkOrders = await dbGetAll(S_WORKORDER);
  const allFormData = await dbGetAll(S_FORM_DATA);
  const allImages = await dbGetAll(SIMG);

  result.inspectLogs = allInspectLogs.filter(l => idSet.has(l.deviceId || l.device_id));
  result.maintainLogs = allMaintainLogs.filter(l => idSet.has(l.deviceId || l.device_id));
  result.workOrders = allWorkOrders.filter(w => idSet.has(w.deviceId || w.device_id));
  result.formDataList = allFormData.filter(f => idSet.has(f.relatedId));

  // 收集设备图片
  const allDevices = await dbGetAll(SD);
  for (const d of allDevices) {
    if (idSet.has(d.id) && d.photoId) {
      const img = allImages.find(i => i.id === d.photoId);
      if (img) result.images.push(img);
    }
  }

  result.total = result.inspectLogs.length + result.maintainLogs.length + result.workOrders.length + result.formDataList.length;
  return result;
}

// 删除收集到的关联数据
async function deleteDeviceRelatedData(relatedData) {
  for (let l of relatedData.inspectLogs || []) await dbDel(S_LOG, l.id);
  for (let l of relatedData.maintainLogs || []) await dbDel(SL, l.id);
  for (let w of relatedData.workOrders || []) await dbDel(S_WORKORDER, w.id);
  for (let f of relatedData.formDataList || []) await dbDel(S_FORM_DATA, f.id);
  for (let img of relatedData.images || []) await deleteImage(img.id);
}

// 生成关联数据的确认提示文本
function buildRelatedDataConfirmMsg(relatedData) {
  if (!relatedData || relatedData.total === 0) return "";
  let msg = "\n\n将同时删除以下关联数据：";
  if (relatedData.inspectLogs.length > 0) msg += "\n  • 巡检记录：" + relatedData.inspectLogs.length + " 条";
  if (relatedData.maintainLogs.length > 0) msg += "\n  • 维保记录：" + relatedData.maintainLogs.length + " 条";
  if (relatedData.workOrders.length > 0) msg += "\n  • 维修工单：" + relatedData.workOrders.length + " 条";
  if (relatedData.formDataList.length > 0) msg += "\n  • 表单数据：" + relatedData.formDataList.length + " 条";
  msg += "\n\n删除后不可恢复，请确认！";
  return msg;
}

/* ---------- 建筑CRUD ---------- */
function showAddBuilding() { $("b-id").value = ""; $("b-name").value = ""; $("b-address").value = ""; $("b-remark").value = ""; openModal("modal-building"); }
async function editBuilding(id) { const b = (await dbGetAll(SB)).find(x => x.id === id); $("b-id").value = b.id; $("b-name").value = b.name; $("b-address").value = b.address || ""; $("b-remark").value = b.remark || ""; openModal("modal-building"); }
async function saveBuilding() {
  const id = $("b-id").value.trim(); let o;
  if (id) { const old = (await dbGetAll(SB)).find(x => x.id === id); o = { id, name: $("b-name").value.trim(), address: $("b-address").value.trim(), remark: $("b-remark").value.trim(), sortOrder: old.sortOrder }; }
  else { const all = sortBuildings(await dbGetAll(SB)); const maxOrder = all.length ? Math.max(...all.map(b => b.sortOrder !== undefined ? b.sortOrder : 0)) : -1; o = { id: genId(), name: $("b-name").value.trim(), address: $("b-address").value.trim(), remark: $("b-remark").value.trim(), sortOrder: maxOrder + 1 }; }
  await dbPut(SB, o); closeModal("modal-building"); renderTree(); showToast(id ? "建筑已更新" : "新增建筑成功");
}
async function deleteBuilding(id) {
  hideContextMenu();
  const b = (await dbGetAll(SB)).find(x => x.id === id);
  const df = (await dbGetAll(SF)).filter(f => f.buildingId === id);
  let allD = [];
  for (let f of df) {
    const dd = await getDevicesByFloor(f.id);
    allD.push(...dd);
  }
  // 收集所有设备的关联数据
  const deviceIds = allD.map(d => d.id);
  const relatedData = await collectDeviceRelatedData(deviceIds);
  // 收集楼层图片
  const floorImages = [];
  const allImages = await dbGetAll(SIMG);
  for (let f of df) {
    if (f.imageId) { const img = allImages.find(i => i.id === f.imageId); if (img) floorImages.push(img); }
  }
  // 确认提示
  let confirmMsg = "⚠️确定删除该建筑？\n含 " + df.length + " 个楼层、" + allD.length + " 个设备";
  confirmMsg += buildRelatedDataConfirmMsg(relatedData);
  if (!await confirmDialog(confirmMsg)) return;

  // 保存撤销数据
  pushUndo('cascade', {
    buildings: [b],
    floors: df,
    devices: allD,
    inspectLogs: relatedData.inspectLogs,
    maintainLogs: relatedData.maintainLogs,
    workOrders: relatedData.workOrders,
    formDataList: relatedData.formDataList,
    images: [...relatedData.images, ...floorImages]
  }, "建筑-" + b.name + "（含" + df.length + "层、" + allD.length + "个设备）");

  // 执行删除
  for (let f of df) {
    const dd = await getDevicesByFloor(f.id);
    for (let dev of dd) { await dbDel(SD, dev.id); if (typeof Cloud !== 'undefined' && Cloud.enabled) Cloud.deleteDevice(dev.id); }
    await dbDel(SF, f.id); if (f.imageId) await deleteImage(f.imageId);
  }
  await deleteDeviceRelatedData(relatedData);
  await dbDel(SB, id);
  if (curB === id) { curB = null; curF = null; $("page-location").innerText = "请选择建筑楼层"; if (map) { map.remove(); map = null; } }
  renderTree(); calcStat();
  showToast("建筑及下属数据已删除（含 " + relatedData.total + " 条关联记录）");
  showUndoBar("建筑-" + b.name);
}

/* ---------- 楼层CRUD（图片独立存储） ---------- */
async function showAddFloor() {
  if (!curB) { alert("请先选中左侧一个建筑，再新增楼层"); return; }
  $("f-id").value = ""; $("f-name").value = ""; $("f-img").value = null; $("f-scale").value = ""; $("floor-img-preview-wrap").innerHTML = "";
  tempFloorImgRemoved = false;
  openModal("modal-floor");
}
async function editFloor(id) {
  const f = (await dbGetAll(SF)).find(x => x.id === id);
  $("f-id").value = f.id; $("f-name").value = f.floorName; $("f-img").value = null; $("f-scale").value = f.scale || "";
  if ($("f-qr-url")) $("f-qr-url").value = f.qrUrl || "";
  tempFloorImgRemoved = false;
  let previewHtml = "";
  if (f.imageId) {
    const url = await getImage(f.imageId);
    if (url) previewHtml = `<div class="floor-img-box"><img class="preview-img" src="${url}" alt="" /><button class="floor-img-del" onclick="removeFloorImage()" title="删除图片">✕</button></div>`;
  }
  $("floor-img-preview-wrap").innerHTML = previewHtml;
  openModal("modal-floor");
  loadFloorDeviceStats(f.id);
}
// 从任意基础地址推导楼层巡检页地址：
//   device.html 结尾 → 换成 floor-inspect.html
//   纯域名/根目录   → 拼接 floor-inspect.html
//   已含 floor-inspect.html → 原样保留
function buildFloorInspectUrl(base) {
  let u = (base || "").trim();
  if (!u) return "";
  u = u.split("?")[0].split("#")[0].replace(/\/+$/, "");
  if (/floor-inspect\.html/i.test(u)) return u;
  const m = u.match(/^(.*\/)[^\/]+\.html$/i);
  if (m) return m[1] + "floor-inspect.html";
  return u + "/floor-inspect.html";
}
// 楼层二维码地址：填入全局默认地址（自动转为楼层巡检页）
function useGlobalQrUrl() {
  let cur = "";
  try { cur = localStorage.getItem("firemap_qr_baseurl") || ""; } catch(e) {}
  if (!cur) { showToast("尚未配置全局二维码地址"); return; }
  if ($("f-qr-url")) $("f-qr-url").value = buildFloorInspectUrl(cur);
  showToast("已填入楼层巡检页地址");
}
function removeFloorImage() {
  tempFloorImgRemoved = true;
  $("floor-img-preview-wrap").innerHTML = "";
  $("f-img").value = null;
  showToast("图片已标记删除，保存后生效");
}
async function quickReplaceFloorImage(e) {
  const file = e.target.files[0];
  if (!file || !curF) { e.target.value = null; return; }
  if (!manageMode) { showToast("请先开启管理模式"); e.target.value = null; return; }
  const floors = await dbGetAll(SF);
  const floor = floors.find(f => f.id === curF);
  if (!floor) { e.target.value = null; return; }
  const dataUrl = await new Promise(r => { const rd = new FileReader(); rd.onload = x => r(x.target.result); rd.readAsDataURL(file); });
  const newImgId = await saveImage(dataUrl);
  if (floor.imageId) await deleteImage(floor.imageId);
  floor.imageId = newImgId;
  await dbPut(SF, floor);
  e.target.value = null;
  await initMap(curF);
  showToast("底图已更换，设备位置不变");
}
function previewFloorImg(e) {
  const file = e.target.files[0];
  if (!file) return;
  tempFloorImgRemoved = false;
  const reader = new FileReader();
  reader.onload = ev => {
    const url = ev.target.result;
    $("floor-img-preview-wrap").innerHTML = `<div class="floor-img-box"><img class="preview-img" src="${url}" alt="" /><button class="floor-img-del" onclick="removeFloorImage()" title="删除图片">✕</button></div>`;
  };
  reader.readAsDataURL(file);
}

/* ---------- 楼层设施管理 ---------- */
async function loadFloorDeviceStats(floorId) {
  const devices = (await dbGetAll(SD)).filter(d => d.floorId === floorId);
  const typeMap = {};
  devices.forEach(d => {
    const t = (d.deviceType || '').trim() || '未知';
    typeMap[t] = (typeMap[t] || 0) + 1;
  });
  const types = Object.keys(typeMap).sort();
  // 更新统计
  const statsEl = $("floor-device-stats");
  if (devices.length === 0) {
    statsEl.innerHTML = '<span style="color:#999">当前楼层暂无设施</span>';
  } else {
    const statsHtml = types.map(t => `<span class="fdm-stat-tag">${t}: <b>${typeMap[t]}</b></span>`).join('');
    statsEl.innerHTML = `共 <b>${devices.length}</b> 个设施：` + statsHtml;
  }
  // 更新类型下拉框
  const select = $("floor-del-type");
  select.innerHTML = '<option value="">选择要删除的设施类型</option>' +
    types.map(t => `<option value="${t}">${t} (${typeMap[t]})</option>`).join('');
}
async function deleteFloorDeviceByType() {
  const type = $("floor-del-type").value;
  if (!type) { showToast("请先选择要删除的设施类型"); return; }
  const floorId = $("f-id").value;
  const allDevs = await dbGetAll(SD);
  const floorDevs = allDevs.filter(d => d.floorId === floorId);
  const typeNorm = (type || '').trim() || '未知';
  const typeDevs = floorDevs.filter(d => ((d.deviceType || '').trim() || '未知') === typeNorm);
  if (!floorId) return;
  if (typeDevs.length === 0) { showToast("没有该类型的设施"); return; }
  // 收集关联数据
  const deviceIds = typeDevs.map(d => d.id);
  const relatedData = await collectDeviceRelatedData(deviceIds);
  // 确认提示
  let confirmMsg = "确定删除当前楼层所有「" + type + "」吗？共 " + typeDevs.length + " 个，可撤销恢复。";
  confirmMsg += buildRelatedDataConfirmMsg(relatedData);
  if (!await confirmDialog(confirmMsg)) return;
  // 保存撤销数据
  pushUndo('cascade', {
    devices: JSON.parse(JSON.stringify(typeDevs)),
    inspectLogs: relatedData.inspectLogs,
    maintainLogs: relatedData.maintainLogs,
    workOrders: relatedData.workOrders,
    formDataList: relatedData.formDataList,
    images: relatedData.images
  }, "批量删除-" + type + "(" + typeDevs.length + ")");
  // 执行删除
  for (const d of typeDevs) {
    await dbDel(SD, d.id);
    if (typeof Cloud !== 'undefined' && Cloud.enabled) Cloud.deleteDevice(d.id);
  }
  await deleteDeviceRelatedData(relatedData);
  showToast("已删除 " + typeDevs.length + " 个「" + type + "」（含 " + relatedData.total + " 条关联记录）");
  showUndoBar("批量删除-" + type + "(" + typeDevs.length + ")");
  await loadFloorDeviceStats(floorId);
  if (curF === floorId && typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
  if (typeof calcStat === 'function') calcStat();
}
async function clearAllFloorDevices() {
  const floorId = $("f-id").value;
  if (!floorId) return;
  const devices = (await dbGetAll(SD)).filter(d => d.floorId === floorId);
  if (devices.length === 0) { showToast("当前楼层暂无设施"); return; }
  // 收集关联数据
  const deviceIds = devices.map(d => d.id);
  const relatedData = await collectDeviceRelatedData(deviceIds);
  // 确认提示
  let confirmMsg = "确定清除当前楼层所有设施吗？共 " + devices.length + " 个，可撤销恢复。";
  confirmMsg += buildRelatedDataConfirmMsg(relatedData);
  if (!await confirmDialog(confirmMsg)) return;
  // 保存撤销数据
  pushUndo('cascade', {
    devices: JSON.parse(JSON.stringify(devices)),
    inspectLogs: relatedData.inspectLogs,
    maintainLogs: relatedData.maintainLogs,
    workOrders: relatedData.workOrders,
    formDataList: relatedData.formDataList,
    images: relatedData.images
  }, "清除全部(" + devices.length + ")");
  // 执行删除
  for (const d of devices) {
    await dbDel(SD, d.id);
    if (typeof Cloud !== 'undefined' && Cloud.enabled) Cloud.deleteDevice(d.id);
  }
  await deleteDeviceRelatedData(relatedData);
  showToast("已清除全部 " + devices.length + " 个设施（含 " + relatedData.total + " 条关联记录）");
  showUndoBar("清除全部(" + devices.length + ")");
  await loadFloorDeviceStats(floorId);
  if (curF === floorId && typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
  if (typeof calcStat === 'function') calcStat();
}

async function clearFloorCustomStyle() {
  const floorId = $("f-id").value;
  const type = $("floor-del-type").value;
  if (!floorId) return;
  if (!type) { showToast("请先选择设施类型"); return; }
  const allDevs = await dbGetAll(SD);
  const typeNorm = (type || '').trim() || '未知';
  const typeDevs = allDevs.filter(d => d.floorId === floorId && ((d.deviceType || '').trim() || '未知') === typeNorm);
  if (typeDevs.length === 0) { showToast("没有该类型的设施"); return; }
  const customDevs = typeDevs.filter(d => d.customColor || d.customSize);
  if (customDevs.length === 0) { showToast("该类型没有独立样式"); return; }
  if (!await confirmDialog(`确定清除 ${customDevs.length} 个设备的独立样式吗？\n清除后将恢复为图例配置的样式。`)) return;
  for (const d of customDevs) {
    d.customColor = null;
    d.customSize = null;
    await dbPut(SD, d);
  }
  showToast(`已清除 ${customDevs.length} 个设备的独立样式`);
  if (curF === floorId && typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
}
async function saveFloor() {
  const id = $("f-id").value.trim();
  let imgId = null;
  const file = $("f-img").files[0];
  if (file) {
    const dataUrl = await new Promise(r => { const rd = new FileReader(); rd.onload = x => r(x.target.result); rd.readAsDataURL(file); });
    imgId = await saveImage(dataUrl);
  }
  const scale = $("f-scale").value.trim();
  const qrUrl = $("f-qr-url") ? $("f-qr-url").value.trim() : "";
  const all = await dbGetAll(SF);
  let o;
  if (id) {
    const old = all.find(x => x.id === id);
    // 如果上传了新图片，删除旧图片
    if (imgId && old.imageId) await deleteImage(old.imageId);
    // 如果标记删除图片且没有上传新图片，删除旧图片并清空
    if (tempFloorImgRemoved && !imgId && old.imageId) {
      await deleteImage(old.imageId);
      o = { id, buildingId: curB, floorName: $("f-name").value.trim(), imageId: null, scale, qrUrl, sortOrder: old.sortOrder };
    } else {
      o = { id, buildingId: curB, floorName: $("f-name").value.trim(), imageId: imgId || old.imageId, scale, qrUrl, sortOrder: old.sortOrder };
    }
  } else {
    if (!imgId) { alert("新增楼层必须上传平面图"); return; }
    const curFloors = sortFloors(all.filter(f => f.buildingId === curB));
    const maxOrder = curFloors.length ? Math.max(...curFloors.map(f => f.sortOrder !== undefined ? f.sortOrder : 0)) : -1;
    o = { id: genId(), buildingId: curB, floorName: $("f-name").value.trim(), imageId: imgId, scale, qrUrl, sortOrder: maxOrder + 1 };
  }
  tempFloorImgRemoved = false;
  await dbPut(SF, o); closeModal("modal-floor"); renderTree();
  if (curF === id) {
    currentFloorScale = scale;
    const b = (await dbGetAll(SB)).find(x => x.id === curB), f = (await dbGetAll(SF)).find(x => x.id === id);
    $("page-location").innerText = `${b.name} / ${f.floorName}${scale ? `  [${scale}]` : ""}`;
    updateScaleDisplay(); initMap(id);
  }
  showToast(id ? "楼层已更新" : "新增楼层成功");
}
async function deleteFloor(id) {
  hideContextMenu();
  const f = (await dbGetAll(SF)).find(x => x.id === id);
  const dd = await getDevicesByFloor(id);
  // 收集设备关联数据
  const deviceIds = dd.map(d => d.id);
  const relatedData = await collectDeviceRelatedData(deviceIds);
  // 收集楼层图片
  let floorImage = null;
  if (f.imageId) { const allImages = await dbGetAll(SIMG); floorImage = allImages.find(i => i.id === f.imageId); }
  // 确认提示
  let confirmMsg = "⚠️确认删除该楼层？\n含 " + dd.length + " 个设备";
  confirmMsg += buildRelatedDataConfirmMsg(relatedData);
  if (!await confirmDialog(confirmMsg)) return;

  // 保存撤销数据
  pushUndo('cascade', {
    floors: [f],
    devices: dd,
    inspectLogs: relatedData.inspectLogs,
    maintainLogs: relatedData.maintainLogs,
    workOrders: relatedData.workOrders,
    formDataList: relatedData.formDataList,
    images: floorImage ? [...relatedData.images, floorImage] : relatedData.images
  }, "楼层-" + f.floorName + "（含" + dd.length + "个设备）");

  // 执行删除
  await dbDel(SF, id);
  for (let dev of dd) { await dbDel(SD, dev.id); if (typeof Cloud !== 'undefined' && Cloud.enabled) Cloud.deleteDevice(dev.id); }
  await deleteDeviceRelatedData(relatedData);
  if (f.imageId) await deleteImage(f.imageId);
  if (curF === id) { curF = null; $("page-location").innerText = "请选择楼层"; if (map) { map.remove(); map = null; } }
  renderTree(); calcStat();
  showToast("楼层及下属数据已删除（含 " + relatedData.total + " 条关联记录）");
  showUndoBar("楼层-" + f.floorName);
}

/* ---------- 设备CRUD（照片独立存储） ---------- */
$("dev-photo-file").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  tempPhoto = await new Promise(r => { const rd = new FileReader(); rd.onload = x => r(x.target.result); rd.readAsDataURL(f); });
  $("dev-photo-preview").src = tempPhoto; $("dev-photo-wrap").style.setProperty("display", "block", "important");
};
function clearDevicePhoto() { tempPhoto = ""; $("dev-photo-preview").src = ""; $("dev-photo-file").value = ""; $("dev-photo-wrap").style.setProperty("display", "none", "important"); showToast("已删除图片"); }
function onDeviceCustomIcon(input) {
  const f = input.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = e => {
    tempCustomIcon = e.target.result;
    $("dev-custom-icon-preview").src = tempCustomIcon;
    $("dev-custom-icon-wrap").style.setProperty("display", "block", "important");
    $("dev-icon-custom").checked = true;
    updateDevStylePreview();
    showToast("自定义图标已设置");
  };
  reader.readAsDataURL(f);
}
function clearDeviceCustomIcon() {
  tempCustomIcon = "";
  $("dev-custom-icon-preview").src = "";
  $("dev-custom-icon-file").value = "";
  $("dev-custom-icon-wrap").style.setProperty("display", "none", "important");
  $("dev-icon-default").checked = true;
  updateDevStylePreview();
  showToast("已清除自定义图标，恢复默认图例");
}

function toggleDeviceCustomColor() {
  const cb = $("dev-use-custom-color");
  const input = $("dev-custom-color");
  input.disabled = !cb.checked;
  updateDevStylePreview();
}
function toggleDeviceCustomSize() {
  const cb = $("dev-use-custom-size");
  const input = $("dev-custom-size");
  const numInput = $("dev-custom-size-num");
  input.disabled = !cb.checked;
  if (numInput) numInput.disabled = !cb.checked;
  updateDevStylePreview();
}
function syncDeviceSizeInput(val) {
  const numInput = $("dev-custom-size-num");
  if (numInput) numInput.value = val;
  updateDevStylePreview();
}
function syncDeviceSizeSlider(val) {
  const slider = $("dev-custom-size");
  let v = parseInt(val);
  if (isNaN(v)) v = 32;
  v = Math.max(4, Math.min(120, v));
  if (slider) slider.value = v;
  updateDevStylePreview();
}

function setDeviceColor(color) {
  const cb = $("dev-use-custom-color");
  const input = $("dev-custom-color");
  if (!cb.checked) { cb.checked = true; input.disabled = false; }
  input.value = color;
  updateDevStylePreview();
}
function updateDevStylePreview() {
  const preview = $("dev-style-preview");
  if (!preview) return;
  const useColor = $("dev-use-custom-color")?.checked;
  const useSize = $("dev-use-custom-size")?.checked;
  const color = useColor ? $("dev-custom-color").value : "#888";
  const size = useSize ? parseInt($("dev-custom-size").value) : 32;
  if (useSize) { $("dev-custom-size").value = size; if ($("dev-custom-size-num")) $("dev-custom-size-num").value = size; }
  const displaySize = Math.min(size, 48);
  preview.style.width = displaySize + "px";
  preview.style.height = displaySize + "px";
  // 如果有自定义图片，显示图片；否则显示圆形色块
  if (tempCustomIcon) {
    preview.style.background = `url(${tempCustomIcon}) center/contain no-repeat`;
    preview.style.borderRadius = "0";
    preview.style.border = "none";
    preview.style.boxShadow = "none";
  } else {
    preview.style.background = color;
    preview.style.borderRadius = "50%";
    preview.style.border = "2px solid #fff";
    preview.style.boxShadow = "0 1px 4px #0004";
  }
}

function switchIconSource(source) {
  const uploadBtn = $("dev-upload-icon-btn");
  const customWrap = $("dev-custom-icon-wrap");
  if (source === 'custom') {
    uploadBtn.style.display = "inline-block";
    if (tempCustomIcon) customWrap.style.setProperty("display", "block", "important");
  } else {
    uploadBtn.style.display = "none";
    customWrap.style.setProperty("display", "none", "important");
  }
  updateDevStylePreview();
}
async function clearDeviceIconStyle() {
  // 清除自定义图片
  tempCustomIcon = "";
  $("dev-custom-icon-preview").src = "";
  $("dev-custom-icon-file").value = "";
  $("dev-custom-icon-wrap").style.setProperty("display", "none", "important");
  $("dev-icon-default").checked = true;
  $("dev-upload-icon-btn").style.display = "none";
  // 清除独立颜色
  $("dev-use-custom-color").checked = false;
  $("dev-custom-color").disabled = true;
  // 清除独立大小
  $("dev-use-custom-size").checked = false;
  $("dev-custom-size").disabled = true;
  updateDevStylePreview();
  // 如果是编辑已有设备，立即保存
  const devId = $("dev-id").value;
  if (devId) {
    const d = (await dbGetAll(SD)).find(x => x.id === devId);
    if (d) {
      d.customIcon = null;
      d.customColor = null;
      d.customSize = null;
      await dbPut(SD, d);
      if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
      showToast("已清除全部图标样式，恢复为图例配置");
      return;
    }
  }
  showToast("已清除全部图标样式，保存后生效");
}
async function clearDeviceCustomStyle() {
  $("dev-use-custom-color").checked = false;
  $("dev-custom-color").disabled = true;
  $("dev-use-custom-size").checked = false;
  $("dev-custom-size").disabled = true;
  updateDevStylePreview();
  // 如果是编辑已有设备，立即保存并重新渲染
  const devId = $("dev-id").value;
  if (devId) {
    const d = (await dbGetAll(SD)).find(x => x.id === devId);
    if (d) {
      d.customColor = null;
      d.customSize = null;
      await dbPut(SD, d);
      if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
      showToast("已清除独立样式，恢复为图例配置");
      return;
    }
  }
  showToast("已清除独立样式，保存后生效");
}
// 设备字段映射：[数据库字段, DOM ID, 默认值]
const DEVICE_FIELD_MAP = [
  ['deviceCode', 'dev-code', ''],
  ['positionDesc', 'dev-pos-desc', ''],
  ['installDate', 'dev-install', ''],
  ['lifeYears', 'dev-life', ''],
  ['nextMaintain', 'dev-next', ''],
  ['status', 'dev-status', '正常'],
  ['remark', 'dev-remark', ''],
  ['manufacturer', 'dev-manufacturer', ''],
  ['model', 'dev-model', ''],
  ['person', 'dev-person', ''],
  ['phone', 'dev-phone', '']
];

async function openDeviceModal(id, x, y) {
  if (map) map.closePopup(); openModal("modal-device");
  tempPhoto = ""; $("dev-photo-preview").src = ""; $("dev-photo-file").value = null; $("dev-photo-wrap").style.setProperty("display", "none", "important"); tempCustomIcon = ""; $("dev-custom-icon-preview").src = ""; $("dev-custom-icon-file").value = null; $("dev-custom-icon-wrap").style.setProperty("display", "none", "important"); if($("dev-icon-default")){$("dev-icon-default").checked=true;$("dev-upload-icon-btn").style.display="none"} if($("dev-use-custom-color")){$("dev-use-custom-color").checked=false;$("dev-custom-color").disabled=true;$("dev-custom-color").value="#ff0000"} if($("dev-use-custom-size")){$("dev-use-custom-size").checked=false;$("dev-custom-size").disabled=true;$("dev-custom-size").value=32;if($("dev-custom-size-num")){$("dev-custom-size-num").disabled=true;$("dev-custom-size-num").value=32}}
  if (!id) {
    $("dev-id").value = ""; $("dev-x").value = x; $("dev-y").value = y;
    DEVICE_FIELD_MAP.forEach(([, domId, def]) => { const el = $(domId); if (el) el.value = def; });
    customFieldValues = {};
  } else {
    const d = (await dbGetAll(SD)).find(i => i.id === id);
    if (!d) { showToast("设备不存在"); closeModal("modal-device"); return; }
    $("dev-id").value = d.id; $("dev-type").value = d.deviceType;
    DEVICE_FIELD_MAP.forEach(([key, domId, def]) => { const el = $(domId); if (el) el.value = d[key] != null ? d[key] : def; });
    customFieldValues = d.customFields || {};
    $("dev-x").value = d.posX; $("dev-y").value = d.posY;
    if (d.photoId) { const url = await getImage(d.photoId); if (url) { tempPhoto = url; $("dev-photo-preview").src = url; $("dev-photo-wrap").style.setProperty("display", "block", "important"); } }
    if (d.customIcon) {
      tempCustomIcon = d.customIcon;
      $("dev-custom-icon-preview").src = d.customIcon;
      $("dev-custom-icon-wrap").style.setProperty("display", "block", "important");
      $("dev-icon-custom").checked = true;
      $("dev-upload-icon-btn").style.display = "inline-block";
    } else {
      $("dev-icon-default").checked = true;
      $("dev-upload-icon-btn").style.display = "none";
    }
    if (d.customColor) { $("dev-use-custom-color").checked=true; $("dev-custom-color").disabled=false; $("dev-custom-color").value=d.customColor; }
    if (d.customSize) { $("dev-use-custom-size").checked=true; $("dev-custom-size").disabled=false; $("dev-custom-size").value=d.customSize; if ($("dev-custom-size-num")) { $("dev-custom-size-num").disabled=false; $("dev-custom-size-num").value=d.customSize; } }
    updateDevStylePreview();
  }
  applyFieldConfig();
  // 管理模式下显示自定义字段按钮
  const btn = document.getElementById("btn-field-config");
  if (btn) btn.style.display = (typeof manageMode !== "undefined" && manageMode) ? "inline-block" : "none";
  // 刷新关联表单状态条
  updateDevFormLinkStatus();
  // 生成二维码
  genDeviceQR();
}

// 更新设备编辑弹窗的"当前关联表单"状态条
async function updateDevFormLinkStatus() {
  const statusEl = document.getElementById("dev-form-link-status");
  if (!statusEl) return;
  const textEl = document.getElementById("dev-form-link-status-text");
  const addBtn = document.getElementById("dev-form-link-add-btn");
  const modifyBtn = document.getElementById("dev-form-link-modify-btn");
  const cancelBtn = document.getElementById("dev-form-link-cancel-btn");
  const iconEl = document.getElementById("dev-form-link-status-icon");
  const devId = document.getElementById("dev-id").value.trim();
  if (!devId) { textEl.textContent = "未关联巡检表单（保存设备后可关联）"; iconEl.textContent = "📋"; addBtn.style.display = ""; modifyBtn.style.display = "none"; cancelBtn.style.display = "none"; return; }
  const dev = (await dbGetAll(SD)).find(d => d.id === devId);
  if (!dev || !dev.inspectFormId) {
    textEl.textContent = "未关联巡检表单"; iconEl.textContent = "📋";
    addBtn.style.display = ""; modifyBtn.style.display = "none"; cancelBtn.style.display = "none";
    return;
  }
  const forms = await dbGetAll(S_FORM);
  const form = forms.find(f => f.id === dev.inspectFormId);
  textEl.textContent = "已关联表单：" + (form ? form.name : '（表单已删除）');
  iconEl.textContent = "✅";
  addBtn.style.display = "none"; modifyBtn.style.display = ""; cancelBtn.style.display = "";
}

// 取消当前设备的表单关联
async function clearDeviceFormLink() {
  const devId = document.getElementById("dev-id").value.trim();
  if (!devId) return;
  if (!confirm("确定取消该设备的巡检表单关联吗？\n（仅取消当前设备，不影响其他设备）")) return;
  const dev = (await dbGetAll(SD)).find(d => d.id === devId);
  if (!dev) return;
  dev.inspectFormId = "";
  await dbPut(SD, dev);
  updateDevFormLinkStatus();
  showToast("已取消关联");
}

// 设置设备关联的巡检表单（扫码时自动加载）
async function openDeviceFormLink() {
  const devId = document.getElementById("dev-id").value.trim();
  if (!devId) { showToast("请先保存设备"); return; }
  const dev = (await dbGetAll(SD)).find(d => d.id === devId);
  if (!dev) { showToast("设备不存在"); return; }

  const forms = await dbGetAll(S_FORM);
  let options = '<option value="">不关联表单（扫码后仅打卡）</option>';
  forms.forEach(f => {
    const selected = f.id === dev.inspectFormId ? 'selected' : '';
    options += '<option value="' + f.id + '" ' + selected + '>' + (f.name || '未命名表单') + '</option>';
  });

  // 获取建筑信息
  const floors = await dbGetAll(SF);
  const buildings = await dbGetAll(SB);
  const devFloor = floors.find(f => f.id === dev.floorId);
  const devBuilding = buildings.find(b => b.id === devFloor?.buildingId);
  const buildingName = devBuilding?.name || '未知建筑';

  // 统计各类范围设备数量
  const allDevs = await dbGetAll(SD);
  const sameTypeCount = allDevs.filter(d => d.deviceType === dev.deviceType).length;
  const sameFloorTypeCount = allDevs.filter(d => d.floorId === dev.floorId && d.deviceType === dev.deviceType).length;
  const sameBuildingTypeCount = allDevs.filter(d => {
    const f = floors.find(fl => fl.id === d.floorId);
    return f?.buildingId === devFloor?.buildingId && d.deviceType === dev.deviceType;
  }).length;
  const sameBuildingCount = allDevs.filter(d => {
    const f = floors.find(fl => fl.id === d.floorId);
    return f?.buildingId === devFloor?.buildingId;
  }).length;

  // 美化的范围选项（2列网格布局）
  const scopeOptions = [
    { value: 'current', label: '仅当前设备', count: 1, icon: '🎯' },
    { value: 'type', label: '同类型设备', count: sameTypeCount, icon: '📦' },
    { value: 'floor', label: '同层同类型', count: sameFloorTypeCount, icon: '🏢' },
    { value: 'buildingType', label: buildingName + '同类型', count: sameBuildingTypeCount, icon: '🏫' },
    { value: 'building', label: buildingName + '全部', count: sameBuildingCount, icon: '🏛️' },
    { value: 'all', label: '全部设备', count: allDevs.length, icon: '🌐' }
  ];

  let scopeHtml = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">';
  scopeOptions.forEach((opt, idx) => {
    const checked = idx === 0 ? 'checked' : '';
    scopeHtml += '<label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 8px;border:2px solid #e5e7eb;border-radius:10px;cursor:pointer;background:#f9fafb;transition:all .15s;text-align:center" onmouseover="this.style.borderColor=\'#8b5cf6\';this.style.background=\'#f5f3ff\'" onmouseout="if(!this.querySelector(\'input\').checked){this.style.borderColor=\'#e5e7eb\';this.style.background=\'#f9fafb\'}">' +
      '<input type="radio" name="link-scope" value="' + opt.value + '" ' + checked + ' style="display:none" onchange="this.closest(\'label\').style.borderColor=\'#8b5cf6\';this.closest(\'label\').style.background=\'#f5f3ff\';document.querySelectorAll(\'input[name=link-scope]\').forEach(r=>{if(!r.checked){r.closest(\'label\').style.borderColor=\'#e5e7eb\';r.closest(\'label\').style.background=\'#f9fafb\'}});updateLinkScopePreview()">' +
      '<span style="font-size:20px">' + opt.icon + '</span>' +
      '<span style="font-size:12px;font-weight:600;color:#374151;line-height:1.3">' + opt.label + '</span>' +
      '<span style="font-size:11px;color:#8b5cf6;font-weight:600">' + opt.count + '个</span>' +
      '</label>';
  });
  scopeHtml += '</div>';

  const html = '<div style="padding:20px;display:flex;gap:0">' +
    '<div style="flex:1;min-width:0;padding-right:18px">' +
    '<div style="font-size:16px;font-weight:700;margin-bottom:8px;background:linear-gradient(135deg,#8b5cf6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent">📋 设置关联巡检表单</div>' +
    '<div style="font-size:12px;color:#6b7280;margin-bottom:14px;line-height:1.6">设置后，巡检员用手机扫码设备时，会自动显示此表单供填写。</div>' +
    '<div style="position:relative;margin-bottom:16px">' +
    '<select id="link-form-select" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;background:#fff;appearance:none;cursor:pointer">' + options + '</select>' +
    '<span style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#9ca3af;pointer-events:none">▾</span>' +
    '</div>' +
    '<div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:10px">应用范围：</div>' +
    scopeHtml +
    '<div style="display:flex;gap:10px;justify-content:flex-end;padding-top:4px;border-top:1px solid #f3f4f6">' +
    '<button onclick="closeModal(\'modal-form-link\')" style="padding:9px 20px;border:1px solid #d1d5db;background:#fff;border-radius:8px;cursor:pointer;font-size:13px;color:#374151;transition:all .15s" onmouseover="this.style.background=\'#f9fafb\'" onmouseout="this.style.background=\'#fff\'">取消</button>' +
    '<button onclick="saveDeviceFormLink()" style="padding:9px 24px;border:none;background:linear-gradient(135deg,#8b5cf6,#6366f1);color:#fff;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;box-shadow:0 2px 8px rgba(139,92,246,0.3)" onmouseover="this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 4px 12px rgba(139,92,246,0.4)\'" onmouseout="this.style.transform=\'translateY(0)\';this.style.boxShadow=\'0 2px 8px rgba(139,92,246,0.3)\'">保存</button>' +
    '</div>' +
    '</div>' +
    '<div style="width:300px;flex-shrink:0;border-left:1px solid #e5e7eb;padding-left:18px">' +
    '<div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:10px">📊 关联明细</div>' +
    '<div id="link-result-panel" style="max-height:460px;overflow-y:auto">' +
    '<div style="font-size:12px;color:#9ca3af;text-align:center;padding:40px 10px;border:1px dashed #e5e7eb;border-radius:10px;line-height:1.8">选择应用范围后<br>此处显示将影响的设备明细</div>' +
    '</div>' +
    '</div>' +
    '</div>';

  // 缓存数据供范围预览与结果面板使用
  window._linkFormData = { allDevs: allDevs, floors: floors, buildings: buildings, dev: dev, devFloor: devFloor, devBuilding: devBuilding, scopeOptions: scopeOptions };

  // 创建临时弹窗
  let modal = document.getElementById("modal-form-link");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-form-link";
    modal.className = "modal hidden";
    modal.innerHTML = '<div class="modal-box" style="max-width:760px;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.15)">' + html + '</div>';
    document.body.appendChild(modal);
  } else {
    modal.querySelector(".modal-box").innerHTML = html;
  }
  openModal("modal-form-link");
  // 触发一次默认范围（仅当前设备）的预览
  setTimeout(updateLinkScopePreview, 0);
}

// 计算指定范围命中的设备列表（与保存逻辑一致）
function getLinkScopeDevs(scope) {
  const data = window._linkFormData;
  if (!data) return [];
  const { allDevs, floors, dev, devFloor } = data;
  if (scope === 'current') return [dev];
  if (scope === 'type') return allDevs.filter(d => d.deviceType === dev.deviceType);
  if (scope === 'floor') return allDevs.filter(d => d.floorId === dev.floorId && d.deviceType === dev.deviceType);
  if (scope === 'buildingType') return allDevs.filter(d => {
    const f = floors.find(fl => fl.id === d.floorId);
    return f?.buildingId === devFloor?.buildingId && d.deviceType === dev.deviceType;
  });
  if (scope === 'building') return allDevs.filter(d => {
    const f = floors.find(fl => fl.id === d.floorId);
    return f?.buildingId === devFloor?.buildingId;
  });
  if (scope === 'all') return allDevs;
  return [];
}

// 按建筑/楼层分组设备列表，生成明细HTML（用于预览与结果面板）
function buildDevGroupHTML(devs) {
  const data = window._linkFormData || {};
  const floors = data.floors || [];
  const buildings = data.buildings || [];
  const groupMap = {};
  devs.forEach(d => {
    const f = floors.find(fl => fl.id === d.floorId);
    const b = buildings.find(bb => bb.id === f?.buildingId);
    const key = (b?.name || '未知建筑') + '|' + (f?.floorName || '未知楼层');
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(d);
  });
  let html = '';
  const keys = Object.keys(groupMap);
  keys.forEach((key, gi) => {
    const [bn, fn] = key.split('|');
    html += '<div style="margin-bottom:' + (gi < keys.length - 1 ? '8px' : '0') + '">';
    html += '<div style="font-size:11px;font-weight:600;color:#6d28d9;margin-bottom:3px">🏢 ' + bn + ' · ' + fn + '（' + groupMap[key].length + '台）</div>';
    const MAX = 6;
    const items = groupMap[key].slice(0, MAX);
    items.forEach(d => {
      html += '<div style="font-size:11px;color:#4b5563;padding:2px 0 2px 10px;border-left:2px solid #e9d5ff;margin-left:4px">' +
        (d.deviceType || '未知类型') + ' · ' + (d.deviceCode || '无编号') +
        (d.posDesc ? '（' + d.posDesc + '）' : '') + '</div>';
    });
    if (groupMap[key].length > MAX) {
      html += '<div style="font-size:11px;color:#9ca3af;padding-left:10px;margin-left:4px">……等 ' + groupMap[key].length + ' 台</div>';
    }
    html += '</div>';
  });
  return html;
}

// 范围选择时实时预览受影响设备（渲染到右侧明细面板）
function updateLinkScopePreview() {
  const sel = document.querySelector('input[name="link-scope"]:checked');
  const panel = document.getElementById("link-result-panel");
  if (!sel || !panel) return;
  const devs = getLinkScopeDevs(sel.value);
  if (!devs.length) {
    panel.innerHTML = '<div style="font-size:12px;color:#9ca3af;text-align:center;padding:30px 10px;border:1px dashed #e5e7eb;border-radius:10px;line-height:1.8">当前范围没有设备</div>';
    return;
  }
  let html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
    '<span style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#a78bfa,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;flex-shrink:0">👀</span>' +
    '<span style="font-size:12px;font-weight:600;color:#4c1d95">将影响 <span style="font-size:14px">' + devs.length + '</span> 台设备</span>' +
    '</div>';
  html += '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px">' +
    buildDevGroupHTML(devs) +
    '</div>';
  panel.innerHTML = html;
}

// 保存设备关联表单（支持批量）
async function saveDeviceFormLink() {
  const devId = document.getElementById("dev-id").value.trim();
  const formId = document.getElementById("link-form-select").value;
  const scope = document.querySelector('input[name="link-scope"]:checked').value;

  const dev = (await dbGetAll(SD)).find(d => d.id === devId);
  if (!dev) return;

  const allDevs = await dbGetAll(SD);
  const floors = await dbGetAll(SF);
  const devFloor = floors.find(f => f.id === dev.floorId);
  let targetDevs = [];

  if (scope === 'current') {
    targetDevs = [dev];
  } else if (scope === 'type') {
    targetDevs = allDevs.filter(d => d.deviceType === dev.deviceType);
  } else if (scope === 'floor') {
    targetDevs = allDevs.filter(d => d.floorId === dev.floorId && d.deviceType === dev.deviceType);
  } else if (scope === 'buildingType') {
    targetDevs = allDevs.filter(d => {
      const f = floors.find(fl => fl.id === d.floorId);
      return f?.buildingId === devFloor?.buildingId && d.deviceType === dev.deviceType;
    });
  } else if (scope === 'building') {
    targetDevs = allDevs.filter(d => {
      const f = floors.find(fl => fl.id === d.floorId);
      return f?.buildingId === devFloor?.buildingId;
    });
  } else if (scope === 'all') {
    targetDevs = allDevs;
  }

  const count = targetDevs.length;
  const cloudEnabled = (typeof Cloud !== 'undefined' && Cloud.enabled);

  // 先更新所有设备的inspectFormId
  targetDevs.forEach(d => { d.inspectFormId = formId; });

  // 批量写入本地（一个事务，比循环dbPut快10倍以上）
  await dbBulkPut(SD, targetDevs);

  // 批量同步云端（一次网络请求，比循环syncDevice快很多）
  let syncOk = true;
  if (cloudEnabled) {
    syncOk = await Cloud.syncDevices(targetDevs);
  }

  const scopeText = { current: '当前设备', type: '同类型设备', floor: '同层同类型设备', buildingType: '同建筑同类型设备', building: '同建筑设备', all: '全部设备' }[scope] || scope;
  let warn = "";
  if (!cloudEnabled) {
    warn = "（云端未启用，扫码页面看不到，请先配置Supabase并同步数据）";
  } else if (!syncOk) {
    warn = "（同步云端失败，请点击「同步到云端」重试）";
  }
  // 刷新设备编辑弹窗状态条
  updateDevFormLinkStatus();
  if (formId) {
    // 有关联：结果渲染到弹窗右侧面板
    const forms = await dbGetAll(S_FORM);
    const form = forms.find(f => f.id === formId);
    renderLinkResultPanel(form ? form.name : '未命名表单', scopeText, targetDevs, count, warn);
  } else {
    // 取消关联：右侧面板显示取消结果
    renderLinkResultPanel('', scopeText, targetDevs, count, warn, true);
  }
}

// 关联结果渲染到弹窗右侧面板
function renderLinkResultPanel(formName, scopeText, devs, count, warn, isCancel) {
  const panel = document.getElementById("link-result-panel");
  if (!panel) return;
  let body;
  if (isCancel) {
    body = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
      '<span style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#fbbf24,#f59e0b);display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;flex-shrink:0">✕</span>' +
      '<div><div style="font-size:15px;font-weight:700;color:#92400e">已取消关联</div>' +
      '<div style="font-size:11px;color:#6b7280;margin-top:1px">已为 ' + count + ' 个' + scopeText + '解除表单关联</div></div>' +
      '</div>' +
      '<div style="font-size:12px;color:#9ca3af;text-align:center;padding:30px 10px;border:1px dashed #e5e7eb;border-radius:10px;line-height:1.8">这些设备扫码后将不再加载表单<br>如需重新关联，请在左侧重新设置</div>';
  } else {
    body = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
      '<span style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#34d399,#10b981);display:flex;align-items:center;justify-content:center;font-size:17px;color:#fff;flex-shrink:0">✓</span>' +
      '<div><div style="font-size:15px;font-weight:700;color:#065f46">关联成功</div>' +
      '<div style="font-size:11px;color:#6b7280;margin-top:1px">扫码设备二维码即可加载并填写此表单</div></div>' +
      '</div>' +
      '<div style="background:linear-gradient(135deg,#f0fdf4,#eff6ff);border:1px solid #d1fae5;border-radius:10px;padding:10px 12px;margin-bottom:10px">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:11px;color:#6b7280">关联表单</span><span style="font-size:12px;font-weight:600;color:#065f46">📋 ' + formName + '</span></div>' +
      '<div style="display:flex;justify-content:space-between"><span style="font-size:11px;color:#6b7280">应用范围</span><span style="font-size:12px;font-weight:600;color:#374151">' + scopeText + '</span></div>' +
      '</div>' +
      '<div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:6px">本次共关联 <span style="color:#10b981;font-size:13px">' + count + '</span> 台设备：</div>' +
      '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px">' +
      buildDevGroupHTML(devs) +
      '</div>' +
      (warn ? '<div style="font-size:11px;color:#f59e0b;margin-top:8px">⚠️ ' + warn + '</div>' : '');
  }
  panel.innerHTML = body;
}
async function openDeviceModalById(id) { if (map) map.closePopup(); const d = (await dbGetAll(SD)).find(i => i.id === id); if (d) openDeviceModal(d.id, d.posX, d.posY); }
function openMaintainLogModal() {
  const devId = $("dev-id").value;
  if (!devId) { alert("请先保存设施基础信息，再新增维保记录"); return; }
  $("log-dev-id").value = devId; $("log-date").value = new Date().toISOString().split("T")[0];
  $("log-person").value = ""; $("log-result").value = "正常维护完成"; $("log-remark").value = "";
  openModal("modal-maintain");
}
async function saveMaintainLog() {
  const o = { id: genId(), deviceId: $("log-dev-id").value, logDate: $("log-date").value, person: $("log-person").value.trim(), result: $("log-result").value, remark: $("log-remark").value.trim() };
  await dbPut(SL, o); closeModal("modal-maintain"); calcStat(); renderDeviceMarkers(); showToast("维保记录保存成功");
}
function collectCustomFieldValues() {
  const vals = {};
  fieldConfig.filter(f => f.custom && f.visible).forEach(f => {
    const el = document.getElementById("custom-" + f.key);
    if (el) vals[f.key] = el.value;
  });
  return vals;
}
async function saveDevice() {
  const id = $("dev-id").value.trim();
  let photoId = null;
  if (tempPhoto) {
    const old = id ? (await dbGetAll(SD)).find(i => i.id === id) : null;
    photoId = await saveImage(tempPhoto);
    if (old && old.photoId) await deleteImage(old.photoId);
  } else if (id) {
    const old = (await dbGetAll(SD)).find(i => i.id === id);
    if (old && old.photoId) { await deleteImage(old.photoId); }
  }
  const o = {
    id: id || genId(), floorId: curF, deviceType: $("dev-type").value,
    posX: parseFloat($("dev-x").value), posY: parseFloat($("dev-y").value),
    lifeYears: parseInt($("dev-life").value) || 0,
    status: $("dev-status").value,
    photoId: photoId || (id ? ((await dbGetAll(SD)).find(i => i.id === id)?.photoId) : null),
    customFields: collectCustomFieldValues(),
    customIcon: tempCustomIcon || null,
    customColor: $("dev-use-custom-color").checked ? $("dev-custom-color").value : null,
    customSize: $("dev-use-custom-size").checked ? parseInt($("dev-custom-size").value) : null,
    inspectFormId: $("dev-inspect-form") ? $("dev-inspect-form").value : ""
  };
  DEVICE_FIELD_MAP.forEach(([key, domId]) => {
    const el = $(domId);
    if (!el) return;
    if (key === 'lifeYears') return;
    o[key] = ['deviceCode', 'positionDesc', 'remark', 'manufacturer', 'model', 'person', 'phone'].includes(key) ? el.value.trim() : el.value;
  });
  await dbPut(SD, o);
  // 同步到云端
  if (typeof Cloud !== 'undefined' && Cloud.enabled) Cloud.syncDevice(o);
  closeModal("modal-device"); renderDeviceMarkers(); calcStat(); showToast(id ? "设施更新成功" : "新增设施成功");
}
async function delDevice() {
  const id = $("dev-id").value.trim();
  if (!id) return closeModal("modal-device");
  const d = (await dbGetAll(SD)).find(i => i.id === id);
  if (!d) return;

  // 统计所有关联数据
  const allInspectLogs = await dbGetAll(S_LOG);
  const inspectLogs = allInspectLogs.filter(l => (l.deviceId || l.device_id) === id);
  const allMaintainLogs = await dbGetAll(SL);
  const maintainLogs = allMaintainLogs.filter(l => (l.deviceId || l.device_id) === id);
  const allWorkOrders = await dbGetAll(S_WORKORDER);
  const workOrders = allWorkOrders.filter(w => (w.deviceId || w.device_id) === id);
  const allFormData = await dbGetAll(S_FORM_DATA);
  const formDataList = allFormData.filter(f => f.relatedId === id);

  const totalRelated = inspectLogs.length + maintainLogs.length + workOrders.length + formDataList.length;

  // 删除确认提示
  let confirmMsg = "⚠️确认删除该设施点位？";
  if (totalRelated > 0) {
    confirmMsg += "\n\n将同时删除以下关联数据：";
    if (inspectLogs.length > 0) confirmMsg += "\n  • 巡检记录：" + inspectLogs.length + " 条";
    if (maintainLogs.length > 0) confirmMsg += "\n  • 维保记录：" + maintainLogs.length + " 条";
    if (workOrders.length > 0) confirmMsg += "\n  • 维修工单：" + workOrders.length + " 条";
    if (formDataList.length > 0) confirmMsg += "\n  • 表单数据：" + formDataList.length + " 条";
    confirmMsg += "\n\n删除后不可恢复，请确认！";
  }
  if (!await confirmDialog(confirmMsg)) return;

  const images = [];
  if (d.photoId) { const img = (await dbGetAll(SIMG)).find(i => i.id === d.photoId); if (img) images.push(img); }

  // 保存撤销数据
  pushUndo('cascade', {
    devices: [d],
    inspectLogs: inspectLogs,
    maintainLogs: maintainLogs,
    workOrders: workOrders,
    formDataList: formDataList,
    images: images
  }, "设备-" + d.deviceType + " " + (d.deviceCode || '未编号'));

  // 删除设备
  await dbDel(SD, id);
  if (typeof Cloud !== 'undefined' && Cloud.enabled) Cloud.deleteDevice(id);

  // 级联删除关联数据
  for (let l of inspectLogs) await dbDel(S_LOG, l.id);
  for (let l of maintainLogs) await dbDel(SL, l.id);
  for (let w of workOrders) await dbDel(S_WORKORDER, w.id);
  for (let f of formDataList) await dbDel(S_FORM_DATA, f.id);
  if (d.photoId) await deleteImage(d.photoId);

  closeModal("modal-device"); clearSelectedMarker(); renderDeviceMarkers(); calcStat();
  showToast("设施已删除（含 " + totalRelated + " 条关联数据）");
  showUndoBar("设备-" + d.deviceType + " " + (d.deviceCode || '未编号'));
}

/* ---------- 全局刷新 ---------- */
async function refreshAll() { await initDevTypeSelect(); renderAllLegend(); renderTree(); renderDeviceMarkers(); calcStat(); }


/* ---------- 待定位设备 ---------- */
let placingDeviceId = null;
async function renderPendingList() {
  const body = $("pending-body");
  const countEl = $("pending-count");
  if (!body || !countEl) return;
  if (!curF) { body.innerHTML = '<div style="padding:12px;color:#999;font-size:12px;text-align:center">请先选择楼层</div>'; countEl.innerText = "0"; return; }
  const all = await dbGetAll(SD);
  const pending = all.filter(d => d.floorId === curF && d.pending);
  countEl.innerText = pending.length;
  const badge = $("pending-badge"); if (badge) badge.innerText = pending.length;
  if (!pending.length) { body.innerHTML = '<div style="padding:12px;color:#999;font-size:12px;text-align:center">暂无待定位设备</div>'; return; }
  let html = "";
  for (const d of pending) {
    const leg = (await getAllLegend()).find(l => l.name === d.deviceType);
    const color = leg ? leg.color : "#888";
    html += '<div class="pending-item' + (placingDeviceId === d.id ? ' pending-placing' : '') + '" ondblclick="deletePendingDevice(\'' + d.id + '\', event)" title="双击删除">';
    html += '<div class="pending-dot" style="background:' + color + '" onclick="startPlacingDevice(\'' + d.id + '\')"></div>';
    html += '<div class="pending-info" onclick="startPlacingDevice(\'' + d.id + '\')"><div class="pending-type">' + d.deviceType + (d.deviceCode ? ' ' + d.deviceCode : '') + '</div>';
    html += '<div class="pending-code">' + (d.positionDesc || '未填写位置描述') + '</div></div>';
    html += '<button class="pending-del-btn" onclick="deletePendingDevice(\'' + d.id + '\', event)" title="删除">×</button></div>';
  }
  body.innerHTML = html;
}
function togglePendingPanel() {
  if (!manageMode) { showToast("请先开启管理模式"); return; }
  const p = $("pending-panel");
  if (!p) return;
  const hidden = p.style.display === "none";
  p.style.display = hidden ? "" : "none";
  const toggle = $("pending-toggle");
  if (toggle) toggle.innerText = hidden ? "—" : "+";
  try { localStorage.setItem("firemap_pending_panel", hidden ? "1" : "0"); } catch(e) {}
}
function initPendingPanelState() {
  const p = $("pending-panel");
  if (!p) return;
  let visible = false;
  try { visible = localStorage.getItem("firemap_pending_panel") === "1"; } catch(e) {}
  p.style.display = visible ? "" : "none";
  const toggle = $("pending-toggle");
  if (toggle) toggle.innerText = visible ? "—" : "+";
}
async function startPlacingDevice(id) {
  if (!manageMode) { showToast("请先开启管理模式"); return; }
  if (!map) { showToast("请先打开楼层平面图"); return; }
  placingDeviceId = placingDeviceId === id ? null : id;
  renderPendingList();
  if (placingDeviceId) {
    showToast("点击地图放置设备，按 ESC 取消");
    map.getContainer().style.cursor = "crosshair";
    map.once("click", onPlaceDevice);
  } else {
    map.getContainer().style.cursor = "";
    map.off("click", onPlaceDevice);
  }
}

async function deletePendingDevice(id, e) {
  if (e) e.stopPropagation();
  // 双击直接删除，单击删除按钮需要确认
  const isDblClick = e && e.type === 'dblclick';
  if (!isDblClick && !await confirmDialog("确定删除该待定位设备？")) return;
  await dbDel(SD, id);
  showToast(isDblClick ? "已删除（双击删除）" : "已删除");
  renderPendingList();
  renderDeviceMarkers();
}

async function onPlaceDevice(e) {
  if (!placingDeviceId) return;
  L.DomEvent.stopPropagation(e);
  const allDev = await dbGetAll(SD); const dev = allDev.find(x => x.id === placingDeviceId);
  if (dev) {
    dev.posX = e.latlng.lng;
    dev.posY = e.latlng.lat;
    dev.pending = false;
    await dbPut(SD, dev);
    showToast("设备已放置");
  }
  placingDeviceId = null;
  map.getContainer().style.cursor = "";
  renderPendingList();
  renderDeviceMarkers();
}
// ESC 取消放置
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && placingDeviceId) {
    placingDeviceId = null;
    if (map) { map.getContainer().style.cursor = ""; map.off("click", onPlaceDevice); }
    renderPendingList();
    showToast("已取消放置");
  }
});


/* ---------- 待定位面板拖拽移动+双击隐藏 ---------- */
(function(){
  let dragging = false, moved = false, startX, startY, startLeft, startTop;
  document.addEventListener('DOMContentLoaded', () => {
    const header = document.getElementById('pending-header');
    const panel = document.getElementById('pending-panel');
    const toggleBtn = document.getElementById('pending-toggle');
    if (!header || !panel) return;
    // 双击header隐藏面板
    header.addEventListener('dblclick', e => {
      if (moved) return;
      panel.style.display = "none";
      try { localStorage.setItem("firemap_pending_panel", "0"); } catch(e) {}
      const t = document.getElementById("pending-toggle");
      if (t) t.innerText = "+";
    });
    // 点击—号隐藏面板
    if (toggleBtn) {
      toggleBtn.addEventListener('click', e => {
        e.stopPropagation();
        panel.style.display = "none";
        try { localStorage.setItem("firemap_pending_panel", "0"); } catch(e) {}
        toggleBtn.innerText = "+";
      });
    }
    header.addEventListener('mousedown', e => {
      if (e.target.id === 'pending-toggle') return;
      dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      const mapRect = panel.parentElement.getBoundingClientRect();
      startLeft = rect.left - mapRect.left;
      startTop = rect.top - mapRect.top;
      panel.style.right = 'auto';
      panel.style.left = startLeft + 'px';
      panel.style.top = startTop + 'px';
      panel.style.bottom = 'auto';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      panel.style.left = Math.max(0, startLeft + dx) + 'px';
      panel.style.top = Math.max(0, startTop + dy) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (dragging) { dragging = false; document.body.style.userSelect = ''; }
    });
  });
})();


/* ---------- 顶部按钮拖拽排序 ---------- */
(function(){
  const STORAGE_KEY = 'top_btn_order';
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('top-actions');
    if (!container) return;
    // 恢复排序
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (saved.length) {
        saved.forEach(id => {
          const btn = container.querySelector('[data-id="' + id + '"]');
          if (btn) container.appendChild(btn);
        });
      }
    } catch(e) {}
    // 拖拽排序
    let dragEl = null;
    container.querySelectorAll('.top-sort-btn').forEach(btn => {
      btn.addEventListener('dragstart', e => {
        dragEl = btn;
        btn.style.opacity = '0.4';
        e.dataTransfer.effectAllowed = 'move';
      });
      btn.addEventListener('dragend', () => {
        btn.style.opacity = '1';
        dragEl = null;
        // 保存顺序
        const order = Array.from(container.querySelectorAll('.top-sort-btn')).map(b => b.dataset.id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
      });
      btn.addEventListener('dragover', e => {
        e.preventDefault();
        if (dragEl && dragEl !== btn) {
          const rect = btn.getBoundingClientRect();
          const after = e.clientX > rect.left + rect.width / 2;
          if (after) {
            btn.parentNode.insertBefore(dragEl, btn.nextSibling);
          } else {
            btn.parentNode.insertBefore(dragEl, btn);
          }
        }
      });
    });
  });
})();


/* ---------- 比例尺拖拽与隐藏 ---------- */
(function(){
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('scale-indicator');
    if (!el) return;
    try {
      const pos = JSON.parse(localStorage.getItem('scale_pos') || 'null');
      if (pos) { el.style.left = pos.left + 'px'; el.style.top = pos.top + 'px'; el.style.bottom = 'auto'; }
      // 非管理模式默认隐藏
      if (typeof manageMode !== 'undefined' && !manageMode) {
        el.classList.add('hidden');
      } else if (localStorage.getItem('scale_hidden') === '1') {
        el.classList.add('hidden');
      }
    } catch(e) {}
    let dragging = false, startX, startY, startLeft, startTop;
    el.addEventListener('mousedown', e => {
      if (typeof manageMode !== 'undefined' && !manageMode) return;
      if (e.target.classList.contains('scale-close')) return;
      dragging = true; startX = e.clientX; startY = e.clientY;
      const rect = el.getBoundingClientRect(), pr = el.parentElement.getBoundingClientRect();
      startLeft = rect.left - pr.left; startTop = rect.top - pr.top;
      el.style.bottom = 'auto'; el.style.left = startLeft + 'px'; el.style.top = startTop + 'px';
      document.body.style.userSelect = 'none'; e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      el.style.left = Math.max(0, startLeft + e.clientX - startX) + 'px';
      el.style.top = Math.max(0, startTop + e.clientY - startY) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false; document.body.style.userSelect = '';
        const rect = el.getBoundingClientRect(), pr = el.parentElement.getBoundingClientRect();
        localStorage.setItem('scale_pos', JSON.stringify({left: rect.left - pr.left, top: rect.top - pr.top}));
      }
    });
  });
})();
function toggleScaleIndicator() {
  if (typeof manageMode !== 'undefined' && !manageMode) { showToast("仅管理模式可操作比例尺"); return; }
  const el = document.getElementById('scale-indicator');
  if (!el) return;
  el.classList.toggle('hidden');
  localStorage.setItem('scale_hidden', el.classList.contains('hidden') ? '1' : '0');
}


/* ---------- 设备二维码 ---------- */
let currentQRData = null;
function genDeviceQR() {
  const box = document.getElementById("qrcode-box");
  if (!box) return;
  // 截断所有字段
  const type = (document.getElementById("dev-type").value || "").substring(0, 15);
  const code = (document.getElementById("dev-code").value || "").substring(0, 15);
  const pos = (document.getElementById("dev-pos-desc").value || "").substring(0, 20);
  const status = (document.getElementById("dev-status").value || "").substring(0, 6);
  const install = (document.getElementById("dev-install").value || "").substring(0, 10);
  const next = (document.getElementById("dev-next").value || "").substring(0, 10);
  const remark = (document.getElementById("dev-remark").value || "").substring(0, 30);
  const life = document.getElementById("dev-life").value || "";
  const manufacturer = (document.getElementById("dev-manufacturer").value || "").substring(0, 20);
  const model = (document.getElementById("dev-model").value || "").substring(0, 20);
  const person = (document.getElementById("dev-person").value || "").substring(0, 10);
  const phone = (document.getElementById("dev-phone").value || "").substring(0, 15);
  const size = parseInt(document.getElementById("qr-size").value) || 180;
  const devId = document.getElementById("dev-id").value;
  // URL格式：基础地址 + Base64编码的设备信息
  let baseUrl = "";
  try { baseUrl = localStorage.getItem("firemap_qr_baseurl") || ""; } catch(e) {}
  if (!baseUrl) {
    box.innerHTML = '<div style="color:#d97706;font-size:12px;padding:20px;text-align:center;line-height:1.8">请先设置二维码基础地址<br><button onclick="openQrUrlSetting()" style="margin-top:8px;padding:4px 12px;cursor:pointer">设置地址</button></div>';
    return;
  }
  const labels = {};
  const customData = {};
  fieldConfig.forEach(f => {
    if (f.label !== (BUILTIN_FIELDS.find(b => b.key === f.key)?.label || f.label)) labels[f.key] = f.label;
    if (f.custom && f.visible) {
      const el = document.getElementById("custom-" + f.key);
      if (el && el.value) customData[f.label] = el.value;
    }
  });
  // 云端模式：二维码只存设备ID，device.html从云端读取最新数据
  const qrText = baseUrl + (baseUrl.indexOf("?") >= 0 ? "&" : "?") + "id=" + encodeURIComponent(devId);
  currentQRData = { id: devId, text: qrText };
  if (typeof QRCode === "undefined") {
    box.innerHTML = '<div style="color:#d97706;font-size:12px;padding:20px;text-align:center">二维码库未加载</div>';
    return;
  }
  box.innerHTML = "";
  try {
    const opts = {
      text: qrText,
      width: size,
      height: size,
      colorDark: document.getElementById("qr-color-dark").value,
      colorLight: document.getElementById("qr-color-light").value,
      dotStyle: document.getElementById("qr-dot-style").value,
      correctLevel: QRCode.CorrectLevel[document.getElementById("qr-level").value]
    };
    const title = document.getElementById("qr-title").value.trim();
    if (title) { opts.title = title; opts.titleFont = "bold 14px Arial"; opts.titleColor = "#333"; opts.titleHeight = 24; }
    const subtitle = document.getElementById("qr-subtitle").value.trim();
    if (subtitle) { opts.subtitle = subtitle; opts.subtitleFont = "11px Arial"; opts.subtitleColor = "#666"; opts.subtitleTop = 24; }
    if (tempQrLogo) { opts.logo = tempQrLogo; opts.logoBackgroundColor = "#ffffff"; }
    new QRCode(box, opts);
  } catch(e) {
    box.innerHTML = '<div style="color:#d97706;font-size:12px;padding:15px;text-align:center">生成失败<br>' + e.message + '</div>';
  }
}

function openQrUrlSetting() {
  let cur = "";
  try { cur = localStorage.getItem("firemap_qr_baseurl") || ""; } catch(e) {}
  const url = prompt("请输入设备详情页的基础地址（部署 device.html 后的网址）：\n\n例如：https://你的用户名.github.io/device.html", cur);
  if (url !== null) {
    const trimmed = url.trim();
    if (trimmed) {
      try { localStorage.setItem("firemap_qr_baseurl", trimmed); } catch(e) {}
      showToast("地址已保存");
      genDeviceQR();
    }
  }
}


// 字段配置系统
const BUILTIN_FIELDS = [
  { key: "code", label: "设备编号", type: "text", id: "dev-code" },
  { key: "pos", label: "位置描述", type: "text", id: "dev-pos-desc" },
  { key: "install", label: "安装日期", type: "date", id: "dev-install" },
  { key: "life", label: "使用年限", type: "number", id: "dev-life" },
  { key: "next", label: "下次维保", type: "date", id: "dev-next" },
  { key: "manufacturer", label: "生产厂家", type: "text", id: "dev-manufacturer" },
  { key: "model", label: "规格型号", type: "text", id: "dev-model" },
  { key: "person", label: "责任人", type: "text", id: "dev-person" },
  { key: "phone", label: "联系电话", type: "text", id: "dev-phone" },
  { key: "remark", label: "备注", type: "textarea", id: "dev-remark" }
];
let fieldConfig = [];
function loadFieldConfig() {
  try {
    const s = localStorage.getItem("firemap_field_config_v2");
    if (s) {
      fieldConfig = JSON.parse(s);
    } else {
      fieldConfig = BUILTIN_FIELDS.map(f => ({ ...f, visible: true, custom: false }));
    }
  } catch(e) {
    fieldConfig = BUILTIN_FIELDS.map(f => ({ ...f, visible: true, custom: false }));
  }
}
function saveFieldConfigToStorage() {
  try { localStorage.setItem("firemap_field_config_v2", JSON.stringify(fieldConfig)); } catch(e) {}
}
function getVisibleFields() { return fieldConfig.filter(f => f.visible); }
function getFieldLabel(key) {
  const f = fieldConfig.find(x => x.key === key);
  return f ? f.label : key;
}
function applyFieldConfig() {
  // 先隐藏所有内置字段
  BUILTIN_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (el) {
      const wrap = el.closest("label") || el;
      const labelEl = el.previousElementSibling;
      const cfg = fieldConfig.find(x => x.key === f.key);
      const visible = cfg ? cfg.visible : true;
      if (labelEl && labelEl.tagName === "LABEL") {
        labelEl.style.display = visible ? "" : "none";
        labelEl.innerText = cfg ? cfg.label : f.label;
      }
      el.style.display = visible ? "" : "none";
    }
  });
  // 渲染自定义字段
  renderCustomFields();
}
let customFieldValues = {};
function renderCustomFields() {
  const customFields = fieldConfig.filter(f => f.custom && f.visible);
  const remarkEl = document.getElementById("dev-remark");
  if (!remarkEl) return;
  // 移除旧的自定义字段
  document.querySelectorAll(".custom-field-wrap").forEach(el => el.remove());
  // 在备注前面插入自定义字段
  customFields.forEach(f => {
    const wrap = document.createElement("div");
    wrap.className = "custom-field-wrap";
    wrap.innerHTML = '<label>' + f.label + '</label>';
    if (f.type === "textarea") {
      wrap.innerHTML += '<textarea id="custom-' + f.key + '"></textarea>';
    } else if (f.type === "number") {
      wrap.innerHTML += '<input type="number" id="custom-' + f.key + '">';
    } else if (f.type === "date") {
      wrap.innerHTML += '<input type="date" id="custom-' + f.key + '">';
    } else {
      wrap.innerHTML += '<input id="custom-' + f.key + '">';
    }
    remarkEl.parentElement.insertBefore(wrap, remarkEl.parentElement.querySelector("#dev-remark") || remarkEl);
  });
  // 回填自定义字段值
  Object.keys(customFieldValues).forEach(key => {
    const el = document.getElementById("custom-" + key);
    if (el) el.value = customFieldValues[key] || "";
  });
}
function openFieldConfig() {
  const list = document.getElementById("field-config-list");
  let html = "";
  fieldConfig.forEach((f, idx) => {
    html += '<div style="display:flex;align-items:center;margin-bottom:8px;gap:6px;padding:6px;background:#f8f9fa;border-radius:4px">';
    html += '<input type="checkbox" id="fld-vis-' + idx + '" ' + (f.visible ? "checked" : "") + ' style="width:16px;height:16px">';
    html += '<input type="text" id="fld-label-' + idx + '" value="' + f.label + '" style="flex:1;padding:5px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px">';
    if (f.custom) {
      html += '<button onclick="removeCustomField(' + idx + ')" style="padding:3px 8px;border:none;background:#fee;color:#c0392b;border-radius:4px;cursor:pointer;font-size:12px">删</button>';
    } else {
      html += '<span style="font-size:10px;color:#aaa;width:30px;text-align:center">内置</span>';
    }
    html += '</div>';
  });
  list.innerHTML = html;
  openModal("modal-field-config");
}
function addCustomField() {
  const name = prompt("请输入新字段名称：", "自定义字段");
  if (!name || !name.trim()) return;
  const key = "custom_" + Date.now();
  fieldConfig.push({ key, label: name.trim(), type: "text", visible: true, custom: true });
  openFieldConfig();
}
async function removeCustomField(idx) {
  if (!await confirmDialog("确定删除该自定义字段？已保存的设备数据中该字段值将保留但不再显示。")) return;
  fieldConfig.splice(idx, 1);
  openFieldConfig();
}
function saveFieldConfig() {
  fieldConfig.forEach((f, idx) => {
    const visEl = document.getElementById("fld-vis-" + idx);
    const labEl = document.getElementById("fld-label-" + idx);
    if (visEl) f.visible = visEl.checked;
    if (labEl) f.label = labEl.value.trim() || f.label;
  });
  saveFieldConfigToStorage();
  applyFieldConfig();
  closeModal("modal-field-config");
  showToast("字段配置已保存");
}
async function resetFieldConfig() {
  if (!await confirmDialog("确定恢复所有字段为默认配置？自定义字段将被删除。")) return;
  fieldConfig = BUILTIN_FIELDS.map(f => ({ ...f, visible: true, custom: false }));
  saveFieldConfigToStorage();
  applyFieldConfig();
  showToast("已恢复默认字段配置");
}

let tempQrLogo = "";
function toggleQrStyle() {
  const p = document.getElementById("qr-style-panel");
  p.style.display = p.style.display === "none" ? "block" : "none";
}
function onQrLogoChange(input) {
  const f = input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = e => { tempQrLogo = e.target.result; regenDeviceQR(); };
  r.readAsDataURL(f);
}
function clearQrLogo() {
  tempQrLogo = "";
  document.getElementById("qr-logo").value = "";
  regenDeviceQR();
}
function resetQrStyle() {
  document.getElementById("qr-color-dark").value = "#1a1a1a";
  document.getElementById("qr-color-light").value = "#ffffff";
  document.getElementById("qr-dot-style").value = "square";
  document.getElementById("qr-level").value = "M";
  document.getElementById("qr-title").value = "";
  document.getElementById("qr-subtitle").value = "";
  tempQrLogo = "";
  document.getElementById("qr-logo").value = "";
  regenDeviceQR();
}
function regenDeviceQR() { genDeviceQR(); }
function downloadDeviceQR() {
  const box = document.getElementById("qrcode-box");
  if (!box) return;
  const canvas = box.querySelector("canvas");
  const img = box.querySelector("img");
  let url = "";
  if (canvas) {
    url = canvas.toDataURL("image/png");
  } else if (img) {
    url = img.src;
  }
  if (!url) { showToast("二维码未生成"); return; }
  const a = document.createElement("a");
  const code = document.getElementById("dev-code").value || "device";
  a.href = url;
  a.download = "设备二维码_" + code + ".png";
  a.click();
  showToast("二维码已下载");
}


/* ---------- 本地服务器同步 ---------- */
let serverInfo = null;
async function checkServer() {
  try {
    const resp = await fetch('/api/status', { signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      serverInfo = await resp.json();
      return true;
    }
  } catch(e) {}
  serverInfo = null;
  return false;
}
async function syncToServer() {
  try {
    const devices = await dbGetAll(SD);
    const images = await dbGetAll(SIMG);
    // 把图片数据内嵌到设备中
    const data = devices.map(d => {
      const item = { ...d };
      if (d.photoId) {
        const img = images.find(i => i.id === d.photoId);
        if (img) item.photoData = img.data;
      }
      return item;
    });
    const resp = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (resp.ok) {
      const result = await resp.json();
      showToast('已同步到服务器（' + result.count + ' 条设备）');
      return true;
    }
  } catch(e) {
    showToast('同步失败：请先启动「启动服务器.bat」');
  }
  return false;
}

/* ============================================================
 * 自定义确认弹窗（替代浏览器原生confirm，不显示网址）
 * ============================================================ */
function confirmDialog(message) {
  return new Promise(resolve => {
    const modal = document.getElementById("custom-confirm-modal");
    const msgEl = document.getElementById("custom-confirm-message");
    const okBtn = document.getElementById("custom-confirm-ok");
    const cancelBtn = document.getElementById("custom-confirm-cancel");
    if (!modal) { resolve(window.confirm(message)); return; }
    msgEl.innerText = message;
    modal.classList.remove("hidden");
    const cleanup = (result) => {
      modal.classList.add("hidden");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve(result);
    };
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
  });
}