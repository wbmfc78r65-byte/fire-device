/* ============================================================
 * stats.js - 统计报表与数据可视化模块
 * 功能：统计图表、打印平面图、一键生成报表
 * ============================================================ */

/* ---------- 设备统计 ---------- */
async function getDeviceStats() {
  const devs = await dbGetAll(SD);
  const buildings = await dbGetAll(SB);
  const floors = await dbGetAll(SF);
  const legs = await getAllLegend();

  // 按类型统计
  const byType = {};
  legs.forEach(l => byType[l.name] = 0);
  devs.forEach(d => {
    if (byType[d.deviceType] !== undefined) byType[d.deviceType]++;
    else byType[d.deviceType] = (byType[d.deviceType] || 0) + 1;
  });

  // 按状态统计
  const byStatus = { "正常": 0, "故障": 0, "待维保": 0, "已报废": 0 };
  devs.forEach(d => {
    const s = d.status || "正常";
    byStatus[s] = (byStatus[s] || 0) + 1;
  });

  // 按建筑统计
  const byBuilding = {};
  buildings.forEach(b => byBuilding[b.name] = 0);
  devs.forEach(d => {
    const floor = floors.find(f => f.id === d.floorId);
    const building = buildings.find(b => b.id === floor?.buildingId);
    if (building) byBuilding[building.name] = (byBuilding[building.name] || 0) + 1;
  });

  return { total: devs.length, byType, byStatus, byBuilding, buildings: buildings.length, floors: floors.length };
}

/* ---------- 渲染统计图表（纯CSS柱状图，不依赖第三方库） ---------- */
function renderStatsChart(containerId, data, options) {
  const container = document.getElementById(containerId);
  if (!container) return;
  options = options || {};
  const maxVal = Math.max(...Object.values(data), 1);
  const colors = options.colors || ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

  let html = '<div style="display:flex;flex-direction:column;gap:8px">';
  let idx = 0;
  for (const [key, val] of Object.entries(data)) {
    if (val === 0 && options.hideZero) continue;
    const pct = (val / maxVal * 100).toFixed(1);
    const color = colors[idx % colors.length];
    html += `
      <div style="display:flex;align-items:center;gap:8px">
        <span style="width:80px;font-size:12px;color:#666;text-align:right;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${key}">${key}</span>
        <div style="flex:1;background:#f3f4f6;border-radius:4px;height:20px;overflow:hidden">
          <div style="width:${pct}%;background:${color};height:100%;border-radius:4px;transition:width .5s;display:flex;align-items:center;justify-content:flex-end;padding-right:4px">
            <span style="color:#fff;font-size:11px;font-weight:bold">${val}</span>
          </div>
        </div>
      </div>`;
    idx++;
  }
  html += '</div>';
  container.innerHTML = html;
}

/* ---------- 渲染饼图（纯CSS conic-gradient） ---------- */
function renderPieChart(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (total === 0) { container.innerHTML = '<div style="text-align:center;color:#999;padding:20px">暂无数据</div>'; return; }

  const colors = { "正常": "#10b981", "故障": "#ef4444", "待维保": "#f59e0b", "已报废": "#9ca3af" };
  let gradient = "conic-gradient(";
  let start = 0;
  const entries = Object.entries(data).filter(([k, v]) => v > 0);
  entries.forEach(([key, val], i) => {
    const end = start + (val / total * 360);
    const color = colors[key] || "#3b82f6";
    gradient += `${color} ${start}deg ${end}deg`;
    if (i < entries.length - 1) gradient += ", ";
    start = end;
  });
  gradient += ")";

  let legendHtml = '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;justify-content:center">';
  entries.forEach(([key, val]) => {
    const color = colors[key] || "#3b82f6";
    const pct = (val / total * 100).toFixed(1);
    legendHtml += `<div style="display:flex;align-items:center;gap:4px;font-size:12px">
      <span style="width:12px;height:12px;background:${color};border-radius:2px;display:inline-block"></span>
      <span>${key}: ${val} (${pct}%)</span>
    </div>`;
  });
  legendHtml += '</div>';

  container.innerHTML = `
    <div style="display:flex;justify-content:center;margin:10px 0">
      <div style="width:150px;height:150px;border-radius:50%;background:${gradient};position:relative">
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;width:80px;height:80px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <span style="font-size:24px;font-weight:bold;color:#1f2937">${total}</span>
          <span style="font-size:11px;color:#666">总数</span>
        </div>
      </div>
    </div>
    ${legendHtml}
  `;
}

