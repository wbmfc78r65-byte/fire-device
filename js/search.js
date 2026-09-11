/* ============================================================
 * search.js - 搜索模块（普通搜索 + 高级搜索 + 结果列表）
 * 依赖：db.js, map.js
 * ============================================================ */

let searchKeyword = "", advSearchActive = false, advSearchConditions = {}, searchResults = [];

/* ---------- 普通搜索 ---------- */
function onSearchInput() {
  searchKeyword = $("search-input").value.trim().toLowerCase();
  $("search-clear").style.display = searchKeyword ? "block" : "none";
  if (!searchKeyword) {
    advSearchActive = false;
    $("search-adv-btn").classList.remove("active");
    closeSearchResultPanel();
  }
  if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
}
function onSearchKeyDown(e) { if (e.key === "Enter") { e.preventDefault(); executeSearch(); } }
function executeSearch() {
  const kw = $("search-input").value.trim();
  if (!kw) { clearSearch(); return; }
  searchKeyword = kw.toLowerCase();
  $("search-clear").style.display = "block";
  getAllLegend().then(list => {
    const exact = list.find(l => l.name === kw);
    advSearchConditions = exact
      ? { type: kw, building: "", floor: "", status: "", life: "", keyword: "", installFrom: "", installTo: "", nextFrom: "", nextTo: "" }
      : { type: "", building: "", floor: "", status: "", life: "", keyword: kw, installFrom: "", installTo: "", nextFrom: "", nextTo: "" };
    advSearchActive = true;
    $("search-adv-btn").classList.add("active");
    if (exact) showToast(`已识别为设施类型：${kw}`);
    performSearchAndShow();
  });
}
function clearSearch() {
  $("search-input").value = ""; searchKeyword = "";
  $("search-clear").style.display = "none";
  advSearchActive = false; advSearchConditions = {};
  $("search-adv-btn").classList.remove("active");
  closeSearchResultPanel();
  if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
}

/* ---------- 高级搜索 ---------- */
function toggleAdvSearch() {
  if (advSearchActive) { clearSearch(); showToast("已清除搜索条件"); return; }
  openAdvSearchModal();
}
async function openAdvSearchModal() {
  openModal("modal-adv-search");
  const bs = sortBuildings(await dbGetAll(SB));
  $("adv-building").innerHTML = '<option value="">全部建筑</option>' + bs.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  const legs = await getAllLegend();
  $("adv-type").innerHTML = '<option value="">全部类型</option>' + legs.map(l => `<option value="${l.name}">${l.name}</option>`).join('');
  updateAdvFloorOptions();
  const c = advSearchConditions;
  if (c.building) $("adv-building").value = c.building;
  if (c.type) $("adv-type").value = c.type;
  if (c.status) $("adv-status").value = c.status;
  if (c.life) $("adv-life").value = c.life;
  if (c.keyword) $("adv-keyword").value = c.keyword;
  if (c.installFrom) $("adv-install-from").value = c.installFrom;
  if (c.installTo) $("adv-install-to").value = c.installTo;
  if (c.nextFrom) $("adv-next-from").value = c.nextFrom;
  if (c.nextTo) $("adv-next-to").value = c.nextTo;
  if (c.customIcon) $("adv-custom-icon").checked = true;
  updateAdvFloorOptions();
  if (c.floor) $("adv-floor").value = c.floor;
}
async function updateAdvFloorOptions() {
  const bid = $("adv-building").value;
  const fs = await dbGetAll(SF);
  const filtered = bid ? fs.filter(f => f.buildingId === bid) : fs;
  const sorted = sortFloors(filtered);
  const bs = await dbGetAll(SB);
  $("adv-floor").innerHTML = '<option value="">全部楼层</option>' + sorted.map(f => {
    const b = bs.find(x => x.id === f.buildingId);
    return `<option value="${f.id}">${b ? b.name + ' / ' : ''}${f.floorName}</option>`;
  }).join('');
}
function resetAdvSearch() {
  ["adv-building", "adv-floor", "adv-type", "adv-status", "adv-life", "adv-keyword", "adv-install-from", "adv-install-to", "adv-next-from", "adv-next-to"].forEach(id => $(id).value = "");
  $("adv-custom-icon").checked = false;
  updateAdvFloorOptions();
}
function doAdvSearch() {
  advSearchConditions = {
    building: $("adv-building").value, floor: $("adv-floor").value,
    type: $("adv-type").value, status: $("adv-status").value, life: $("adv-life").value,
    keyword: $("adv-keyword").value.trim(),
    installFrom: $("adv-install-from").value, installTo: $("adv-install-to").value,
    nextFrom: $("adv-next-from").value, nextTo: $("adv-next-to").value,
    customIcon: $("adv-custom-icon").checked
  };
  advSearchActive = true;
  $("search-adv-btn").classList.add("active");
  if (advSearchConditions.keyword) {
    $("search-input").value = advSearchConditions.keyword;
    searchKeyword = advSearchConditions.keyword.toLowerCase();
    $("search-clear").style.display = "block";
  }
  closeModal("modal-adv-search");
  performSearchAndShow();
}

