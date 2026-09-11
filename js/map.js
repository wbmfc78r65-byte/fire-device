/* ============================================================
 * map.js - 地图渲染与管理模式
 * 依赖：db.js（全局函数/变量）
 * ============================================================ */

let map = null, markers = [], selectedMarker = null;
let floorBaseZoom = null, currentFloorScale = "", zoomRenderPending = false;
let manageMode = false, globalMarkerScale = 1;
let resizingMarker = null, resizingType = null, resizeStartSize = 0, resizeStartY = 0, resizeCurrentSize = 0;
let resizeHasIcon = false, resizeIconRatio = 1, isResizingMarker = false, resizeClickBlocker = null;
let ctxDeviceId = null, ctxLatLng = null;
let multiCopyTemplate = null, multiCopyCount = 0;
let singleCopyTemplate = null; // 单次复制放置模式
let crossFloorClipboard = null, crossFloorPasteMode = false, crossFloorCount = 0;
// crossFloorClipboard 格式：单个设备={data, offsets:[{dLat,dLng}]} 或 批量={devices:[{data,dLat,dLng}]}
let selectedDeviceIds = []; // 框选选中的设备ID
let ctrlClickHandled = false; // Ctrl点击已在mousedown处理的标志
let deviceMoveMode = false, deviceMoveStart = null, deviceMoveOrigins = [];
let deviceMoveSelectMode = false; // CAD风格：先按M再选择对象的模式
let mapBoxSelecting = false, mapBoxStartPt = null, justBoxSelected = false;
let renderSeq = 0, mapInitSeq = 0;
let legendList = []; // 全局图例列表，供 updateMarkerIcons 使用

const getMapZoomScale = () => (!map || floorBaseZoom === null) ? 1 : Math.pow(2, map.getZoom() - floorBaseZoom);

/* ---------- 地图初始化（图片按需加载） ---------- */
async function initMap(floorId) {
  const mySeq = ++mapInitSeq;
  if (resizingMarker) stopResize();
  markers.forEach(m => map && map.removeLayer(m));
  markers = []; clearSelectedMarker(); floorBaseZoom = null;
  if (map) { map.off(); map.remove(); map = null; }
  if (!floorId) return;
  const floor = (await dbGetAll(SF)).find(f => f.id === floorId);
  if (!floor || !floor.imageId) return;
  const imgUrl = await getImage(floor.imageId);
  if (!imgUrl) return;
  if (mySeq !== mapInitSeq) return;
  map = L.map('map', { crs: L.CRS.Simple, minZoom: -3, inertia: false, zoomSnap: .5, zoomDelta: .5 });
  const img = new Image();
  img.onload = () => {
    if (mySeq !== mapInitSeq) return;
    const w = img.width, h = img.height, bounds = [[0, 0], [h, w]];
    L.imageOverlay(imgUrl, bounds).addTo(map);
    map.fitBounds(bounds, { animate: false }); floorBaseZoom = map.getZoom();
    map.off("click");
    map.on("click", e => {
      if (singleCopyTemplate) { placeSingleCopy(e.latlng); return; }
      if (multiCopyTemplate) { placeMultiCopy(e.latlng); return; }
      if (crossFloorPasteMode && crossFloorClipboard) { placeCrossFloorPaste(e.latlng); return; }
      // 点击空白清除右键菜单、单个marker选中和多选
      hideContextMenu(); clearSelectedMarker();
      if (typeof clearDeviceSelection === 'function') clearDeviceSelection();
    });
    // 批量移动模式
    map.on("mousedown", e => {
      if (deviceMoveMode && e.originalEvent.button === 0) {
        deviceMoveStart = e.latlng;
        L.DomEvent.stopPropagation(e);
      }
    });
    map.on("mousemove", e => {
      if (deviceMoveMode && deviceMoveStart) onDeviceMoveDrag(e);
    });
    map.on("mouseup", e => {
      if (deviceMoveMode && deviceMoveStart) finishDeviceMove(e);
    });
    // 管理模式框选
    initBoxSelect(map);
    // 中键（滑轮）拖拽平移地图
    let middlePanActive = false, middlePanStart = null, middlePanMapStart = null;
    map.getContainer().addEventListener("mousedown", e => {
      if (e.button === 1) { // 中键
        e.preventDefault();
        e.stopPropagation();
        // 中键按下时临时禁用所有设备拖拽，确保只平移地图不移动设备
        markers.forEach(m => { if (m.dragging) m.dragging.disable(); });
        middlePanActive = true;
        middlePanStart = { x: e.clientX, y: e.clientY };
        middlePanMapStart = map.getCenter();
        map.getContainer().style.cursor = "grabbing";
      }
    });
    document.addEventListener("mousemove", e => {
      if (!middlePanActive) return;
      const dx = e.clientX - middlePanStart.x;
      const dy = e.clientY - middlePanStart.y;
      const point = map.latLngToContainerPoint(middlePanMapStart);
      map.panTo(map.containerPointToLatLng([point.x - dx, point.y - dy]), { animate: false });
    });
    document.addEventListener("mouseup", e => {
      if (middlePanActive && e.button === 1) {
        middlePanActive = false;
        map.getContainer().style.cursor = "";
        // 中键松开后恢复设备拖拽（管理模式下）
        if (manageMode) markers.forEach(m => { if (m.dragging) m.dragging.enable(); });
      }
    });
    map.on("mousedown", e => {
      if (e.originalEvent.button === 2) return;
      const t = e.originalEvent.target;
      if (t.closest && (t.closest("#context-menu") || t.classList.contains("resize-handle"))) return;
      hideContextMenu();
    });
    map.on("popupclose", () => clearSelectedMarker());
    map.on("zoom", () => { updateScaleDisplay(); updateMarkerIcons(); });
    map.on("zoomend", () => { updateScaleDisplay(); updateMarkerIcons(); });
    reverseWheelZoom(map); updateScaleDisplay(); renderDeviceMarkers();
    if (typeof loadVectorShapes === 'function') loadVectorShapes();
    // 管理模式下禁用左键拖拽（左键用于框选）
    if (manageMode && map.dragging) map.dragging.disable();
  };
  img.src = imgUrl;
}

function reverseWheelZoom(m) {
  if (!m || !m.scrollWheelZoom) return;
  const s = m.scrollWheelZoom;
  if (!s._origOnWheelMove) s._origOnWheelMove = s._onWheelMove;
  s._onWheelMove = function (e) {
    if (e.deltaY != null) e.deltaY = -e.deltaY;
    if (e.wheelDelta != null) e.wheelDelta = -e.wheelDelta;
    if (e.deltaY === 0 && e.wheelDelta) e.deltaY = e.wheelDelta > 0 ? -1 : 1;
    s._origOnWheelMove.call(this, e);
  };
}

