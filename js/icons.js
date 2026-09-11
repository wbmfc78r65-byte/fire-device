/* ============================================================
 * icons.js - 消防矢量图标库（SVG，支持编辑+绘图）
 * 依赖：db.js
 * ============================================================ */

let editingIconName = "";
let currentDrawTool = "pen";
let isDrawing = false;
let drawStartPt = null;
let drawCurrentEl = null;
let drawHistory = [];

function svgToDataURL(svg, color) {
  let colored = svg.replace(/currentColor/g, color);
  if (!colored.includes('xmlns')) {
    colored = colored.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(colored);
}

function renderIconPicker() {
  const wrap = $("icon-picker-wrap");
  if (!wrap) return;
  const colorEl = $("leg-color");
  const color = colorEl ? colorEl.value : "#d92121";
  if (typeof fireIconLibrary === 'undefined' || !Object.keys(fireIconLibrary).length) {
    wrap.innerHTML = '<div style="color:#999;font-size:12px;padding:10px">图标库未加载</div>';
    return;
  }
  let html = '<div class="icon-picker-grid">';
  Object.keys(fireIconLibrary).forEach(name => {
    const isDefault = name in defaultFireIcons;
    html += `<div class="icon-picker-item" title="${name}">
      <div class="icon-picker-svg" onclick="applyPresetIcon('${name}')" style="color:${color}">${fireIconLibrary[name]}</div>
      <span>${name}</span>
      <div class="icon-picker-actions">
        <button class="icon-edit-btn" onclick="editPresetIcon('${name}')" title="编辑">✏️</button>
        ${isDefault ? '' : `<button class="icon-del-btn" onclick="deletePresetIcon('${name}')" title="删除">🗑️</button>`}
      </div>
    </div>`;
  });
  html += `<div class="icon-picker-item add-icon" onclick="addPresetIcon()" title="新增图标">
    <div class="icon-picker-svg add-icon-svg">+</div>
    <span>新增</span>
  </div>`;
  html += '</div>';
  html += `<div style="text-align:right;margin-top:6px"><button class="btn ghost" style="padding:2px 8px;font-size:11px" onclick="resetPresetIcons()">↩ 恢复默认图标</button></div>`;
  wrap.innerHTML = html;
}

async function applyPresetIcon(name) {
  const svg = fireIconLibrary[name];
  if (!svg) return;
  const color = $("leg-color").value;
  const dataUrl = svgToDataURL(svg, color);
  tempLegendIcon = dataUrl;
  tempLegendIconW = 24; tempLegendIconH = 24;
  $("leg-icon-file").value = null;
  updateLegendIconPreview();
  updateLegSizePreview();
  showToast(`已应用图标：${name}`);
}

function syncIconColor() {
  if (!tempLegendIcon || !tempLegendIcon.startsWith("data:image/svg+xml")) return;
  const color = $("leg-color").value;
  try {
    const decoded = decodeURIComponent(tempLegendIcon.replace("data:image/svg+xml;charset=utf-8,", ""));
    const newSvg = decoded.replace(/#[0-9a-fA-F]{6}/g, color);
    tempLegendIcon = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(newSvg);
    updateLegendIconPreview();
  } catch (e) { }
}

/* ---------- 预设图标编辑 ---------- */
function editPresetIcon(name) {
  editingIconName = name;
  $("icon-edit-name").value = name;
  $("icon-edit-svg").value = fireIconLibrary[name];
  // 默认图标显示恢复默认按钮
  const resetBtn = $("btn-reset-single-icon");
  if (resetBtn) resetBtn.style.display = (name in defaultFireIcons) ? "inline-block" : "none";
  switchIconEditTab('draw');
  loadSvgToDrawBoard(fireIconLibrary[name]);
  updateIconEditPreview();
  openModal("modal-icon-edit");
}
function addPresetIcon() {
  editingIconName = "";
  $("icon-edit-name").value = "";
  $("icon-edit-svg").value = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"></svg>';
  const resetBtn = $("btn-reset-single-icon");
  if (resetBtn) resetBtn.style.display = "none";
  switchIconEditTab('draw');
  clearDrawBoard();
  updateIconEditPreview();
  openModal("modal-icon-edit");
}
function switchIconEditTab(tab, btn) {
  document.querySelectorAll('.icon-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  $("icon-edit-draw-panel").style.display = tab === 'draw' ? 'block' : 'none';
  $("icon-edit-pixel-panel").style.display = tab === 'pixel' ? 'block' : 'none';
  $("icon-edit-code-panel").style.display = tab === 'code' ? 'block' : 'none';
  if (tab === 'draw') {
    loadSvgToDrawBoard($("icon-edit-svg").value);
  } else if (tab === 'pixel') {
    svgToPixel($("icon-edit-svg").value);
  } else {
    if ($("icon-edit-pixel-panel").style.display === 'block') syncSvgFromPixel();
    if ($("icon-edit-draw-panel").style.display === 'block') $("icon-edit-svg").value = serializeDrawBoard();
    updateIconEditPreview();
  }
}
function updateIconEditPreview() {
  const svg = $("icon-edit-svg").value;
  const color = $("leg-color") ? $("leg-color").value : "#d92121";
  const box = $("icon-edit-preview");
  if (box) {
    try {
      box.innerHTML = `<img src="${svgToDataURL(svg, color)}" alt="" style="width:48px;height:48px"/>`;
    } catch (e) { box.innerHTML = '<span style="color:red;font-size:11px">SVG格式错误</span>'; }
  }
}
function savePresetIcon() {
  const name = $("icon-edit-name").value.trim();
  let svg = $("icon-edit-draw-panel").style.display !== 'none' ? serializeDrawBoard() : $("icon-edit-svg").value.trim();
  if (!name) { showToast("名称不能为空"); return; }
  if (!svg.startsWith("<svg")) { showToast("SVG内容必须以<svg开头"); return; }
  if (editingIconName && editingIconName !== name) {
    delete fireIconLibrary[editingIconName];
  }
  fireIconLibrary[name] = svg;
  saveFireIcons();
  closeModal("modal-icon-edit");
  renderIconPicker();
  if (typeof renderAllLegend === 'function') renderAllLegend();
  if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
  showToast(editingIconName ? "图标已更新" : "新增图标成功");
}
async function deletePresetIcon(name) {
  if (!await confirmDialog(`确认删除图标「${name}」？`)) return;
  delete fireIconLibrary[name];
  saveFireIcons();
  renderIconPicker();
  if (typeof renderAllLegend === 'function') renderAllLegend();
  showToast("图标已删除");
}
async function resetPresetIcons() {
  if (!await confirmDialog("确认恢复为默认12种图标？自定义图标将被清除")) return;
  resetFireIcons();
  renderIconPicker();
  if (typeof renderAllLegend === 'function') renderAllLegend();
  if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
  showToast("已恢复默认图标");
}
async function resetSinglePresetIcon() {
  if (!editingIconName || !(editingIconName in defaultFireIcons)) {
    showToast("该图标不是默认图标，无法恢复");
    return;
  }
  if (!await confirmDialog(`确认恢复图标「${editingIconName}」为默认样式？`)) return;
  const defaultSvg = defaultFireIcons[editingIconName];
  fireIconLibrary[editingIconName] = defaultSvg;
  saveFireIcons();
  // 更新编辑窗口
  $("icon-edit-svg").value = defaultSvg;
  loadSvgToDrawBoard(defaultSvg);
  updateIconEditPreview();
  renderIconPicker();
  if (typeof renderAllLegend === 'function') renderAllLegend();
  if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
  showToast("已恢复默认图标");
}

/* ---------- SVG 绘图板 ---------- */
function initDrawBoard() {
  const board = $("draw-board");
  if (!board || board.dataset.bound) return;
  board.dataset.bound = "1";
  document.querySelectorAll('.draw-tool[data-tool]').forEach(btn => {
    btn.onclick = () => {
      currentDrawTool = btn.dataset.tool;
      document.querySelectorAll('.draw-tool[data-tool]').forEach(b => b.classList.toggle('active', b === btn));
    };
  });
  board.addEventListener('mousedown', onDrawMouseDown);
  board.addEventListener('mousemove', onDrawMouseMove);
  board.addEventListener('mouseup', onDrawMouseUp);
  board.addEventListener('mouseleave', onDrawMouseUp);
}

function getSvgPoint(e) {
  const svg = $("draw-board");
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = svg.getScreenCTM();
  if (ctm) {
    const p = pt.matrixTransform(ctm.inverse());
    return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
  }
  return { x: 0, y: 0 };
}

function getDrawStyle() {
  const color = $("draw-color").value;
  const width = parseFloat($("draw-width").value);
  const fill = $("draw-fill").checked;
  return { color, width, fill };
}

function onDrawMouseDown(e) {
  if (e.button !== 0) return;
  const pt = getSvgPoint(e);
  const board = $("draw-board");
  const { color, width, fill } = getDrawStyle();

  if (currentDrawTool === 'eraser') {
    const target = e.target;
    if (target && target !== board) {
      pushDrawHistory();
      target.remove();
      syncSvgFromBoard();
    }
    return;
  }

  isDrawing = true;
  drawStartPt = pt;
  pushDrawHistory();

  const SVG_NS = "http://www.w3.org/2000/svg";
  if (currentDrawTool === 'pen') {
    drawCurrentEl = document.createElementNS(SVG_NS, 'path');
    drawCurrentEl.setAttribute('d', `M ${pt.x} ${pt.y}`);
    drawCurrentEl.setAttribute('fill', 'none');
    drawCurrentEl.setAttribute('stroke', color);
    drawCurrentEl.setAttribute('stroke-width', width);
    drawCurrentEl.setAttribute('stroke-linecap', 'round');
    drawCurrentEl.setAttribute('stroke-linejoin', 'round');
    board.appendChild(drawCurrentEl);
  } else if (currentDrawTool === 'line') {
    drawCurrentEl = document.createElementNS(SVG_NS, 'line');
    drawCurrentEl.setAttribute('x1', pt.x); drawCurrentEl.setAttribute('y1', pt.y);
    drawCurrentEl.setAttribute('x2', pt.x); drawCurrentEl.setAttribute('y2', pt.y);
    drawCurrentEl.setAttribute('stroke', color);
    drawCurrentEl.setAttribute('stroke-width', width);
    drawCurrentEl.setAttribute('stroke-linecap', 'round');
    board.appendChild(drawCurrentEl);
  } else if (currentDrawTool === 'rect') {
    drawCurrentEl = document.createElementNS(SVG_NS, 'rect');
    drawCurrentEl.setAttribute('x', pt.x); drawCurrentEl.setAttribute('y', pt.y);
    drawCurrentEl.setAttribute('width', 0); drawCurrentEl.setAttribute('height', 0);
    drawCurrentEl.setAttribute('fill', fill ? color : 'none');
    drawCurrentEl.setAttribute('stroke', color);
    drawCurrentEl.setAttribute('stroke-width', width);
    board.appendChild(drawCurrentEl);
  } else if (currentDrawTool === 'circle') {
    drawCurrentEl = document.createElementNS(SVG_NS, 'ellipse');
    drawCurrentEl.setAttribute('cx', pt.x); drawCurrentEl.setAttribute('cy', pt.y);
    drawCurrentEl.setAttribute('rx', 0); drawCurrentEl.setAttribute('ry', 0);
    drawCurrentEl.setAttribute('fill', fill ? color : 'none');
    drawCurrentEl.setAttribute('stroke', color);
    drawCurrentEl.setAttribute('stroke-width', width);
    board.appendChild(drawCurrentEl);
  }
}

function onDrawMouseMove(e) {
  if (!isDrawing || !drawCurrentEl) return;
  const pt = getSvgPoint(e);
  const s = drawStartPt;

  if (currentDrawTool === 'pen') {
    const d = drawCurrentEl.getAttribute('d');
    drawCurrentEl.setAttribute('d', d + ` L ${pt.x} ${pt.y}`);
  } else if (currentDrawTool === 'line') {
    drawCurrentEl.setAttribute('x2', pt.x);
    drawCurrentEl.setAttribute('y2', pt.y);
  } else if (currentDrawTool === 'rect') {
    drawCurrentEl.setAttribute('x', Math.min(s.x, pt.x));
    drawCurrentEl.setAttribute('y', Math.min(s.y, pt.y));
    drawCurrentEl.setAttribute('width', Math.abs(pt.x - s.x));
    drawCurrentEl.setAttribute('height', Math.abs(pt.y - s.y));
  } else if (currentDrawTool === 'circle') {
    drawCurrentEl.setAttribute('cx', (s.x + pt.x) / 2);
    drawCurrentEl.setAttribute('cy', (s.y + pt.y) / 2);
    drawCurrentEl.setAttribute('rx', Math.abs(pt.x - s.x) / 2);
    drawCurrentEl.setAttribute('ry', Math.abs(pt.y - s.y) / 2);
  }
}

function onDrawMouseUp() {
  if (!isDrawing) return;
  isDrawing = false;
  drawCurrentEl = null;
  syncSvgFromBoard();
}

function pushDrawHistory() {
  drawHistory.push(serializeDrawBoard());
  if (drawHistory.length > 30) drawHistory.shift();
}

function undoDraw() {
  if (!drawHistory.length) return;
  const prev = drawHistory.pop();
  loadSvgToDrawBoard(prev);
  syncSvgFromBoard();
}

function clearDrawBoard() {
  pushDrawHistory();
  const board = $("draw-board");
  while (board.firstChild) board.removeChild(board.firstChild);
  syncSvgFromBoard();
}

function serializeDrawBoard() {
  const board = $("draw-board");
  if (!board) return '<svg viewBox="0 0 24 24"></svg>';
  let inner = "";
  Array.from(board.children).forEach(el => { inner += el.outerHTML; });
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

function syncSvgFromBoard() {
  const svg = serializeDrawBoard();
  $("icon-edit-svg").value = svg;
  updateIconEditPreview();
}

function loadSvgToDrawBoard(svgStr) {
  const board = $("draw-board");
  if (!board) return;
  while (board.firstChild) board.removeChild(board.firstChild);
  drawHistory = [];
  if (!svgStr) return;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgStr, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (svg) {
      Array.from(svg.children).forEach(child => {
        board.appendChild(document.importNode(child, true));
      });
    }
  } catch (e) { }
}

/* ---------- 像素编辑器 ---------- */
let pixelData = [];
let pixelSize = 24;
let isPixelDrawing = false;

function initPixelGrid() {
  pixelSize = parseInt($("pixel-size").value) || 24;
  pixelData = [];
  for (let r = 0; r < pixelSize; r++) {
    pixelData[r] = [];
    for (let c = 0; c < pixelSize; c++) pixelData[r][c] = null;
  }
  renderPixelGrid();
}

function renderPixelGrid() {
  const grid = $("pixel-grid");
  if (!grid) return;
  const wrap = grid.parentElement;
  const wrapW = wrap.clientWidth - 20;
  const wrapH = wrap.clientHeight - 20;
  const size = Math.min(wrapW, wrapH, 400);
  grid.style.width = size + "px";
  grid.style.height = size + "px";
  grid.style.gridTemplateColumns = `repeat(${pixelSize}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${pixelSize}, 1fr)`;
  let html = "";
  for (let r = 0; r < pixelSize; r++) {
    for (let c = 0; c < pixelSize; c++) {
      const color = pixelData[r][c];
      html += `<div class="pixel-cell" data-row="${r}" data-col="${c}" style="background:${color || 'transparent'}"></div>`;
    }
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.pixel-cell').forEach(cell => {
    cell.addEventListener('mousedown', onPixelMouseDown);
    cell.addEventListener('mouseenter', onPixelMouseEnter);
  });
  grid.addEventListener('mouseup', onPixelMouseUp);
  grid.addEventListener('mouseleave', onPixelMouseUp);
}

function onPixelMouseDown(e) {
  isPixelDrawing = true;
  paintPixel(e.currentTarget);
  e.preventDefault();
}
function onPixelMouseEnter(e) {
  if (isPixelDrawing) paintPixel(e.currentTarget);
}
function onPixelMouseUp() {
  isPixelDrawing = false;
  syncSvgFromPixel();
}

function paintPixel(cell) {
  const r = parseInt(cell.dataset.row);
  const c = parseInt(cell.dataset.col);
  const eraser = $("pixel-eraser").checked;
  pixelData[r][c] = eraser ? null : $("pixel-color").value;
  cell.style.background = pixelData[r][c] || 'transparent';
}

function clearPixelGrid() {
  for (let r = 0; r < pixelSize; r++)
    for (let c = 0; c < pixelSize; c++) pixelData[r][c] = null;
  renderPixelGrid();
  syncSvgFromPixel();
}

function fillPixelGrid() {
  const color = $("pixel-eraser").checked ? null : $("pixel-color").value;
  for (let r = 0; r < pixelSize; r++)
    for (let c = 0; c < pixelSize; c++) pixelData[r][c] = color;
  renderPixelGrid();
  syncSvgFromPixel();
}

function pixelToSvg() {
  const antialias = $("pixel-antialias") && $("pixel-antialias").checked;
  let rects = "";
  for (let r = 0; r < pixelSize; r++) {
    for (let c = 0; c < pixelSize; c++) {
      if (pixelData[r][c]) {
        const color = pixelData[r][c];
        rects += `<rect x="${c}" y="${r}" width="1" height="1" fill="${color}"/>`;
        if (antialias) {
          // 上边缘
          if (r === 0 || !pixelData[r-1][c]) {
            rects += `<rect x="${c}" y="${r - 0.5}" width="1" height="0.5" fill="${color}" opacity="0.4"/>`;
          }
          // 下边缘
          if (r === pixelSize - 1 || !pixelData[r+1][c]) {
            rects += `<rect x="${c}" y="${r + 1}" width="1" height="0.5" fill="${color}" opacity="0.4"/>`;
          }
          // 左边缘
          if (c === 0 || !pixelData[r][c-1]) {
            rects += `<rect x="${c - 0.5}" y="${r}" width="0.5" height="1" fill="${color}" opacity="0.4"/>`;
          }
          // 右边缘
          if (c === pixelSize - 1 || !pixelData[r][c+1]) {
            rects += `<rect x="${c + 1}" y="${r}" width="0.5" height="1" fill="${color}" opacity="0.4"/>`;
          }
        }
      }
    }
  }
  const pad = antialias ? 1 : 0;
  return `<svg viewBox="${-pad} ${-pad} ${pixelSize + pad*2} ${pixelSize + pad*2}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

function svgToPixel(svgStr) {
  pixelSize = 24;
  pixelData = [];
  for (let r = 0; r < pixelSize; r++) {
    pixelData[r] = [];
    for (let c = 0; c < pixelSize; c++) pixelData[r][c] = null;
  }
  if (svgStr && svgStr.includes('<rect')) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgStr, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (svg) {
        const vb = svg.getAttribute('viewBox');
        let offsetX = 0, offsetY = 0;
        if (vb) {
          const parts = vb.split(/\s+/);
          offsetX = parseInt(parts[0]) || 0;
          offsetY = parseInt(parts[1]) || 0;
          const sz = parseInt(parts[2]) || 24;
          if (sz >= 8 && sz <= 64) pixelSize = sz - Math.abs(offsetX) * 2;
        }
        if (pixelSize < 8) pixelSize = 24;
        $("pixel-size").value = pixelSize;
        pixelData = [];
        for (let r = 0; r < pixelSize; r++) {
          pixelData[r] = [];
          for (let c = 0; c < pixelSize; c++) pixelData[r][c] = null;
        }
        svg.querySelectorAll('rect').forEach(rect => {
          // 跳过抗锯齿产生的半透明矩形
          const opacity = parseFloat(rect.getAttribute('opacity'));
          if (opacity && opacity < 1) return;
          const x = parseInt(rect.getAttribute('x')) || 0;
          const y = parseInt(rect.getAttribute('y')) || 0;
          const w = parseInt(rect.getAttribute('width')) || 1;
          const h = parseInt(rect.getAttribute('height')) || 1;
          const fill = rect.getAttribute('fill') || '#000';
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
              const ry = y + dy - offsetY, cx = x + dx - offsetX;
              if (ry >= 0 && ry < pixelSize && cx >= 0 && cx < pixelSize) {
                pixelData[ry][cx] = fill;
              }
            }
          }
        });
      }
    } catch (e) { }
  }
  renderPixelGrid();
}

function syncSvgFromPixel() {
  $("icon-edit-svg").value = pixelToSvg();
  updateIconEditPreview();
}

async function autoApplyAllIcons() {
  const legs = await getAllLegend();
  const backup = [];
  let count = 0;
  for (let leg of legs) {
    if (fireIconLibrary[leg.name]) {
      backup.push(JSON.parse(JSON.stringify(leg))); // 备份原始数据
      leg.icon = svgToDataURL(fireIconLibrary[leg.name], leg.color);
      leg.iconW = 24; leg.iconH = 24;
      await dbPut(SLEG, leg);
      count++;
    }
  }
  if (typeof renderAllLegend === 'function') renderAllLegend();
  if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
  if (count > 0) {
    // 推入撤销栈，复用系统撤销机制
    if (typeof undoStack !== 'undefined') {
      undoStack.push({ store: 'cascade', data: { legends: backup }, desc: `一键应用矢量图标(${count}个图例)` });
    }
    if (typeof showUndoBar === 'function') showUndoBar(`一键应用矢量图标(${count}个图例)`);
  } else {
    showToast("无匹配的图例");
  }
}