/* ---------- 搜索执行与结果 ---------- */
async function performSearchAndShow() {
  const results = await filterDevicesByConditions(advSearchConditions);
  searchResults = results;
  if (!results.length) { showToast("未找到匹配的设备"); $("search-tip").style.display = "none"; closeSearchResultPanel(); if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers(); return; }
  showSearchResultPanel(results);
  const tip = $("search-tip");
  tip.style.display = "block";
  if (curF) {
    const fr = results.filter(d => d.floorId === curF);
    tip.innerText = fr.length ? `当前楼层匹配 ${fr.length} 个设备（共 ${results.length} 条，点击查看）` : `当前楼层无匹配，共找到 ${results.length} 个设备（点击查看）`;
  } else {
    tip.innerText = `找到 ${results.length} 个设备（点击查看结果列表）`;
  }
  tip.onclick = () => showSearchResultPanel(results);
  if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
  showToast(`找到 ${results.length} 个匹配设备`);
}

async function filterDevicesByConditions(cond) {
  let devs;
  if (cond.floor) devs = await getDevicesByFloor(cond.floor);
  else if (cond.type) devs = await getDevicesByType(cond.type);
  else if (cond.status) devs = await getDevicesByStatus(cond.status);
  else devs = await dbGetAll(SD);

  const bs = await dbGetAll(SB), fs = await dbGetAll(SF);
  return devs.filter(d => {
    const f = fs.find(x => x.id === d.floorId), b = bs.find(x => x.id === f?.buildingId);
    if (cond.building && (!b || b.id !== cond.building)) return false;
    if (cond.floor && d.floorId !== cond.floor) return false;
    if (cond.type && d.deviceType !== cond.type) return false;
    if (cond.status && d.status !== cond.status) return false;
    if (cond.life && calcDeviceLife(d).status !== cond.life) return false;
    if (cond.keyword) {
      const kw = cond.keyword.toLowerCase();
      const hay = (d.deviceCode || "") + " " + (d.positionDesc || "") + " " + (d.deviceType || "") + " " + (d.remark || "");
      if (!hay.toLowerCase().includes(kw)) return false;
    }
    if (cond.installFrom && (!d.installDate || d.installDate < cond.installFrom)) return false;
    if (cond.installTo && (!d.installDate || d.installDate > cond.installTo)) return false;
    if (cond.nextFrom && (!d.nextMaintain || d.nextMaintain < cond.nextFrom)) return false;
    if (cond.nextTo && (!d.nextMaintain || d.nextMaintain > cond.nextTo)) return false;
    if (cond.customIcon && !d.customIcon) return false;
    return true;
  });
}