/* ---------- 标记渲染（用索引查询） ---------- */
// 创建设备图标（纯函数，可复用）
function createDeviceIcon(dev, leg, zs) {
  const statusBorder = s => s === "故障" ? "#dc2626" : s === "待维保" ? "#eab308" : s === "已报废" ? "#6b7280" : "#ffffff";
  const statusClass = s => s === "故障" ? "marker-fault" : s === "待维保" ? "marker-warn" : s === "已报废" ? "marker-expired" : "";
  const statusOpacity = s => s === "已报废" ? "0.55" : "1";
  const hexToRgba = (hex, a) => {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  };
  const color = dev.customColor || (leg ? leg.color : "#888");
  const base = dev.customSize || getLegendSize(leg);
  const box = base * zs;
  const bop = leg && leg.borderOpacity != null ? leg.borderOpacity : 1;
  const life = calcDeviceLife(dev);
  // 综合状态颜色：设备状态优先，寿命状态其次
  let statusColor = statusBorder(dev.status);
  let statusPulseClass = statusClass(dev.status);
  let statusOp = statusOpacity(dev.status);
  // 如果设备状态正常，但寿命有异常，用寿命状态的颜色
  if (dev.status !== "故障" && dev.status !== "待维保" && dev.status !== "已报废") {
    if (life.status === 'expire') {
      statusColor = "#9333ea"; // 紫色 - 已超期
      statusPulseClass = "marker-expire";
    } else if (life.status === 'warn') {
      statusColor = "#f97316"; // 橙色 - 即将报废
      statusPulseClass = "marker-life-warn";
    }
  }
  const bc = hexToRgba(statusColor, bop), sc = statusPulseClass, op = statusOp;
  const lifePulse = ""; // 已合并到上面的逻辑
  const HS = 10;
  const handle = manageMode ? `<div class="resize-handle" data-type="${dev.deviceType}" style="position:absolute;right:-3px;bottom:-3px;width:${HS}px;height:${HS}px;background:#f59e0b;border:2px solid #fff;border-radius:3px;cursor:nwse-resize;z-index:10;box-shadow:0 1px 3px #0004" title="拖拽调节大小"></div>` : '';
  const useIcon = dev.customIcon || (leg && leg.icon);
  if (useIcon) {
    const iconBox = box;
    const dim = getIconDim(leg, iconBox);
    const bw = Math.max(1, iconBox / 10);
    const shadow = bw > 0 ? 'drop-shadow(0 0 ' + Math.max(1, bw/3) + 'px ' + bc + ')' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))';
    const customTag = dev.customIcon ? ' custom-icon-marker' : '';
    return L.divIcon({ html: `<div class="${sc} ${lifePulse}${customTag}" style="position:relative;width:${dim.w}px;height:${dim.h}px;box-sizing:border-box;opacity:${op};line-height:0;background:transparent;filter:${shadow}"><img src="${useIcon}" alt="" draggable="false" style="width:100%;height:100%;display:block"/>${handle}</div>`, iconSize: [dim.w, dim.h], iconAnchor: [dim.w / 2, dim.h / 2] });
  } else {
    // SVG矢量图标：圆形或方形，缩放更丝滑
    const ds = Math.max(6, box * .7), bw = Math.max(1, box / 10);
    const fullSize = ds + bw * 2;
    const shape = leg?.shape || "circle";
    const r = ds / 2; // 内圆半径
    const cx = fullSize / 2, cy = fullSize / 2;
    let shapeSvg = "";
    if (shape === "square") {
      // 方形：rect，4px圆角
      const corner = Math.min(4, ds * 0.15);
      shapeSvg = `<rect x="${bw}" y="${bw}" width="${ds}" height="${ds}" rx="${corner}" ry="${corner}" fill="${color}" stroke="${bc}" stroke-width="${bw}"/>`;
    } else {
      // 圆形：circle
      shapeSvg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="${bc}" stroke-width="${bw}"/>`;
    }
    const svgHtml = `<svg width="${fullSize}" height="${fullSize}" viewBox="0 0 ${fullSize} ${fullSize}" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.25))">${shapeSvg}</svg>`;
    return L.divIcon({ html: `<div class="${sc} ${lifePulse}" style="position:relative;width:${fullSize}px;height:${fullSize}px;box-sizing:border-box;opacity:${op};line-height:0;background:transparent">${svgHtml}${handle}</div>`, iconSize: [fullSize, fullSize], iconAnchor: [fullSize / 2, fullSize / 2] });
  }
}

// 缩放时只更新图标，不重建标记（CAD模式：位置不变，只改大小）
function updateMarkerIcons() {
  if (!markers.length || !legendList.length) return;
  const zs = getMapZoomScale();
  markers.forEach(m => {
    const dev = m._dev;
    if (!dev) return;
    const leg = legendList.find(l => l.name === dev.deviceType);
    m.setIcon(createDeviceIcon(dev, leg, zs));
  });
  // 缩放后恢复选中设备的高亮（setIcon会替换DOM，高亮样式丢失）
  if (typeof selectedDeviceIds !== 'undefined' && selectedDeviceIds.length > 0) {
    selectedDeviceIds.forEach(id => {
      if (typeof highlightDeviceMarker === 'function') highlightDeviceMarker(id, true);
    });
  }
}


