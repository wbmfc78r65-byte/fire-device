/* ============================================================
 * dxf.js - CAD DXF 文件导入
 * 外部加载 dxf-parser 库（CDN），不打包进主代码
 * 解析后转为矢量图形存 SVEC store
 * ============================================================ */

let dxfParserLoaded = false;

function loadDxfParser() {
  return new Promise((res, rej) => {
    if (dxfParserLoaded) return res();
    if (typeof DxfParser !== 'undefined') { dxfParserLoaded = true; return res(); }
    // 本地库已在 index.html 中加载，这里做兜底检查
    const s = document.createElement('script');
    s.src = "lib/dxf-parser.min.js";
    s.onload = () => { dxfParserLoaded = true; res(); };
    s.onerror = () => rej(new Error("DXF解析库加载失败"));
    document.head.appendChild(s);
  });
}

async function importDxfFile() {
  const file = $("dxf-file-input").files[0];
  if (!file) { showToast("请先选择DXF文件"); return; }
  if (!curF) { showToast("请先选择建筑和楼层"); return; }
  try {
    showToast("正在加载DXF解析库...");
    await loadDxfParser();
    showToast("正在解析DXF文件...");
    const text = await file.text();
    const parser = new DxfParser();
    const dxf = parser.parseSync(text);
    if (!dxf || !dxf.entities) { showToast("DXF文件解析失败或无实体"); return; }
    const entities = dxf.entities;
    // 计算边界用于坐标映射
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const shapes = [];
    for (const ent of entities) {
      if (ent.type === 'LINE' && ent.vertices && ent.vertices.length >= 2) {
        const v0 = ent.vertices[0], v1 = ent.vertices[1];
        minX = Math.min(minX, v0.x, v1.x); maxX = Math.max(maxX, v0.x, v1.x);
        minY = Math.min(minY, v0.y, v1.y); maxY = Math.max(maxY, v0.y, v1.y);
        shapes.push({ type: 'line', points: [[v0.x, v0.y], [v1.x, v1.y]], color: ent.color !== undefined ? colorIndexToHex(ent.color) : '#333333' });
      } else if (ent.type === 'CIRCLE' && ent.center) {
        minX = Math.min(minX, ent.center.x - ent.radius); maxX = Math.max(maxX, ent.center.x + ent.radius);
        minY = Math.min(minY, ent.center.y - ent.radius); maxY = Math.max(maxY, ent.center.y + ent.radius);
        shapes.push({ type: 'circle', center: [ent.center.x, ent.center.y], radius: ent.radius, color: ent.color !== undefined ? colorIndexToHex(ent.color) : '#333333' });
      } else if (ent.type === 'LWPOLYLINE' && ent.vertices) {
        const pts = ent.vertices.map(v => [v.x, v.y]);
        pts.forEach(p => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
        shapes.push({ type: ent.shape ? 'polygon' : 'line', points: pts, color: ent.color !== undefined ? colorIndexToHex(ent.color) : '#333333' });
      } else if (ent.type === 'ARC' && ent.center) {
        minX = Math.min(minX, ent.center.x - ent.radius); maxX = Math.max(maxX, ent.center.x + ent.radius);
        minY = Math.min(minY, ent.center.y - ent.radius); maxY = Math.max(maxY, ent.center.y + ent.radius);
        shapes.push({ type: 'arc', center: [ent.center.x, ent.center.y], radius: ent.radius, startAngle: ent.startAngle, endAngle: ent.endAngle, color: ent.color !== undefined ? colorIndexToHex(ent.color) : '#333333' });
      }
    }
    if (!shapes.length) { showToast("未找到可导入的图形实体"); return; }
    if (!await confirmDialog(`解析到 ${shapes.length} 个图形实体，是否导入到当前楼层？`)) return;
    // 坐标映射：DXF坐标 → 地图坐标（0~图片宽高）
    const floor = (await dbGetAll(SF)).find(f => f.id === curF);
    const imgUrl = floor.imageId ? await getImage(floor.imageId) : null;
    let mapW = 1000, mapH = 800;
    if (imgUrl) {
      const dim = await getImageDimensions(imgUrl);
      mapW = dim.w; mapH = dim.h;
    }
    const dx = maxX - minX || 1, dy = maxY - minY || 1;
    const scale = Math.min(mapW / dx, mapH / dy) * 0.9;
    const offsetX = (mapW - dx * scale) / 2;
    const offsetY = (mapH - dy * scale) / 2;
    const toMap = (x, y) => [mapH - (offsetY + (y - minY) * scale), offsetX + (x - minX) * scale];
    let imported = 0;
    for (const s of shapes) {
      let shapeData;
      if (s.type === 'line') {
        shapeData = { type: 'line', latlngs: s.points.map(p => toMap(p[0], p[1])) };
      } else if (s.type === 'polygon') {
        shapeData = { type: 'polygon', latlngs: s.points.map(p => toMap(p[0], p[1])) };
      } else if (s.type === 'circle') {
        const c = toMap(s.center[0], s.center[1]);
        shapeData = { type: 'circle', center: c, radius: s.radius * scale };
      } else continue;
      const o = { id: genId(), floorId: curF, shape: shapeData, color: s.color, opacity: 0.5, weight: 1, fill: false, name: "DXF-" + s.type };
      await dbPut(SVEC, o);
      imported++;
    }
    $("dxf-file-input").value = "";
    if (typeof loadVectorShapes === 'function') loadVectorShapes();
    showToast(`成功导入 ${imported} 个图形`);
  } catch (e) {
    alert("DXF导入失败：" + e.message);
  }
}

function colorIndexToHex(idx) {
  const colors = {
    0: '#000000', 1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff',
    5: '#0000ff', 6: '#ff00ff', 7: '#ffffff', 8: '#808080', 9: '#c0c0c0',
    10: '#ff0000', 11: '#ff7f00', 12: '#ffff00', 13: '#7fff00', 14: '#00ff00',
    15: '#00ff7f', 16: '#00ffff', 17: '#007fff', 18: '#0000ff', 19: '#7f00ff',
    20: '#ff00ff', 21: '#ff007f', 22: '#ee0000', 23: '#ee1100', 24: '#ee2200'
  };
  return colors[idx] || '#333333';
}

function getImageDimensions(url) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res({ w: img.width, h: img.height });
    img.onerror = () => res({ w: 1000, h: 800 });
    img.src = url;
  });
}