/* ---------- 打开统计面板 ---------- */
async function openStatsPanel() {
  try {
    const stats = await getDeviceStats();
    const box = $("stats-panel-content");
    if (!box) return;

  box.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div>
        <h5 style="margin:0 0 10px;font-size:14px">📊 设备类型分布</h5>
        <div id="stats-type-chart"></div>
      </div>
      <div>
        <h5 style="margin:0 0 10px;font-size:14px">🎯 设备状态分布</h5>
        <div id="stats-status-pie"></div>
      </div>
    </div>
    <div style="margin-top:20px">
      <h5 style="margin:0 0 10px;font-size:14px">🏢 各建筑设备数量</h5>
      <div id="stats-building-chart"></div>
    </div>
    <div style="margin-top:20px;padding:12px;background:#f8fafc;border-radius:8px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn small primary" onclick="printFloorPlan()">🖨️ 打印当前楼层平面图</button>
      <button class="btn small" onclick="generateReport()">📄 生成月度报告</button>
      <button class="btn small" onclick="exportExcel()">📥 导出Excel</button>
    </div>
  `;

  renderStatsChart("stats-type-chart", stats.byType, { hideZero: true });
  renderPieChart("stats-status-pie", stats.byStatus);
  renderStatsChart("stats-building-chart", stats.byBuilding, { hideZero: true });

  openModal("modal-stats");
  } catch(e) {
    console.error("统计面板错误:", e);
    showToast("加载失败: " + e.message);
  }
}

/* ---------- 打印当前楼层平面图 ---------- */
function printFloorPlan() {
  if (!curF) { showToast("请先选择楼层"); return; }
  // 创建打印窗口
  const printWindow = window.open('', '_blank');
  if (!printWindow) { showToast("请允许弹出窗口"); return; }

  const mapContainer = document.getElementById('map');
  const mapSvg = mapContainer.querySelector('svg');
  const mapCanvas = mapContainer.querySelector('canvas');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html><head><title>消防设施平面图 - ${$("page-location").innerText}</title>
    <style>
      body { margin:0; padding:20px; font-family: "Microsoft YaHei", sans-serif; }
      h2 { text-align:center; margin-bottom:10px; }
      .info { text-align:center; color:#666; margin-bottom:15px; font-size:12px; }
      .map-container { width:100%; text-align:center; }
      .map-container img { max-width:100%; max-height:80vh; border:1px solid #ddd; }
      .legend { margin-top:15px; display:flex; flex-wrap:wrap; gap:10px; justify-content:center; }
      .legend-item { display:flex; align-items:center; gap:4px; font-size:12px; }
      .legend-dot { width:14px; height:14px; border-radius:50%; }
      @media print { body { padding:0; } .no-print { display:none; } }
    </style></head><body>
    <h2>消防设施平面图</h2>
    <div class="info">位置：${$("page-location").innerText} ｜ 打印时间：${new Date().toLocaleString()}</div>
    <div class="map-container">
      <img src="${mapCanvas ? mapCanvas.toDataURL() : ''}" alt="平面图"/>
    </div>
    <div class="legend" id="print-legend"></div>
    <script>
      window.onload = function() { setTimeout(function() { window.print(); }, 500); }
    <\/script>
    </body></html>
  `);
  printWindow.document.close();

  // 填充图例
  setTimeout(async () => {
    const legs = await getAllLegend();
    const legendHtml = legs.map(l =>
      `<div class="legend-item"><span class="legend-dot" style="background:${l.color}"></span>${l.name}</div>`
    ).join("");
    const legendEl = printWindow.document.getElementById('print-legend');
    if (legendEl) legendEl.innerHTML = legendHtml;
  }, 300);
}