async function renderDeviceMarkers(retry) {
  if (!curF || !map) return;
  // 批量移动模式下不渲染，避免markers数组被替换导致移动失效
  if (deviceMoveMode) {
    setTimeout(() => { if (curF && map) renderDeviceMarkers(); }, 100);
    return;
  }
  // floorBaseZoom未就绪时延迟重试，避免用默认比例1渲染导致图标忽大忽小
  if (floorBaseZoom === null) {
    if ((retry || 0) < 20) { setTimeout(() => { if (curF && map) renderDeviceMarkers((retry || 0) + 1); }, 50); }
    return;
  }
  const mySeq = ++renderSeq;
  let devs = await getDevicesByFloor(curF);
  if (mySeq !== renderSeq) return;
  devs = devs.filter(d => visibleTypeSet.has(d.deviceType) && !d.pending);
  legendList = await getAllLegend();
  if (mySeq !== renderSeq) return;
  if (typeof advSearchActive !== 'undefined' && advSearchActive && Object.keys(advSearchConditions).length) {
    const filtered = await filterDevicesByConditions(advSearchConditions);
    if (mySeq !== renderSeq) return;
    const ids = new Set(filtered.map(d => d.id));
    devs = devs.filter(d => ids.has(d.id));
  } else if (typeof searchKeyword !== 'undefined' && searchKeyword) {
    devs = devs.filter(d => (d.deviceCode || "").toLowerCase().includes(searchKeyword) || (d.positionDesc || "").toLowerCase().includes(searchKeyword) || (d.deviceType || "").toLowerCase().includes(searchKeyword) || (d.remark || "").toLowerCase().includes(searchKeyword));
  }
  const tip = $("search-tip");
  if ((typeof advSearchActive !== 'undefined' && advSearchActive) || (typeof searchKeyword !== 'undefined' && searchKeyword)) {
    if (devs.length || (typeof searchResults !== 'undefined' && searchResults.length)) {
      tip.style.display = "block";
      tip.innerText = (typeof advSearchActive !== 'undefined' && advSearchActive)
        ? `搜索条件匹配 ${searchResults.length} 个设备，当前楼层显示 ${devs.length} 个（点击查看全部）`
        : `搜索"${searchKeyword}"，当前楼层找到 ${devs.length} 个设备`;
      tip.onclick = (typeof advSearchActive !== 'undefined' && advSearchActive) ? () => showSearchResultPanel(searchResults) : null;
    } else tip.style.display = "none";
  } else tip.style.display = "none";

  if (mySeq !== renderSeq) return;
  markers.forEach(m => map.removeLayer(m)); markers = []; clearSelectedMarker();
  const zs = getMapZoomScale();

  for (const dev of devs) {
    if (mySeq !== renderSeq) return;
    const leg = legendList.find(l => l.name === dev.deviceType);
    const life = calcDeviceLife(dev);
    const icon = createDeviceIcon(dev, leg, zs);
    // popup 用的状态颜色
    const statusBorder = s => s === "故障" ? "#dc2626" : s === "待维保" ? "#eab308" : s === "已报废" ? "#6b7280" : "#ffffff";
    const bop = leg && leg.borderOpacity != null ? leg.borderOpacity : 1;
    const h = statusBorder(dev.status).replace('#','');
    const bc = `rgba(${parseInt(h.substring(0,2),16)},${parseInt(h.substring(2,4),16)},${parseInt(h.substring(4,6),16)},${bop})`;
    const m = L.marker([dev.posY, dev.posX], { icon, draggable: false, contextmenu: true }).addTo(map); m._devId = dev.id; m._dev = dev;
    // 如果设备已在选中列表中，自动设置高亮
    if (selectedDeviceIds.includes(dev.id)) {
      setTimeout(() => highlightDeviceMarker(dev.id, true), 10);
    }
    const editBtn = manageMode ? `<div style="margin-top:10px;text-align:center;border-top:1px solid #eee;padding-top:8px"><button class="btn primary" style="padding:5px 16px;font-size:12px" onclick="openDeviceModalById('${dev.id}')">✏️ 编辑设备</button></div>` : '';
    const lifeInfo = life.status !== 'none' ? `<div>⏳ 寿命：${lifeTagHTML(dev)}</div>` : '';
    let photoHtml = '';
    if (dev.photoId) {
      const photoUrl = await getImage(dev.photoId);
      if (mySeq !== renderSeq) { map.removeLayer(m); return; }
      if (photoUrl) photoHtml = `<div style="margin-top:8px;text-align:center"><img style="max-width:180px;max-height:120px;border-radius:4px" src="${photoUrl}" alt=""></div>`;
    }
    // 动态生成字段内容（根据字段配置，只显示有值的字段）
    const fieldMap = { code: 'deviceCode', pos: 'positionDesc', install: 'installDate', life: 'lifeYears', next: 'nextMaintain', manufacturer: 'manufacturer', model: 'model', person: 'person', phone: 'phone', remark: 'remark' };
    const fieldIcons = { code: '🔢', pos: '📍', install: '📅', life: '⏳', next: '🔧', manufacturer: '🏭', model: '📋', person: '👤', phone: '📞', remark: '📝' };
    let fieldsHtml = '';
    const visibleFields = (typeof getVisibleFields === 'function') ? getVisibleFields() : [];
    visibleFields.forEach(f => {
      if (f.key === 'life') { fieldsHtml += lifeInfo; return; }
      const val = dev[fieldMap[f.key]];
      if (val !== undefined && val !== null && val !== '') {
        const label = (typeof getFieldLabel === 'function') ? getFieldLabel(f.key) : f.label;
        const icon = fieldIcons[f.key] || '📌';
        fieldsHtml += `<div>${icon} ${label}：${val}</div>`;
      }
    });
    // 状态固定显示（正常用黑色，其他状态用对应颜色）
    const statusTextColor = dev.status === "故障" ? "#dc2626" : dev.status === "待维保" ? "#eab308" : dev.status === "已报废" ? "#9ca3af" : "#000000";
    fieldsHtml += `<div>📊 状态：<span style="color:${statusTextColor};font-weight:bold">${dev.status || '正常'}</span></div>`;
    m.bindPopup(`<div style="min-width:220px"><div style="font-size:15px;font-weight:bold;margin-bottom:6px;color:#d92121">${dev.deviceType} ${dev.deviceCode || ""}</div><div style="line-height:1.8;font-size:13px">${fieldsHtml}</div>${photoHtml}${editBtn}<div style="font-size:11px;color:#999;margin-top:6px;text-align:center">${manageMode ? '双击可直接编辑｜' : '按 ESC 关闭'}</div></div>`);
    // mousedown时检测Ctrl键，临时禁用拖拽，确保click事件能触发
    m.on("mousedown", e => {
      if (!manageMode) return;
      if (e.originalEvent.button !== 0) return; // 只处理左键
      const isCtrl = e.originalEvent && (e.originalEvent.ctrlKey || e.originalEvent.metaKey);
      if (isCtrl) {
        // Ctrl点击：切换选中状态，不进入移动模式
        const idx = selectedDeviceIds.indexOf(dev.id);
        if (idx >= 0) {
          selectedDeviceIds.splice(idx, 1);
          highlightDeviceMarker(dev.id, false);
        } else {
          selectedDeviceIds.push(dev.id);
          highlightDeviceMarker(dev.id, true);
        }
        ctrlClickHandled = true; // 标记已在mousedown处理，click中跳过
        L.DomEvent.stopPropagation(e);
        return;
      }
      ctrlClickHandled = false;
      // 普通点击：如果设备未被选中，先清除其他选中，选中当前设备
      if (!selectedDeviceIds.includes(dev.id)) {
        clearDeviceSelection();
        selectedDeviceIds.push(dev.id);
        highlightDeviceMarker(dev.id, true);
      }
      // 进入批量移动模式（框选多个后拖动任意一个都能批量移动）
      if (selectedDeviceIds.length > 0) {
        deviceMoveMode = true;
        deviceMoveOrigins = [];
        selectedDeviceIds.forEach(id => {
          const mk = markers.find(x => x._devId === id);
          if (mk) {
            deviceMoveOrigins.push({ id, lat: mk.getLatLng().lat, lng: mk.getLatLng().lng, marker: mk });
            mk.setOpacity(0.5);
          }
        });
        deviceMoveStart = e.latlng;
        document.body.style.cursor = "move";
      }
      L.DomEvent.stopPropagation(e);
    });
    m.on("click", e => {
      if (isResizingMarker) return;
      // 批量移动模式下，点击设备不弹窗，避免干扰移动操作
      if (deviceMoveMode || deviceMoveSelectMode) { 
        L.DomEvent.stopPropagation(e); 
        if (m.closePopup) m.closePopup();
        return; 
      }
      const t = e.originalEvent.target;
      if (t && t.closest && t.closest(".resize-handle")) return;
      L.DomEvent.stopPropagation(e); hideContextMenu();
      // Ctrl点击已在mousedown中处理，这里跳过
      if (ctrlClickHandled) {
        ctrlClickHandled = false;
        if (map) map.closePopup();
        return;
      }
      setSelectedMarker(m); m.openPopup();
    });
    m.on("dblclick", e => {
      if (!manageMode || isResizingMarker) return;
      L.DomEvent.stopPropagation(e); hideContextMenu();
      if (map) map.closePopup();
      openDeviceModal(dev.id, dev.posX, dev.posY);
    });
    m.on("contextmenu", e => {
      if (!manageMode || isResizingMarker) return;
      L.DomEvent.stopPropagation(e); e.originalEvent.preventDefault();
      showContextMenu(dev.id, e.latlng, e.originalEvent.clientX, e.originalEvent.clientY);
    });
    if (manageMode) {
      m.on("dragstart", () => { if (!isResizingMarker) $("drag-hint").classList.add("show"); });
      m.on("dragend", async () => {
        $("drag-hint").classList.remove("show");
        const np = m.getLatLng(); dev.posX = np.lng; dev.posY = np.lat;
        await dbPut(SD, dev);
        showToast(`位置已更新（X:${np.lng.toFixed(1)}, Y:${np.lat.toFixed(1)}）`);
      });
      setTimeout(() => {
        if (mySeq !== renderSeq) return;
        const el = m.getElement();
        if (el) {
          const h = el.querySelector('.resize-handle');
          if (h) h.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); blockNextClick(); startMarkerResize(m, dev.deviceType, e.clientY); });
        }
      }, 10);
    }
    markers.push(m);
  }
  if (typeof renderPendingList === "function") renderPendingList();
}

/* ---------- 选中标记 ---------- */

function setSelectedMarker(m) { clearSelectedMarker(); selectedMarker = m; if (m) { const el = m.getElement(); if (el) el.classList.add('marker-selected'); } }
function clearSelectedMarker() { if (selectedMarker) { const el = selectedMarker.getElement(); if (el) el.classList.remove('marker-selected'); } selectedMarker = null; }

/* ---------- 比例尺显示 ---------- */
function updateScaleDisplay() {
  const ind = $("scale-indicator");
  if (!curF || !map) { ind.style.display = 'none'; return; }
  ind.style.display = 'block';
  $("scale-text").innerText = currentFloorScale || '未设置';
  const zs = getMapZoomScale(), pct = Math.round(zs * 100);
  $("zoom-text").innerText = pct + '%';
  $("zoom-fill").style.width = Math.max(0, Math.min(100, (pct - 25) / 375 * 100)) + '%';
}