async function showSearchResultPanel(results) {
  const panel = $("search-result-panel"), body = $("srp-body");
  $("srp-count").innerText = results.length;
  if (!results.length) { body.innerHTML = '<div class="srp-empty">暂无匹配结果</div>'; panel.classList.add("show"); return; }
  const bs = await dbGetAll(SB), fs = await dbGetAll(SF), legs = await getAllLegend();
  let html = "";
  results.forEach(d => {
    const f = fs.find(x => x.id === d.floorId), b = bs.find(x => x.id === f?.buildingId);
    const leg = legs.find(l => l.name === d.deviceType);
    const color = leg ? leg.color : "#888";
    const life = calcDeviceLife(d);
    const sc = d.status === "故障" ? "#dc2626" : d.status === "待维保" ? "#eab308" : d.status === "已报废" ? "#9ca3af" : "#22c55e";
    html += `<div class="srp-item" onclick="locateDeviceFromSearch('${d.id}')" ondblclick="editDeviceFromSearch('${d.id}')" title="单击定位，双击编辑">
      <div class="srp-title"><span class="srp-type-dot" style="background:${color}"></span>${d.deviceType} <span style="color:#555">${d.deviceCode || '未编号'}</span><span class="srp-edit-hint">双击编辑</span></div>
      <div class="srp-meta">🏢 ${b?.name || '-'} / ${f?.floorName || '-'}<br>📍 ${d.positionDesc || '未填写'} <span class="srp-status" style="background:${sc}22;color:${sc}">${d.status}</span>${life.status !== 'none' ? `<br>⏳ ${life.status === 'ok' ? '剩余' + life.remain + '年' : life.status === 'warn' ? '即将报废' : '已超期'}` : ''}</div>
    </div>`;
  });
  body.innerHTML = html;
  panel.classList.add("show");
  panel.classList.remove("collapsed");
}
function toggleSearchResultPanel() {
  const body = $("search-result-panel").querySelector(".srp-body");
  const btn = $("search-result-panel").querySelector(".srp-header .srp-btn");
  if (body.style.display === "none") { body.style.display = ""; btn.innerText = "—"; }
  else { body.style.display = "none"; btn.innerText = "□"; }
}
function closeSearchResultPanel() { $("search-result-panel").classList.remove("show"); $("search-tip").style.display = "none"; }

async function locateDeviceFromSearch(devId) {
  const d = (await dbGetAll(SD)).find(x => x.id === devId);
  if (!d) { showToast("设备不存在"); return; }
  const f = (await dbGetAll(SF)).find(x => x.id === d.floorId);
  if (!f || !f.imageId) { showToast("该楼层暂无平面图，无法定位"); return; }
  curB = f.buildingId; curF = d.floorId;
  const b = (await dbGetAll(SB)).find(x => x.id === curB);
  currentFloorScale = f.scale || "";
  $("page-location").innerText = `${b.name} / ${f.floorName}${currentFloorScale ? `  [${currentFloorScale}]` : ""}`;
  if (typeof renderTree === 'function') renderTree();
  initMap(f.id);
  setTimeout(() => {
    if (map) {
      map.setView([d.posY, d.posX], floorBaseZoom + 1);
      const marker = markers.find(m => { const ll = m.getLatLng(); return Math.abs(ll.lat - d.posY) < 0.01 && Math.abs(ll.lng - d.posX) < 0.01; });
      if (marker) { setSelectedMarker(marker); marker.openPopup(); }
    }
  }, 300);
  showToast(`已定位到：${d.deviceType} ${d.deviceCode || ''}`);
}

/* 双击搜索结果：定位并打开编辑窗口 */
async function editDeviceFromSearch(devId) {
  const d = (await dbGetAll(SD)).find(x => x.id === devId);
  if (!d) { showToast("设备不存在"); return; }
  const f = (await dbGetAll(SF)).find(x => x.id === d.floorId);
  if (!f) { showToast("楼层不存在"); return; }
  curB = f.buildingId; curF = d.floorId;
  const b = (await dbGetAll(SB)).find(x => x.id === curB);
  currentFloorScale = f.scale || "";
  $("page-location").innerText = `${b.name} / ${f.floorName}${currentFloorScale ? `  [${currentFloorScale}]` : ""}`;
  if (typeof renderTree === 'function') renderTree();
  closeSearchResultPanel();
  if (f.imageId) {
    initMap(f.id);
    setTimeout(() => {
      if (map) map.setView([d.posY, d.posX], floorBaseZoom + 1);
      if (typeof openDeviceModal === 'function') openDeviceModal(d.id, d.posX, d.posY);
    }, 400);
  } else {
    if (typeof openDeviceModal === 'function') openDeviceModal(d.id, d.posX, d.posY);
  }
  showToast(`正在编辑：${d.deviceType} ${d.deviceCode || ''}`);
}
