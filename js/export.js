/* ============================================================
 * export.js - 导出Excel / JSON备份 / 数据管理
 * 依赖：db.js
 * ============================================================ */

/* ---------- Excel导出 ---------- */
async function exportExcel() {
  const dev = await dbGetAll(SD), bs = await dbGetAll(SB), fs = await dbGetAll(SF);
  if (!dev.length) { showToast("暂无设施数据"); return; }
  const rows = dev.map(d => {
    const f = fs.find(x => x.id === d.floorId), b = bs.find(x => x.id === f?.buildingId), life = calcDeviceLife(d);
    return {
      "建筑名称": b?.name || "-", "楼层": f?.floorName || "-", "设施类型": d.deviceType,
      "设备编号": d.deviceCode || "", "位置描述": d.positionDesc || "", "安装日期": d.installDate || "",
      "预计使用年限": d.lifeYears || "-", "已使用年限": life.status === 'none' ? "-" : life.age,
      "剩余寿命": life.status === 'none' ? "-" : life.remain,
      "寿命状态": life.status === 'none' ? "未设置" : life.status === 'ok' ? "正常" : life.status === 'warn' ? "即将报废" : "已超期",
      "下次维保日期": d.nextMaintain || "", "设备状态": d.status, "备注": d.remark || ""
    };
  });
  const wb = XLSX.utils.book_new(), ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "消防设施资产表");
  XLSX.writeFile(wb, "消防设施资产台账.xlsx");
  showToast("Excel导出成功");
}
async function exportMaintainExcel() {
  const logs = await dbGetAll(SL), dev = await dbGetAll(SD), bs = await dbGetAll(SB), fs = await dbGetAll(SF);
  if (!logs.length) { showToast("暂无维保记录"); return; }
  const rows = logs.sort((a, b) => new Date(b.logDate) - new Date(a.logDate)).map(l => {
    const d = dev.find(x => x.id === l.deviceId), f = fs.find(x => x.id === d?.floorId), b = bs.find(x => x.id === f?.buildingId);
    return { "维保日期": l.logDate, "建筑": b?.name || "-", "楼层": f?.floorName || "-", "设施": d ? (d.deviceType + " " + d.deviceCode) : "已删除", "维保人员": l.person || "-", "维保结果": l.result, "备注": l.remark || "-" };
  });
  const wb = XLSX.utils.book_new(), ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "维保记录台账");
  XLSX.writeFile(wb, "消防维保记录台账.xlsx");
  showToast("维保记录Excel导出成功");
}
async function openFacilityList() {
  openModal("modal-facility-list");
  // 先同步设备状态
  if (typeof syncDeviceStatusFromInspectRecords === 'function') await syncDeviceStatusFromInspectRecords();
  const dev = await dbGetAll(SD), bs = await dbGetAll(SB), fs = await dbGetAll(SF);
  const wrap = $("facility-table-wrap");
  if (!dev.length) { wrap.innerHTML = "<div class='empty-tip'>暂无设施数据</div>"; return; }
  const statusColor = { "正常": "#16a34a", "故障": "#dc2626", "待维保": "#ca8a04", "已报废": "#6b7280" };
  let html = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:#f8fafc">
      <th style="padding:10px 8px;text-align:left;border-bottom:2px solid #e5e7eb">建筑</th>
      <th style="padding:10px 8px;text-align:left;border-bottom:2px solid #e5e7eb;background:#f0f9ff">🏬 楼层</th>
      <th style="padding:10px 8px;text-align:left;border-bottom:2px solid #e5e7eb">设施类型</th>
      <th style="padding:10px 8px;text-align:left;border-bottom:2px solid #e5e7eb">编号</th>
      <th style="padding:10px 8px;text-align:left;border-bottom:2px solid #e5e7eb">状态</th>
      <th style="padding:10px 8px;text-align:left;border-bottom:2px solid #e5e7eb">安装日期</th>
      <th style="padding:10px 8px;text-align:left;border-bottom:2px solid #e5e7eb">寿命预警</th>
      <th style="padding:10px 8px;text-align:left;border-bottom:2px solid #e5e7eb">下次维保</th>
    </tr></thead><tbody>`;
  dev.forEach((d, i) => {
    const f = fs.find(x => x.id === d.floorId), b = bs.find(x => x.id === f?.buildingId);
    const sc = statusColor[d.status] || "#333";
    const bg = i % 2 === 0 ? "#fff" : "#fafafa";
    html += `<tr style="background:${bg}">
      <td style="padding:8px;border-bottom:1px solid #f0f0f0">${b?.name || "-"}</td>
      <td style="padding:8px;border-bottom:1px solid #f0f0f0;font-weight:500;color:#0369a1;background:#f0f9ff">${f?.floorName || "-"}</td>
      <td style="padding:8px;border-bottom:1px solid #f0f0f0">${d.deviceType}</td>
      <td style="padding:8px;border-bottom:1px solid #f0f0f0">${d.deviceCode || "-"}</td>
      <td style="padding:8px;border-bottom:1px solid #f0f0f0;color:${sc};font-weight:600">${d.status || "正常"}</td>
      <td style="padding:8px;border-bottom:1px solid #f0f0f0">${d.installDate || "-"}</td>
      <td style="padding:8px;border-bottom:1px solid #f0f0f0">${lifeTagHTML(d) || "-"}</td>
      <td style="padding:8px;border-bottom:1px solid #f0f0f0">${d.nextMaintain || "-"}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`; wrap.innerHTML = html;
}

/* ---------- 数据管理 ---------- */
function showDataManage() { openModal("modal-data"); refreshDataStats(); }
async function refreshDataStats() {
  const b = await dbGetAll(SB), f = await dbGetAll(SF), d = await dbGetAll(SD), l = await dbGetAll(SL), g = await getAllLegend(), imgs = await dbGetAll(SIMG), vec = await dbGetAll(SVEC);
  $("data-stats").innerHTML = `建筑：${b.length} 栋｜楼层：${f.length} 层｜设施：${d.length} 个｜维保记录：${l.length} 条｜图例：${g.length} 种｜图片：${imgs.length} 张｜矢量图形：${vec.length} 个`;
}

/* ---------- JSON备份（含图片+矢量图形） ---------- */
async function exportJSONBackup() {
  const b = await dbGetAll(SB), f = await dbGetAll(SF), d = await dbGetAll(SD), l = await dbGetAll(SL), g = await getAllLegend(), imgs = await dbGetAll(SIMG), vec = await dbGetAll(SVEC);
  const data = { version: 32, exportTime: new Date().toISOString(), building: b, floor: f, device: d, maintainLog: l, legend: g, images: imgs, vectorShapes: vec };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const n = new Date(), ts = n.getFullYear() + String(n.getMonth() + 1).padStart(2, '0') + String(n.getDate()).padStart(2, '0') + "_" + String(n.getHours()).padStart(2, '0') + String(n.getMinutes()).padStart(2, '0');
  a.download = `消防系统备份_${ts}.json`; a.click();
  showToast("JSON备份已导出（含图片+矢量图形）");
}
const importJSONBackup = () => $("json-import-input").click();
$("json-import-input").onchange = async function (e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!await confirmDialog("⚠️导入备份将合并到当前数据（相同ID会覆盖），确定继续？")) { this.value = ""; return; }
  showToast("正在导入，请稍候...");
  const txt = await new Promise(r => { const rd = new FileReader(); rd.onload = x => r(x.target.result); rd.readAsText(file); });
  try {
    const data = JSON.parse(txt);
    let migrated = 0;
    // 图片直接批量写入
    await dbBulkPut(SIMG, data.images || []);
    // 楼层：先处理图片迁移，再批量写入
    const floors = data.floor || [];
    for (let f of floors) {
      if (f.imageDataUrl && !f.imageId) {
        f.imageId = await saveImage(f.imageDataUrl);
        delete f.imageDataUrl;
        migrated++;
      }
    }
    await dbBulkPut(SF, floors);
    // 设备：先处理图片迁移，再批量写入
    const devices = data.device || [];
    for (let d of devices) {
      if (d.photo && !d.photoId) {
        d.photoId = await saveImage(d.photo);
        delete d.photo;
        migrated++;
      }
    }
    await dbBulkPut(SD, devices);
    // 其余直接批量写入
    await dbBulkPut(SB, data.building || []);
    await dbBulkPut(SL, data.maintainLog || []);
    await dbBulkPut(SLEG, data.legend || []);
    await dbBulkPut(SVEC, data.vectorShapes || []);
    await initDevTypeSelect(); renderAllLegend(); await showAllLegend(); renderTree(); calcStat(); refreshDataStats();
    if (typeof loadVectorShapes === 'function') loadVectorShapes();
    const bCount = (data.building || []).length;
    const fCount = (data.floor || []).length;
    const dCount = (data.device || []).length;
    const vCount = (data.vectorShapes || []).length;
    showToast(`导入成功：${bCount}栋建筑、${fCount}层、${dCount}个设备、${vCount}个矢量图形${migrated ? `（迁移${migrated}张图片）` : ""}`);
    if (bCount > 0) {
      const firstB = (data.building || [])[0];
      curB = firstB.id; curF = null;
      $("page-location").innerText = "请选择楼层";
      renderTree();
    }
  } catch (err) { alert("备份文件格式错误：" + err.message); }
  this.value = "";
};
async function clearAllData() {
  if (!await confirmDialog("⚠️⚠️⚠️此操作将清空全部数据，且不可恢复！确定要清空吗？")) return;
  if (!await confirmDialog("再次确认：真的要删除全部数据吗？建议先导出备份！")) return;
  [SB, SF, SD, SL, SLEG, SIMG, SVEC].forEach(async s => { for (let i of await dbGetAll(s)) await dbDel(s, i.id); });
  curB = null; curF = null; $("page-location").innerText = "请选择建筑楼层";
  if (map) { map.remove(); map = null; }
  await new Promise(r => setTimeout(r, 300));
  await initDevTypeSelect(); renderAllLegend(); await showAllLegend(); renderTree(); calcStat(); refreshDataStats();
  if (typeof loadVectorShapes === 'function') loadVectorShapes();
  showToast("全部数据已清空");
}

/* ---------- 本地库版本检测与更新 ---------- */
const libInfo = {
  leaflet: { name: "Leaflet", current: "1.9.4", url: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", cssUrl: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" },
  xlsx: { name: "XLSX", current: "0.18.5", url: "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" },
  dxf: { name: "DXF解析器", current: "1.1.2", url: "https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/dist/dxf-parser.min.js" }
};

function checkLibUpdates() {
  const box = $("lib-versions");
  let html = "";
  const leafletVer = typeof L !== 'undefined' ? (L.version || "已加载") : "未加载";
  const xlsxVer = typeof XLSX !== 'undefined' ? (XLSX.version || "已加载") : "未加载";
  const dxfVer = typeof DxfParser !== 'undefined' ? "已加载" : "未加载";
  html += `<div>🗺️ Leaflet：当前 <b>${leafletVer}</b>（本地 ${libInfo.leaflet.current}）</div>`;
  html += `<div>📊 XLSX：当前 <b>${xlsxVer}</b>（本地 ${libInfo.xlsx.current}）</div>`;
  html += `<div>📐 DXF解析器：<b>${dxfVer}</b>（本地 ${libInfo.dxf.current}）</div>`;
  html += `<div style="color:#888;margin-top:4px">💡 这些库版本稳定，无需频繁更新</div>`;
  box.innerHTML = html;
}

function downloadLib(type) {
  const info = libInfo[type];
  if (!info) return;
  const a = document.createElement("a");
  a.href = info.url;
  a.download = info.url.split("/").pop();
  a.click();
  if (info.cssUrl) {
    setTimeout(() => {
      const b = document.createElement("a");
      b.href = info.cssUrl;
      b.download = info.cssUrl.split("/").pop();
      b.click();
    }, 500);
  }
  showToast(`正在下载 ${info.name}，下载后放入 lib/ 目录覆盖`);
}
// 注意：exportInspectRecordsExcel 函数已移至 maintain.js（功能更完善，含建筑/楼层/设备类型等列）