/* ---------- 右键菜单 ---------- */
function showContextMenu(id, latlng, cx, cy) {
  ctxDeviceId = id; ctxLatLng = latlng;
  const m = $("context-menu"); m.dataset.deviceId = id;
  const r = $("map-container").getBoundingClientRect();
  let x = cx - r.left, y = cy - r.top;
  m.style.display = 'block'; m.classList.add('show');
  const mw = m.offsetWidth, mh = m.offsetHeight;
  if (x + mw > r.width) x = r.width - mw - 5;
  if (y + mh > r.height) y = r.height - mh - 5;
  m.style.left = x + 'px'; m.style.top = y + 'px';
}
function hideContextMenu() {
  const m = $("context-menu");
  if (m) { m.classList.remove('show'); m.style.display = 'none'; m.dataset.deviceId = ''; }
  ctxDeviceId = null; ctxLatLng = null;
}
const getCtxId = () => $("context-menu").dataset.deviceId || ctxDeviceId;
async function ctxEditDevice() { const id = getCtxId(); hideContextMenu(); if (!id) return; const d = (await dbGetAll(SD)).find(x => x.id === id); if (d) openDeviceModal(d.id, d.posX, d.posY); }
async function ctxCopyDevice() {
  hideContextMenu();
  const allDevs = await dbGetAll(SD);
  // 优先处理批量选中的设备
  if (selectedDeviceIds.length > 0) {
    const firstM = markers.find(x => x._devId === selectedDeviceIds[0]);
    if (!firstM) { showToast("请先框选设备"); return; }
    const baseLat = firstM.getLatLng().lat;
    const baseLng = firstM.getLatLng().lng;
    const devices = [];
    for (const id of selectedDeviceIds) {
      const m = markers.find(x => x._devId === id);
      const d = allDevs.find(x => x.id === id);
      if (m && d) {
        devices.push({ data: JSON.parse(JSON.stringify(d)), dLat: m.getLatLng().lat - baseLat, dLng: m.getLatLng().lng - baseLng });
      }
    }
    if (devices.length === 0) { showToast("未找到选中的设备"); return; }
    singleCopyTemplate = { devices, isBatch: true };
    document.body.classList.add("multi-copy-active");
    showToast(`复制模式：已复制 ${devices.length} 个设备，点击地图放置，ESC 取消`);
    return;
  }
  // 单个设备（右键菜单）
  const id = getCtxId();
  if (!id) return;
  const d = allDevs.find(x => x.id === id);
  if (!d) { showToast("设备不存在"); return; }
  singleCopyTemplate = { data: JSON.parse(JSON.stringify(d)), isBatch: false };
  document.body.classList.add("multi-copy-active");
  showToast("复制模式：点击地图任意位置放置，按 ESC 取消");
}
function exitSingleCopy() {
  if (!singleCopyTemplate) return;
  singleCopyTemplate = null;
  document.body.classList.remove("multi-copy-active");
}
async function ctxMultiCopyDevice() {
  const id = getCtxId(); hideContextMenu();
  if (!id) return;
  const d = (await dbGetAll(SD)).find(x => x.id === id);
  if (!d) { showToast("设备不存在"); return; }
  multiCopyTemplate = JSON.parse(JSON.stringify(d));
  multiCopyCount = 0;
  document.body.classList.add("multi-copy-active");
  showToast("多次复制模式：点击地图放置，按 ESC 退出");
}
function exitMultiCopy() {
  if (!multiCopyTemplate) return;
  multiCopyTemplate = null;
  multiCopyCount = 0;
  document.body.classList.remove("multi-copy-active");
  showToast("已退出多次复制模式");
}

/* ---------- 跨楼层复制 ---------- */
async function ctxCrossFloorCopy() {
  hideContextMenu();
  const allDevs = await dbGetAll(SD);
  // 优先处理批量选中的设备
  if (selectedDeviceIds.length > 0) {
    const firstM = markers.find(x => x._devId === selectedDeviceIds[0]);
    if (!firstM) { showToast("请先框选设备"); return; }
    const baseLat = firstM.getLatLng().lat;
    const baseLng = firstM.getLatLng().lng;
    const devices = [];
    for (const id of selectedDeviceIds) {
      const m = markers.find(x => x._devId === id);
      const d = allDevs.find(x => x.id === id);
      if (m && d) {
        devices.push({ data: JSON.parse(JSON.stringify(d)), dLat: m.getLatLng().lat - baseLat, dLng: m.getLatLng().lng - baseLng });
      }
    }
    if (devices.length === 0) { showToast("未找到选中的设备"); return; }
    crossFloorClipboard = { devices, isBatch: true };
    crossFloorPasteMode = true;
    crossFloorCount = 0;
    document.body.style.cursor = "crosshair";
    showToast(`跨楼层复制模式：已复制 ${devices.length} 个设备，切换楼层后点击放置，ESC 退出`);
    return;
  }
  // 单个设备（右键菜单）
  const id = getCtxId();
  if (!id) return;
  const d = allDevs.find(x => x.id === id);
  if (!d) { showToast("设备不存在"); return; }
  crossFloorClipboard = { data: JSON.parse(JSON.stringify(d)), isBatch: false };
  crossFloorPasteMode = true;
  crossFloorCount = 0;
  document.body.style.cursor = "crosshair";
  showToast("跨楼层复制模式：切换楼层后点击地图放置，按 ESC 退出");
}
function exitCrossFloorPaste() {
  if (!crossFloorPasteMode) return;
  crossFloorPasteMode = false;
  crossFloorClipboard = null;
  crossFloorCount = 0;
  document.body.style.cursor = "";
  showToast("已退出跨楼层粘贴模式");
}
async function placeCrossFloorPaste(latlng) {
  if (!crossFloorClipboard || !crossFloorPasteMode) return;
  if (!curF) { showToast("请先选择楼层"); return; }
  const newBaseLat = latlng.lat;
  const newBaseLng = latlng.lng;
  if (crossFloorClipboard.isBatch) {
    // 批量粘贴：保持相对位置
    for (const o of crossFloorClipboard.devices) {
      const copy = JSON.parse(JSON.stringify(o.data));
      copy.id = "dev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      copy.floorId = curF;
      copy.pending = false;
      copy.code = (o.data.code || "设备") + "_副本" + (++crossFloorCount);
      copy.posX = newBaseLng + o.dLng;
      copy.posY = newBaseLat + o.dLat;
      if (typeof visibleTypeSet !== 'undefined' && copy.deviceType && !visibleTypeSet.has(copy.deviceType)) {
        visibleTypeSet.add(copy.deviceType);
      }
      await dbPut(SD, copy);
    }
    renderDeviceMarkers();
    if (typeof calcStat === 'function') calcStat();
    showToast(`已跨楼层粘贴 ${crossFloorClipboard.devices.length} 个设备，保持相对位置`);
  } else {
    // 单个粘贴
    const copy = JSON.parse(JSON.stringify(crossFloorClipboard.data));
    copy.id = "dev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    copy.floorId = curF;
    copy.pending = false;
    copy.code = (crossFloorClipboard.data.code || "设备") + "_副本" + (++crossFloorCount);
    copy.posX = latlng.lng;
    copy.posY = latlng.lat;
    if (typeof visibleTypeSet !== 'undefined' && copy.deviceType && !visibleTypeSet.has(copy.deviceType)) {
      visibleTypeSet.add(copy.deviceType);
    }
    await dbPut(SD, copy);
    renderDeviceMarkers();
    if (typeof calcStat === 'function') calcStat();
    showToast(`已放置第 ${crossFloorCount} 个副本，继续点击放置，ESC 退出`);
  }
}
async function placeSingleCopy(latlng) {
  if (!singleCopyTemplate) return;
  if (!curF) { showToast("请先选择楼层"); return; }
  const newBaseLat = latlng.lat;
  const newBaseLng = latlng.lng;
  if (singleCopyTemplate.isBatch) {
    // 批量放置：保持相对位置
    let copyIdx = 0;
    for (const o of singleCopyTemplate.devices) {
      const copy = JSON.parse(JSON.stringify(o.data));
      copy.id = "dev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      copy.floorId = curF;
      copy.pending = false;
      copy.code = (o.data.code || "设备") + "_副本" + (++copyIdx);
      copy.posX = newBaseLng + o.dLng;
      copy.posY = newBaseLat + o.dLat;
      if (typeof visibleTypeSet !== 'undefined' && copy.deviceType && !visibleTypeSet.has(copy.deviceType)) {
        visibleTypeSet.add(copy.deviceType);
      }
      await dbPut(SD, copy);
    }
    exitSingleCopy();
    renderDeviceMarkers();
    if (typeof calcStat === 'function') calcStat();
    showToast(`已复制 ${copyIdx} 个设备到点击位置，保持相对位置`);
  } else {
    // 单个放置
    const copy = JSON.parse(JSON.stringify(singleCopyTemplate.data));
    copy.id = "dev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    copy.floorId = curF;
    copy.pending = false;
    copy.code = (singleCopyTemplate.data.code || "设备") + "_副本";
    copy.posX = latlng.lng;
    copy.posY = latlng.lat;
    if (typeof visibleTypeSet !== 'undefined' && copy.deviceType && !visibleTypeSet.has(copy.deviceType)) {
      visibleTypeSet.add(copy.deviceType);
    }
    await dbPut(SD, copy);
    exitSingleCopy();
    renderDeviceMarkers();
    if (typeof calcStat === 'function') calcStat();
    showToast("设备已复制到点击位置");
  }
}
async function placeMultiCopy(latlng) {
  if (!multiCopyTemplate) return;
  if (!curF) { showToast("请先选择楼层"); return; }
  const copy = JSON.parse(JSON.stringify(multiCopyTemplate));
  copy.id = "dev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  copy.floorId = curF; // 设置为当前楼层，支持跨楼层
  copy.pending = false;
  copy.code = (multiCopyTemplate.code || "设备") + "_副本" + (++multiCopyCount);
  copy.posX = latlng.lng;
  copy.posY = latlng.lat;
  // 确保设备类型可见
  if (typeof visibleTypeSet !== 'undefined' && copy.deviceType && !visibleTypeSet.has(copy.deviceType)) {
    visibleTypeSet.add(copy.deviceType);
  }
  await dbPut(SD, copy);
  renderDeviceMarkers();
  if (typeof calcStat === 'function') calcStat();
  showToast(`已放置第 ${multiCopyCount} 个副本，继续点击放置，ESC 退出`);
}
async function ctxMoveDevice() { const id = getCtxId(), ll = ctxLatLng; hideContextMenu(); if (!id || !ll) return; const d = (await dbGetAll(SD)).find(x => x.id === id); if (!d) return; d.posX = ll.lng; d.posY = ll.lat; await dbPut(SD, d); renderDeviceMarkers(); showToast("设备位置已更新"); }
async function ctxChangeStatus() { const id = getCtxId(); hideContextMenu(); if (!id) return; const d = (await dbGetAll(SD)).find(x => x.id === id); if (!d) return; const ss = ["正常", "故障", "待维保", "已报废"]; d.status = ss[(ss.indexOf(d.status) + 1) % 4]; await dbPut(SD, d); renderDeviceMarkers(); if (typeof calcStat === 'function') calcStat(); showToast(`状态已改为：${d.status}`); }
async function ctxDeleteDevice() {
  const id = getCtxId(); hideContextMenu();
  if (!id) { showToast("未找到设备信息，请重试"); return; }
  // 如果右键的设备在选中列表中，且选中了多个，则批量删除
  if (selectedDeviceIds.includes(id) && selectedDeviceIds.length > 1) {
    if (!await confirmDialog(`⚠️确认删除选中的 ${selectedDeviceIds.length} 个设备？`)) return;
    await deleteSelectedDevices();
    return;
  }
  // 否则只删除右键的单个设备
  const d = (await dbGetAll(SD)).find(x => x.id === id);
  if (!d) { showToast("设备不存在"); return; }

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
  let confirmMsg = "⚠️确认删除该设备点位？";
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

  pushUndo('cascade', {
    devices: [d],
    inspectLogs: inspectLogs,
    maintainLogs: maintainLogs,
    workOrders: workOrders,
    formDataList: formDataList,
    images: images
  }, "设备-" + d.deviceType + " " + (d.deviceCode || '未编号'));

  await dbDel(SD, id);
  if (typeof Cloud !== 'undefined' && Cloud.enabled) Cloud.deleteDevice(id);
  for (let l of inspectLogs) await dbDel(S_LOG, l.id);
  for (let l of maintainLogs) await dbDel(SL, l.id);
  for (let w of workOrders) await dbDel(S_WORKORDER, w.id);
  for (let f of formDataList) await dbDel(S_FORM_DATA, f.id);
  if (d.photoId) await deleteImage(d.photoId);
  clearSelectedMarker(); renderDeviceMarkers();
  if (typeof calcStat === 'function') calcStat();
  showToast("设备已删除（含 " + totalRelated + " 条关联数据）");
  showUndoBar("设备-" + d.deviceType + " " + (d.deviceCode || '未编号'));
}