/* ---------- 生成月度报告（HTML格式，可打印） ---------- */
async function generateReport() {
  const stats = await getDeviceStats();
  const maintainStats = await getMaintainStats();

  const reportWindow = window.open('', '_blank');
  if (!reportWindow) { showToast("请允许弹出窗口"); return; }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  reportWindow.document.write(`
    <!DOCTYPE html>
    <html><head><title>${year}年${month}月消防设施月度报告</title>
    <style>
      body { font-family: "Microsoft YaHei", sans-serif; padding:30px; max-width:800px; margin:0 auto; }
      h1 { text-align:center; border-bottom:2px solid #d92121; padding-bottom:10px; }
      h2 { color:#d92121; border-left:4px solid #d92121; padding-left:10px; margin-top:25px; }
      table { width:100%; border-collapse:collapse; margin:10px 0; }
      th, td { border:1px solid #ddd; padding:8px 12px; text-align:left; font-size:13px; }
      th { background:#fef2f2; color:#d92121; }
      .summary { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin:15px 0; }
      .summary-item { background:#f8fafc; padding:15px; border-radius:8px; text-align:center; }
      .summary-num { font-size:24px; font-weight:bold; color:#d92121; }
      .summary-label { font-size:12px; color:#666; margin-top:4px; }
      .footer { margin-top:30px; text-align:right; color:#666; font-size:12px; }
      @media print { body { padding:20px; } }
    </style></head><body>
    <h1>${year}年${month}月消防设施月度报告</h1>
    <div style="text-align:center;color:#666;margin-bottom:20px">报告生成时间：${now.toLocaleString()}</div>

    <h2>一、设施概况</h2>
    <div class="summary">
      <div class="summary-item"><div class="summary-num">${stats.total}</div><div class="summary-label">设备总数</div></div>
      <div class="summary-item"><div class="summary-num">${stats.buildings}</div><div class="summary-label">建筑数量</div></div>
      <div class="summary-item"><div class="summary-num">${stats.floors}</div><div class="summary-label">楼层数量</div></div>
      <div class="summary-item"><div class="summary-num">${Object.keys(stats.byType).length}</div><div class="summary-label">设施类型</div></div>
    </div>

    <h2>二、设备状态统计</h2>
    <table>
      <tr><th>状态</th><th>数量</th><th>占比</th></tr>
      ${Object.entries(stats.byStatus).map(([k, v]) =>
        `<tr><td>${k}</td><td>${v}</td><td>${stats.total ? (v/stats.total*100).toFixed(1) : 0}%</td></tr>`
      ).join('')}
    </table>

    <h2>三、各类型设备统计</h2>
    <table>
      <tr><th>设施类型</th><th>数量</th><th>占比</th></tr>
      ${Object.entries(stats.byType).filter(([k,v]) => v > 0).sort((a,b) => b[1]-a[1]).map(([k, v]) =>
        `<tr><td>${k}</td><td>${v}</td><td>${stats.total ? (v/stats.total*100).toFixed(1) : 0}%</td></tr>`
      ).join('')}
    </table>

    <h2>四、维保情况</h2>
    <table>
      <tr><th>项目</th><th>数量</th></tr>
      <tr><td>维保逾期</td><td style="color:#dc2626;font-weight:bold">${maintainStats.overdueMaintain}</td></tr>
      <tr><td>即将到期（30天内）</td><td style="color:#d97706;font-weight:bold">${maintainStats.dueSoonMaintain}</td></tr>
      <tr><td>本月巡检记录</td><td>${maintainStats.todayInspectLogs}</td></tr>
      <tr><td>待办巡检任务</td><td>${maintainStats.pendingTasks}</td></tr>
    </table>

    <h2>五、各建筑设备分布</h2>
    <table>
      <tr><th>建筑名称</th><th>设备数量</th></tr>
      ${Object.entries(stats.byBuilding).filter(([k,v]) => v > 0).sort((a,b) => b[1]-a[1]).map(([k, v]) =>
        `<tr><td>${k}</td><td>${v}</td></tr>`
      ).join('')}
    </table>

    <div class="footer">
      <p>报告人：______________</p>
      <p>审核人：______________</p>
      <p>日期：${year}年${month}月${now.getDate()}日</p>
    </div>

    <script>window.onload = function() { setTimeout(function() { window.print(); }, 500); }<\/script>
    </body></html>
  `);
  reportWindow.document.close();
  showToast("月度报告已生成，可打印或保存为PDF");
}