async function ctxClearCustomStyle() {
  hideContextMenu();
  const allDevs = await dbGetAll(SD);
  let ids = [];
  // 优先处理批量选中的设备
  if (selectedDeviceIds.length > 0) {
    ids = [...selectedDeviceIds];
  } else {
    const id = getCtxId();
    if (id) ids = [id];
  }
  if (ids.length === 0) { showToast("未选中设备"); return; }
  const customDevs = ids.map(id => allDevs.find(d => d.id === id)).filter(d => d && (d.customColor || d.customSize));
  if (customDevs.length === 0) { showToast("选中设备没有独立样式"); return; }
  if (!await confirmDialog(`确定清除 ${customDevs.length} 个设备的独立样式吗？`)) return;
  for (const d of customDevs) {
    d.customColor = null;
    d.customSize = null;
    await dbPut(SD, d);
  }
  showToast(`已清除 ${customDevs.length} 个设备的独立样式`);
  renderDeviceMarkers();
}

/* ---------- 标记大小调整（修复版） ---------- */
function blockNextClick() {
  removeClickBlocker();
  resizeClickBlocker = e => { e.stopPropagation(); e.preventDefault(); e.stopImmediatePropagation(); removeClickBlocker(); };
  document.addEventListener('click', resizeClickBlocker, true);
  setTimeout(removeClickBlocker, 500);
}
const removeClickBlocker = () => { if (resizeClickBlocker) { document.removeEventListener('click', resizeClickBlocker, true); resizeClickBlocker = null; } };

function startMarkerResize(marker, type, sy) {
  if (resizingMarker) { stopResize(); }
  resizingMarker = marker;
  resizingType = type;
  resizeStartY = sy;
  resizeCurrentSize = 0;
  isResizingMarker = true;
  $("resize-tip").classList.add("show");
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', stopResize);
  window.addEventListener('mouseup', stopResize);
  getAllLegend().then(list => {
    if (!resizingMarker) return;
    const leg = list.find(l => l.name === type);
    if (!leg) { stopResize(); return; }
    resizeStartSize = leg.size || 32;
    resizeCurrentSize = resizeStartSize;
    resizeHasIcon = !!leg.icon;
    resizeIconRatio = (leg.iconW && leg.iconH) ? leg.iconW / leg.iconH : 1;
    $("resize-size-val").innerText = resizeCurrentSize;
  });
}

function onResizeMove(e) {
  if (!resizingMarker || resizeCurrentSize === 0) return;
  resizeCurrentSize = Math.max(16, Math.min(80, Math.round(resizeStartSize + resizeStartY - e.clientY)));
  $("resize-size-val").innerText = resizeCurrentSize;
  const el = resizingMarker.getElement();
  if (!el) return;
  const inner = el.querySelector('div');
  if (!inner) return;
  if (resizeHasIcon) {
    let w, h;
    if (resizeIconRatio >= 1) { w = resizeCurrentSize; h = Math.round(resizeCurrentSize / resizeIconRatio); }
    else { w = Math.round(resizeCurrentSize * resizeIconRatio); h = resizeCurrentSize; }
    inner.style.width = w + "px"; inner.style.height = h + "px"; inner.style.background = "transparent";
    const img = inner.querySelector('img'); if (img) { img.style.width = "100%"; img.style.height = "100%"; }
    el.style.width = w + "px"; el.style.height = h + "px"; el.style.marginLeft = -(w / 2) + "px"; el.style.marginTop = -(h / 2) + "px";
  } else {
    const ds = Math.round(resizeCurrentSize * .7);
    inner.style.width = ds + "px"; inner.style.height = ds + "px";
    el.style.width = resizeCurrentSize + "px"; el.style.height = resizeCurrentSize + "px";
    el.style.marginLeft = -(resizeCurrentSize / 2) + "px"; el.style.marginTop = -(resizeCurrentSize / 2) + "px";
  }
}

async function stopResize() {
  if (!resizingMarker) return;
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', stopResize);
  window.removeEventListener('mouseup', stopResize);
  $("resize-tip").classList.remove("show");
  const type = resizingType, ns = resizeCurrentSize;
  resizingMarker = null; resizingType = null;
  isResizingMarker = false;
  removeClickBlocker();
  if (ns > 0 && type) {
    const list = await getAllLegend(), leg = list.find(l => l.name === type);
    if (leg) { leg.size = ns; await dbPut(SLEG, leg); showToast(`【${type}】标记大小已调整为 ${ns}px`); }
  }
  if (typeof renderAllLegend === 'function') renderAllLegend();
  renderDeviceMarkers();
}

/* ---------- 全局标记大小 ---------- */
function onGlobalScaleChange() {
  const v = parseFloat($("global-scale").value);
  globalMarkerScale = v;
  $("global-scale-val").innerText = Math.round(v * 100) + "%";
  const r = $("global-scale-right");
  if (r) { r.value = v; $("global-scale-val-right").innerText = Math.round(v * 100) + "%"; }
  renderDeviceMarkers();
}
function adjustGlobalScale(d) {
  let v = Math.max(.4, Math.min(2.5, Math.round((globalMarkerScale + d) * 10) / 10));
  globalMarkerScale = v;
  $("global-scale").value = v; $("global-scale-val").innerText = Math.round(v * 100) + "%";
  const r = $("global-scale-right");
  if (r) { r.value = v; $("global-scale-val-right").innerText = Math.round(v * 100) + "%"; }
  renderDeviceMarkers();
}

/* ---------- 悬浮面板 ---------- */
function toggleFloatPanel(pid) {
  const p = $(pid), barId = pid === "float-legend-panel" ? "collapsed-legend-bar" : "collapsed-legend-config-bar", bar = $(barId);
  if (p.classList.contains("collapsed")) { p.classList.remove("collapsed"); bar.style.display = "none"; }
  else { p.classList.add("collapsed"); bar.style.top = p.style.top; bar.style.left = p.style.left; bar.style.right = p.style.right; bar.style.display = "block"; }
}
function expandFloatPanel(pid) { $(pid).classList.remove("collapsed"); $(pid === "float-legend-panel" ? "collapsed-legend-bar" : "collapsed-legend-config-bar").style.display = "none"; }
function closeFloatPanel(pid) { $(pid).style.display = "none"; $(pid === "float-legend-panel" ? "collapsed-legend-bar" : "collapsed-legend-config-bar").style.display = "none"; }
function makeDraggable(panel, header) {
  let drag = false, sx, sy, sl, st;
  const down = e => { if (e.target.tagName === "BUTTON") return; drag = true; sx = e.clientX; sy = e.clientY; const r = panel.getBoundingClientRect(), cr = panel.parentElement.getBoundingClientRect(); sl = r.left - cr.left; st = r.top - cr.top; panel.style.right = "auto"; panel.style.left = sl + "px"; panel.style.top = st + "px"; e.preventDefault(); };
  const move = e => { if (!drag) return; let nl = sl + e.clientX - sx, nt = st + e.clientY - sy; const cr = panel.parentElement.getBoundingClientRect(), pr = panel.getBoundingClientRect(); nl = Math.max(0, Math.min(nl, cr.width - pr.width)); nt = Math.max(0, Math.min(nt, cr.height - pr.height)); panel.style.left = nl + "px"; panel.style.top = nt + "px"; };
  const up = () => drag = false;
  header.addEventListener("mousedown", down); document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
}
function initResizeHandles() {
  document.querySelectorAll('.resize-handle').forEach(handle => {
    if (handle.dataset.bound) return;
    handle.dataset.bound = "1";
    let resizing = false, sx, sy, sw, sh, panel;
    handle.addEventListener('mousedown', e => {
      panel = document.getElementById(handle.dataset.panel);
      if (!panel || panel.classList.contains('collapsed')) return;
      resizing = true;
      sx = e.clientX; sy = e.clientY;
      sw = panel.offsetWidth; sh = panel.offsetHeight;
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('mousemove', e => {
      if (!resizing) return;
      const nw = Math.max(180, sw + e.clientX - sx);
      const nh = Math.max(100, sh + e.clientY - sy);
      const cr = panel.parentElement.getBoundingClientRect();
      const r = panel.getBoundingClientRect();
      const maxW = cr.width - (r.left - cr.left) - 10;
      const maxH = cr.height - (r.top - cr.top) - 10;
      panel.style.width = Math.min(nw, maxW) + "px";
      panel.style.height = Math.min(nh, maxH) + "px";
    });
    document.addEventListener('mouseup', () => { resizing = false; });
  });
}

/* ---------- 复制模式 ESC 退出 ---------- */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (singleCopyTemplate) { e.preventDefault(); exitSingleCopy(); showToast("已取消复制"); }
    else if (multiCopyTemplate) { e.preventDefault(); exitMultiCopy(); }
  }
});

/* ---------- 设备框选与批量操作 ---------- */
function highlightDeviceMarker(id, highlight) {
  const m = markers.find(x => x._devId === id);
  if (!m) return;
  const el = m.getElement();
  if (!el) return;
  // 在标记内部元素上添加高亮（虚线框，CAD风格）
  const inner = el.querySelector('div');
  const target = inner || el;
  if (highlight) {
    target.style.outline = "2px dashed #3388ff";
    target.style.outlineOffset = "2px";
    el.style.zIndex = "1000";
    el.dataset.selected = "1";
  } else {
    target.style.outline = "";
    target.style.outlineOffset = "";
    el.style.zIndex = "";
    delete el.dataset.selected;
  }
}

function clearDeviceSelection() {
  selectedDeviceIds.forEach(id => highlightDeviceMarker(id, false));
  selectedDeviceIds = [];
}

async function deleteSelectedDevices() {
  if (selectedDeviceIds.length === 0) { showToast("请先选中设备"); return; }
  const ids = [...selectedDeviceIds];

  // 收集所有设备和关联数据用于撤销
  const deletedDevices = [];
  const allInspectLogs = [];
  const allMaintainLogs = [];
  const allWorkOrders = [];
  const allFormData = [];
  const allImages = [];

  const dbInspectLogs = await dbGetAll(S_LOG);
  const dbMaintainLogs = await dbGetAll(SL);
  const dbWorkOrders = await dbGetAll(S_WORKORDER);
  const dbFormData = await dbGetAll(S_FORM_DATA);
  const dbImages = await dbGetAll(SIMG);

  for (const id of ids) {
    const d = (await dbGetAll(SD)).find(x => x.id === id);
    if (!d) continue;
    deletedDevices.push(d);

    // 收集关联数据
    const devInspectLogs = dbInspectLogs.filter(l => (l.deviceId || l.device_id) === id);
    const devMaintainLogs = dbMaintainLogs.filter(l => (l.deviceId || l.device_id) === id);
    const devWorkOrders = dbWorkOrders.filter(w => (w.deviceId || w.device_id) === id);
    const devFormData = dbFormData.filter(f => f.relatedId === id);

    allInspectLogs.push(...devInspectLogs);
    allMaintainLogs.push(...devMaintainLogs);
    allWorkOrders.push(...devWorkOrders);
    allFormData.push(...devFormData);

    if (d.photoId) {
      const img = dbImages.find(i => i.id === d.photoId);
      if (img) allImages.push(img);
    }
  }

  const totalRelated = allInspectLogs.length + allMaintainLogs.length + allWorkOrders.length + allFormData.length;

  // 确认提示
  let confirmMsg = "⚠️确认删除选中的 " + deletedDevices.length + " 个设备？";
  if (totalRelated > 0) {
    confirmMsg += "\n\n将同时删除以下关联数据：";
    if (allInspectLogs.length > 0) confirmMsg += "\n  • 巡检记录：" + allInspectLogs.length + " 条";
    if (allMaintainLogs.length > 0) confirmMsg += "\n  • 维保记录：" + allMaintainLogs.length + " 条";
    if (allWorkOrders.length > 0) confirmMsg += "\n  • 维修工单：" + allWorkOrders.length + " 条";
    if (allFormData.length > 0) confirmMsg += "\n  • 表单数据：" + allFormData.length + " 条";
    confirmMsg += "\n\n删除后不可恢复，请确认！";
  }
  if (!await confirmDialog(confirmMsg)) return;

  // 保存撤销数据
  if (deletedDevices.length > 0) {
    pushUndo('cascade', {
      devices: deletedDevices,
      inspectLogs: allInspectLogs,
      maintainLogs: allMaintainLogs,
      workOrders: allWorkOrders,
      formDataList: allFormData,
      images: allImages
    }, "批量删除设备（" + deletedDevices.length + "个）");
    showUndoBar("批量删除设备（" + deletedDevices.length + "个）");
  }

  // 执行删除
  for (const id of ids) {
    await dbDel(SD, id);
    if (typeof Cloud !== 'undefined' && Cloud.enabled) Cloud.deleteDevice(id);
  }
  for (let l of allInspectLogs) await dbDel(S_LOG, l.id);
  for (let l of allMaintainLogs) await dbDel(SL, l.id);
  for (let w of allWorkOrders) await dbDel(S_WORKORDER, w.id);
  for (let f of allFormData) await dbDel(S_FORM_DATA, f.id);
  for (let img of allImages) await deleteImage(img.id);

  clearDeviceSelection();
  renderDeviceMarkers();
  if (typeof calcStat === 'function') calcStat();
  showToast("已删除 " + deletedDevices.length + " 个设备（含 " + totalRelated + " 条关联数据），按Ctrl+Z可恢复");
}

function startDeviceMove() {
  if (selectedDeviceIds.length === 0) { showToast("请先框选设备"); return; }
  deviceMoveMode = true;
  deviceMoveOrigins = [];
  selectedDeviceIds.forEach(id => {
    const m = markers.find(x => x._devId === id);
    if (m) {
      // 直接保存marker引用，避免拖动过程中markers数组被重新渲染导致找不到
      deviceMoveOrigins.push({ id, lat: m.getLatLng().lat, lng: m.getLatLng().lng, marker: m });
      m.setOpacity(0.5);
    }
  });
  document.body.style.cursor = "move";
  showToast("批量移动模式：拖拽移动选中设备，松开完成");
}

function onDeviceMoveDrag(e) {
  if (!deviceMoveMode || !deviceMoveStart) return;
  const dLat = e.latlng.lat - deviceMoveStart.lat;
  const dLng = e.latlng.lng - deviceMoveStart.lng;
  // 直接用保存的marker引用，避免markers数组被重新渲染导致找不到
  deviceMoveOrigins.forEach(o => {
    if (o.marker) o.marker.setLatLng([o.lat + dLat, o.lng + dLng]);
  });
}

async function finishDeviceMove(e) {
  if (!deviceMoveMode) return;
  // 检查是否实际移动了（位置变化超过阈值）
  let moved = false;
  const newPositions = [];
  for (const o of deviceMoveOrigins) {
    if (o.marker) {
      const lat = o.marker.getLatLng().lat;
      const lng = o.marker.getLatLng().lng;
      if (Math.abs(lat - o.lat) > 0.0001 || Math.abs(lng - o.lng) > 0.0001) moved = true;
      newPositions.push({ id: o.id, lat, lng, marker: o.marker });
    }
  }
  // 恢复实体
  for (const p of newPositions) {
    p.marker.setOpacity(1);
  }
  if (!moved) {
    // 没有移动，不保存，保持选中状态
    deviceMoveMode = false;
    document.body.style.cursor = "";
    deviceMoveOrigins = [];
    deviceMoveStart = null;
    return;
  }
  // 保存所有设备的新位置到数据库
  for (const p of newPositions) {
    const d = (await dbGetAll(SD)).find(x => x.id === p.id);
    if (d) {
      d.posX = p.lng;
      d.posY = p.lat;
      await dbPut(SD, d);
    }
  }
  // 全部保存完成后，再结束移动模式
  deviceMoveMode = false;
  document.body.style.cursor = "";
  deviceMoveOrigins = [];
  deviceMoveStart = null;
  // 移动完成后清空选中状态（CAD风格）
  if (typeof clearDeviceSelection === 'function') clearDeviceSelection();
  // 阻止移动后的click事件弹窗
  if (typeof blockNextClick === 'function') blockNextClick();
  // 移动完成后重新渲染，确保用新位置
  renderDeviceMarkers();
  showToast("设备位置已更新");
}

/* ---------- 框选功能（可独立拆分到box-select.js） ---------- */
function initBoxSelect(map) {
  const leafletContainer = map.getContainer();
  leafletContainer.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    if (!manageMode) return;
    if (typeof drawMode !== 'undefined' && drawMode) return;
    if (deviceMoveMode) return;
    const t = e.target;
    if (t.closest && (t.closest(".leaflet-marker-icon") || t.closest(".resize-handle") || t.closest("#context-menu") || t.closest(".leaflet-popup") || t.closest("#vector-toolbar"))) return;
    e.preventDefault();
    e.stopPropagation();
    mapBoxSelecting = true;
    justBoxSelected = true;
    mapBoxStartPt = { x: e.clientX, y: e.clientY };
    const overlay = document.getElementById("box-select-overlay");
    if (overlay) {
      overlay.style.display = "block";
      overlay.style.left = e.clientX + "px";
      overlay.style.top = e.clientY + "px";
      overlay.style.width = "0";
      overlay.style.height = "0";
    }
  });
  document.addEventListener("mousemove", e => {
    if (!mapBoxSelecting || !mapBoxStartPt) return;
    const overlay = document.getElementById("box-select-overlay");
    if (overlay) {
      const left = Math.min(mapBoxStartPt.x, e.clientX);
      const top = Math.min(mapBoxStartPt.y, e.clientY);
      overlay.style.left = left + "px";
      overlay.style.top = top + "px";
      overlay.style.width = Math.abs(e.clientX - mapBoxStartPt.x) + "px";
      overlay.style.height = Math.abs(e.clientY - mapBoxStartPt.y) + "px";
    }
  });
  document.addEventListener("mouseup", async e => {
    if (!mapBoxSelecting || !mapBoxStartPt || e.button !== 0) return;
    const overlay = document.getElementById("box-select-overlay");
    if (overlay) overlay.style.display = "none";
    const rect = leafletContainer.getBoundingClientRect();
    const x1 = mapBoxStartPt.x - rect.left;
    const y1 = mapBoxStartPt.y - rect.top;
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    const left = Math.min(x1, x2), top = Math.min(y1, y2);
    const right = Math.max(x1, x2), bottom = Math.max(y1, y2);
    mapBoxSelecting = false;
    mapBoxStartPt = null;
    if (right - left < 5 || bottom - top < 5) { justBoxSelected = false; return; }
    // 设备选中：用DOM实际位置做AABB碰撞
    clearDeviceSelection();
    let devCount = 0;
    const containerRect = leafletContainer.getBoundingClientRect();
    markers.forEach(m => {
      if (!m._devId) return;
      const el = m.getElement();
      if (!el) return;
      const r = el.getBoundingClientRect();
      const mL = r.left - containerRect.left, mT = r.top - containerRect.top;
      const mR = r.right - containerRect.left, mB = r.bottom - containerRect.top;
      if (mR >= left && mL <= right && mB >= top && mT <= bottom) {
        selectedDeviceIds.push(m._devId);
        highlightDeviceMarker(m._devId, true);
        devCount++;
      }
    });
    // 矢量图选中
    let vecCount = 0;
    if (typeof getVectorShapesByFloor === 'function' && typeof getShapeBounds === 'function' && typeof selectedVectors !== 'undefined') {
      const sw = map.containerPointToLatLng([left, bottom]);
      const ne = map.containerPointToLatLng([right, top]);
      const bounds = L.latLngBounds(sw, ne);
      const allShapes = await getVectorShapesByFloor(curF);
      selectedVectors = [];
      allShapes.forEach(s => {
        const sb = getShapeBounds(s);
        if (sb && bounds.intersects(sb)) { selectedVectors.push(s.id); vecCount++; }
      });
      if (typeof refreshSelectionBoxes === 'function') refreshSelectionBoxes();
    }
    if (devCount > 0 || vecCount > 0) {
      if (typeof showToast === 'function') showToast(`已选中：${vecCount}个矢量图，${devCount}个设备`);
      justBoxSelected = true;
      setTimeout(() => { justBoxSelected = false; }, 300);
      // CAD风格：如果处于"选择移动对象"模式，框选完成后自动进入移动
      if (deviceMoveSelectMode && devCount > 0) {
        deviceMoveSelectMode = false;
        setTimeout(() => startDeviceMove(), 350);
      }
    } else {
      if (typeof clearDeviceSelection === 'function') clearDeviceSelection();
    }
  });
}

/* ---------- 设备清单弹窗 ---------- */
let deviceListAllData = [];
async function showDeviceList(filter) {
  const titleMap = { all: "全部设备清单", "正常": "正常设备", "故障": "故障设备", "待维保": "待维保设备", "即将报废": "即将报废设备", "已超期": "已超期设备" };
  const allDevs = await dbGetAll(SD);
  const allBuildings = await dbGetAll(SB);
  const allFloors = await dbGetAll(SF);
  let devs = allDevs;
  if (filter === "即将报废" || filter === "已超期") {
    devs = allDevs.filter(d => {
      if (!d.installDate || !d.lifeYears) return false;
      const install = new Date(d.installDate);
      const expire = new Date(install);
      expire.setFullYear(expire.getFullYear() + parseInt(d.lifeYears));
      const now = new Date();
      const daysLeft = (expire - now) / (1000 * 60 * 60 * 24);
      if (filter === "已超期") return daysLeft < 0;
      return daysLeft >= 0 && daysLeft <= 365;
    });
  } else if (filter !== "all") {
    devs = allDevs.filter(d => (d.status || "正常") === filter);
  }
  deviceListAllData = devs.map(d => {
    const floor = allFloors.find(f => f.id === d.floorId);
    const building = floor ? allBuildings.find(b => b.id === floor.buildingId) : null;
    return { id: d.id, building: building ? building.name : "未分类", floor: floor ? floor.name : "未知楼层", type: d.deviceType || "未知", code: d.deviceCode || "未编号", status: d.status || "正常", position: d.positionDesc || "-", model: d.model || "-", floorId: d.floorId, posX: d.posX, posY: d.posY };
  });
  createDeviceListModal(titleMap[filter] || "设备清单");
}
function createDeviceListModal(title) {
  const old = document.getElementById("device-list-modal-dynamic");
  if (old) old.remove();
  const modal = document.createElement("div");
  modal.id = "device-list-modal-dynamic";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999";
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
  const box = document.createElement("div");
  box.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#fff;border-radius:10px;width:90%;max-width:1000px;height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.3)";
  const header = document.createElement("div");
  header.style.cssText = "padding:14px 18px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none";
  header.innerHTML = "<span style=\"font-size:16px;font-weight:bold\">" + title + "</span><button style=\"background:none;border:none;font-size:18px;cursor:pointer;color:#666;padding:4px 8px\">✕</button>";
  header.querySelector("button").onclick = function() { modal.remove(); };
  // 拖拽移动
  let isDragging = false, dragOX = 0, dragOY = 0;
  header.addEventListener("mousedown", function(e) {
    if (e.target.tagName === "BUTTON") return;
    isDragging = true;
    const rect = box.getBoundingClientRect();
    dragOX = e.clientX - rect.left;
    dragOY = e.clientY - rect.top;
    box.style.transform = "none";
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", stopDrag);
    e.preventDefault();
  });
  function onDrag(e) {
    if (!isDragging) return;
    box.style.left = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOX)) + "px";
    box.style.top = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOY)) + "px";
  }
  function stopDrag() {
    isDragging = false;
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup", stopDrag);
  }
  const searchBar = document.createElement("div");
  searchBar.style.cssText = "padding:10px 16px;border-bottom:1px solid #eee;display:flex;gap:10px;align-items:center";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "搜索设备类型/编号/位置...";
  input.style.cssText = "flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:4px";
  const count = document.createElement("span");
  count.style.cssText = "font-size:13px;color:#666;white-space:nowrap";
  searchBar.appendChild(input);
  searchBar.appendChild(count);
  const content = document.createElement("div");
  content.style.cssText = "flex:1;overflow:auto;min-height:0";
  box.appendChild(header);
  box.appendChild(searchBar);
  box.appendChild(content);
  modal.appendChild(box);
  document.body.appendChild(modal);
  // ESC键关闭
  const escHandler = function(e) { if (e.key === "Escape") { modal.remove(); document.removeEventListener("keydown", escHandler); } };
  document.addEventListener("keydown", escHandler);
  renderDeviceListToContainer(content, count);
  input.oninput = function() {
    const kw = input.value.toLowerCase();
    const filtered = deviceListAllData.filter(function(d) { return d.type.toLowerCase().includes(kw) || d.code.toLowerCase().includes(kw) || d.position.toLowerCase().includes(kw) || d.building.toLowerCase().includes(kw) || d.floor.toLowerCase().includes(kw); });
    renderDeviceListToContainer(content, count, filtered);
  };
}
function renderDeviceListToContainer(container, countEl, data) {
  const list = data || deviceListAllData;
  if (list.length === 0) { container.innerHTML = "<div style=\"padding:30px;text-align:center;color:#999\">暂无设备</div>"; countEl.innerText = "共0条"; return; }
  const statusColor = { "正常": "#16a34a", "故障": "#dc2626", "待维保": "#ca8a04", "已报废": "#6b7280" };
  const rows = [];
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    rows.push("<div class=\"dev-list-row\" data-id=\"" + d.id + "\" data-floor=\"" + d.floorId + "\" data-x=\"" + d.posX + "\" data-y=\"" + d.posY + "\" style=\"display:flex;padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#333;cursor:pointer\"><span style=\"flex:1\">" + d.building + "</span><span style=\"flex:1\">" + (d.floor || "-") + "</span><span style=\"flex:1;font-weight:500\">" + d.type + "</span><span style=\"flex:1\">" + d.code + "</span><span style=\"flex:1;color:" + (statusColor[d.status] || "#333") + "\">" + d.status + "</span><span style=\"flex:2;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">" + d.position + "</span><span style=\"flex:1;color:#666\">" + d.model + "</span><span style=\"flex:0 0 50px;text-align:center;color:#3b82f6\">定位</span></div>");
  }
  container.innerHTML = rows.join("");
  container.onclick = function(e) {
    const row = e.target.closest(".dev-list-row");
    if (row) { locateDevice(row.dataset.id, row.dataset.floor, parseFloat(row.dataset.x), parseFloat(row.dataset.y)); }
  };
  countEl.innerText = "共" + list.length + "条";
}
function locateDevice(id, floorId, x, y) {
  // 关闭动态弹窗
  const modal = document.getElementById("device-list-modal-dynamic");
  if (modal) modal.remove();
  // 切换到对应楼层
  if (typeof selectFloor === 'function' && floorId) {
    selectFloor(floorId);
  }
  // 延迟定位到设备位置
  setTimeout(() => {
    if (map) {
      map.setView([y, x], floorBaseZoom || map.getZoom(), { animate: true });
      // 高亮设备
      const m = markers.find(mk => mk._devId === id);
      if (m) {
        highlightDeviceMarker(id, true);
        setTimeout(() => highlightDeviceMarker(id, false), 2000);
      }
    }
  }, 300);
}


