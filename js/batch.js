/* ============================================================
 * batch.js - 批量操作（增建/增层/删除/Excel导入/复制模板）
 * 依赖：db.js, ui.js
 * ============================================================ */

function showBatchPanel() {
  openModal("modal-batch");
  switchBatchTab('add-b', document.querySelector('.batch-tab'));
  dbGetAll(SB).then(bs => {
    const opts = sortBuildings(bs).map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    $("batch-f-building").innerHTML = opts;
    $("copy-src-building").innerHTML = opts;
  });
  renderBatchDelList();
  document.querySelectorAll('.batch-result').forEach(r => { r.classList.remove('show', 'err'); r.innerHTML = ''; });
}
function switchBatchTab(tab, btn) {
  document.querySelectorAll('.batch-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.batch-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  $("batch-" + tab).classList.add('active');
  if (tab === 'del') renderBatchDelList();
}

/* ---------- 批量增建 ---------- */
async function batchAddBuildings() {
  const text = $("batch-b-names").value.trim();
  if (!text) { showToast("请输入建筑名称"); return; }
  const names = text.split('\n').map(s => s.trim()).filter(Boolean);
  const all = sortBuildings(await dbGetAll(SB));
  const existing = all.map(b => b.name);
  let maxOrder = all.length ? Math.max(...all.map(b => b.sortOrder !== undefined ? b.sortOrder : 0)) : -1;
  let ok = 0, skip = 0;
  for (const name of names) {
    if (existing.includes(name)) { skip++; continue; }
    maxOrder++;
    await dbPut(SB, { id: genId(), name, address: "", remark: "", sortOrder: maxOrder });
    ok++;
  }
  const r = $("batch-b-result"); r.classList.add('show'); r.classList.remove('err');
  r.innerHTML = `✅ 成功创建 ${ok} 栋建筑${skip ? `，跳过 ${skip} 个重名` : ""}`;
  $("batch-b-names").value = ""; renderTree();
}

/* ---------- 批量增层 ---------- */
async function batchAddFloors() {
  const bid = $("batch-f-building").value;
  if (!bid) { showToast("请选择建筑"); return; }
  const text = $("batch-f-names").value.trim();
  if (!text) { showToast("请输入楼层名称"); return; }
  const names = text.split('\n').map(s => s.trim()).filter(Boolean);
  const allF = await dbGetAll(SF);
  const existing = allF.filter(f => f.buildingId === bid).map(f => f.floorName);
  const curFloors = sortFloors(allF.filter(f => f.buildingId === bid));
  let maxOrder = curFloors.length ? Math.max(...curFloors.map(f => f.sortOrder !== undefined ? f.sortOrder : 0)) : -1;
  let ok = 0, skip = 0;
  for (const name of names) {
    if (existing.includes(name)) { skip++; continue; }
    maxOrder++;
    await dbPut(SF, { id: genId(), buildingId: bid, floorName: name, imageId: null, scale: "", sortOrder: maxOrder });
    ok++;
  }
  const r = $("batch-f-result"); r.classList.add('show'); r.classList.remove('err');
  r.innerHTML = `✅ 成功创建 ${ok} 个楼层${skip ? `，跳过 ${skip} 个重名` : ""}<br><span style="color:#d97706">⚠️ 新建楼层暂无平面图，请在左侧树中点击「编辑」上传</span>`;
  $("batch-f-names").value = ""; renderTree();
}

/* ---------- 批量删除 ---------- */
async function renderBatchDelList() {
  const bs = sortBuildings(await dbGetAll(SB)), fs = await dbGetAll(SF);
  let html = "";
  bs.forEach(b => {
    const fc = fs.filter(f => f.buildingId === b.id).length;
    html += `<label class="batch-check-item"><input type="checkbox" class="batch-del-check" value="${b.id}"/> ${b.name} <span style="color:#999;font-size:12px">（${fc}层）</span></label>`;
  });
  if (!bs.length) html = '<div style="padding:10px;color:#999;text-align:center">暂无建筑</div>';
  $("batch-del-list").innerHTML = html;
}
function toggleBatchDelAll(cb) { document.querySelectorAll('.batch-del-check').forEach(c => c.checked = cb.checked); }
async function batchDeleteBuildings() {
  const ids = Array.from(document.querySelectorAll('.batch-del-check:checked')).map(c => c.value);
  if (!ids.length) { showToast("请先勾选要删除的建筑"); return; }
  if (!await confirmDialog("⚠️确认删除选中的 " + ids.length + " 栋建筑？可撤销恢复！")) return;
  const bs = await dbGetAll(SB), fs = await dbGetAll(SF), alld = await dbGetAll(SD);
  const delB = bs.filter(b => ids.includes(b.id));
  const delF = fs.filter(f => ids.includes(f.buildingId));
  const delFids = delF.map(f => f.id);
  const delD = alld.filter(d => delFids.includes(d.floorId));
  const delDids = delD.map(d => d.id);
  const allInspectLogs = await dbGetAll(S_LOG);
  const allMaintainLogs = await dbGetAll(SL);
  const allWorkOrders = await dbGetAll(S_WORKORDER);
  const allFormData = await dbGetAll(S_FORM_DATA);
  const delInspectLogs = allInspectLogs.filter(l => delDids.includes(l.deviceId || l.device_id));
  const delMaintainLogs = allMaintainLogs.filter(l => delDids.includes(l.deviceId || l.device_id));
  const delWorkOrders = allWorkOrders.filter(w => delDids.includes(w.deviceId || w.device_id));
  const delFormData = allFormData.filter(f => delDids.includes(f.relatedId));
  const totalRelated = delInspectLogs.length + delMaintainLogs.length + delWorkOrders.length + delFormData.length;
  const allImg = [];
  const allImages = await dbGetAll(SIMG);
  for (let f of delF) if (f.imageId) { const img = allImages.find(i => i.id === f.imageId); if (img) allImg.push(img); }
  for (let d of delD) if (d.photoId) { const img = allImages.find(i => i.id === d.photoId); if (img) allImg.push(img); }
  pushUndo('cascade', { buildings: delB, floors: delF, devices: delD, inspectLogs: delInspectLogs, maintainLogs: delMaintainLogs, workOrders: delWorkOrders, formDataList: delFormData, images: allImg }, "批量删除" + delB.length + "栋建筑");
  for (let l of delInspectLogs) await dbDel(S_LOG, l.id);
  for (let l of delMaintainLogs) await dbDel(SL, l.id);
  for (let w of delWorkOrders) await dbDel(S_WORKORDER, w.id);
  for (let f of delFormData) await dbDel(S_FORM_DATA, f.id);
  for (let d of delD) { await dbDel(SD, d.id); if (typeof Cloud !== 'undefined' && Cloud.enabled) Cloud.deleteDevice(d.id); if (d.photoId) await deleteImage(d.photoId); }
  for (let f of delF) { await dbDel(SF, f.id); if (f.imageId) await deleteImage(f.imageId); }
  for (let b of delB) await dbDel(SB, b.id);
  if (ids.includes(curB)) { curB = null; curF = null; $("page-location").innerText = "请选择建筑楼层"; if (map) { map.remove(); map = null; } }
  const r = $("batch-del-result"); r.classList.add('show'); r.classList.remove('err');
  r.innerHTML = "✅ 已删除 " + delB.length + " 栋建筑、" + delF.length + " 个楼层、" + delD.length + " 个设备（含 " + totalRelated + " 条关联记录）";
  renderTree(); calcStat(); showUndoBar("批量删除" + delB.length + "栋建筑");
}

/* ---------- Excel导入 ---------- */
function downloadImportTemplate() {
  const data = [{
    "建筑名称": "第一教学楼", "楼层": "1F", "楼层编号": 1, "建筑地址": "XX路1号",
    "设施类型": "室内消火栓", "设备编号": "XH-001", "位置描述": "走廊东侧",
    "坐标X": "", "坐标Y": "",
    "安装日期": "2023-05-01", "预计使用年限": 10, "下次维保": "2026-05-01",
    "状态": "正常", "生产厂家": "XX消防设备厂", "设备型号": "SN65", "规格参数": "DN65",
    "责任人": "张三", "联系电话": "13800138000", "备注": ""
  }];
  const wb = XLSX.utils.book_new(), ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{wch:14},{wch:8},{wch:8},{wch:16},{wch:12},{wch:12},{wch:16},{wch:8},{wch:8},{wch:12},{wch:10},{wch:12},{wch:8},{wch:16},{wch:12},{wch:12},{wch:8},{wch:12},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws, "设备导入模板");
  XLSX.writeFile(wb, "消防设备导入模板.xlsx");
  showToast("模板已下载");
}
async function importDevicesExcel() {
  const file = $("batch-import-file").files[0];
  if (!file) { showToast("请先选择Excel文件"); return; }
  const r = $("batch-import-result");
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    if (!rows.length) { r.classList.add('show', 'err'); r.innerHTML = "❌ 文件为空"; return; }
    let bs = await dbGetAll(SB), fs = await dbGetAll(SF), legs = await getAllLegend();
    const legNames = legs.map(l => l.name);
    let ok = 0, skip = 0, pending = 0, newB = 0, newF = 0, errs = [];
    const bCache = {}, fCache = {};
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const bName = String(row["建筑名称"] || "").trim();
      const fName = String(row["楼层"] || "").trim();
      const dType = String(row["设施类型"] || "").trim();
      if (!bName || !fName || !dType) { skip++; errs.push("第" + (i + 2) + "行：缺少建筑/楼层/类型"); continue; }
      let b = bCache[bName] || bs.find(x => x.name === bName);
      if (!b) {
        b = { id: genId(), name: bName, address: String(row["建筑地址"] || "").trim(), order: bs.length + 1 };
        await dbPut(SB, b); bs.push(b); bCache[bName] = b; newB++;
      }
      const fKey = b.id + "|" + fName;
      let f = fCache[fKey] || fs.find(x => x.buildingId === b.id && x.floorName === fName);
      if (!f) {
        const fNum = parseInt(row["楼层编号"]) || 0;
        f = { id: genId(), buildingId: b.id, floorName: fName, floorNumber: fNum, imageId: null, order: fs.filter(x => x.buildingId === b.id).length + 1 };
        await dbPut(SF, f); fs.push(f); fCache[fKey] = f; newF++;
      }
      let type = dType;
      if (!legNames.includes(dType)) {
        const newLeg = { id: genId(), name: dType, color: "#3388dd", size: 32, borderOpacity: 1 };
        await dbPut(SLEG, newLeg); legs.push(newLeg); legNames.push(dType);
      }
      // 按关键词模糊匹配列名
      const findVal = (row, keywords) => {
        for (const key of Object.keys(row)) {
          const k = key.replace(/\s/g, "").toLowerCase();
          if (keywords.some(kw => k.includes(kw.toLowerCase()))) return row[key];
        }
        return undefined;
      };
      const px = findVal(row, ["坐标x", "x坐标", "posx", "经度", "lng", "x"]);
      const py = findVal(row, ["坐标y", "y坐标", "posy", "纬度", "lat", "y"]);
      const isEmpty = v => v === "" || v == null || (typeof v === "string" && v.trim() === "");
      const hasPos = !isEmpty(px) && !isEmpty(py) && !isNaN(parseFloat(px)) && !isNaN(parseFloat(py)) && isFinite(parseFloat(px)) && isFinite(parseFloat(py));
      const status = ["正常", "故障", "待维保", "已报废"].includes(row["状态"]) ? row["状态"] : "正常";
      await dbPut(SD, {
        id: genId(), floorId: f.id, deviceType: type,
        deviceCode: String(row["设备编号"] || "").trim(),
        posX: hasPos ? parseFloat(px) : null, posY: hasPos ? parseFloat(py) : null,
        pending: !hasPos,
        positionDesc: String(row["位置描述"] || "").trim(),
        installDate: String(row["安装日期"] || "").trim(),
        lifeYears: parseInt(row["预计使用年限"]) || 0,
        nextMaintain: String(row["下次维保"] || "").trim(),
        status, manufacturer: String(row["生产厂家"] || "").trim(),
        model: String(row["设备型号"] || "").trim(),
        spec: String(row["规格参数"] || "").trim(),
        responsible: String(row["责任人"] || "").trim(),
        phone: String(row["联系电话"] || "").trim(),
        photoId: null, remark: String(row["备注"] || "").trim()
      });
      ok++; if (!hasPos) pending++;
    }
    r.classList.add('show'); r.classList.remove('err');
    let html = "✅ 成功导入 " + ok + " 条设备";
    if (newB) html += "，新建建筑 " + newB + " 栋";
    if (newF) html += "，新建楼层 " + newF + " 个";
    if (pending) html += '<br><span style="color:#d97706">📍 其中 ' + pending + ' 条待定位（坐标留空），请在楼层中点击放置</span>';
    if (skip) html += "，跳过 " + skip + " 条";
    if (errs.length) html += '<br><details style="margin-top:6px"><summary style="cursor:pointer;color:#d97706">查看跳过详情</summary><div style="font-size:12px;color:#666;margin-top:4px;max-height:120px;overflow:auto">' + errs.join('<br>') + '</div></details>';
    r.innerHTML = html;
    $("batch-import-file").value = "";
    renderTree(); calcStat(); renderDeviceMarkers();
  } catch (e) { r.classList.add('show', 'err'); r.innerHTML = "❌ 导入失败：" + e.message; }
}
function quickCopyBuilding(bid) {
  showBatchPanel();
  document.querySelectorAll('.batch-tab')[4].click();
  $("copy-src-building").value = bid;
  dbGetAll(SB).then(bs => {
    const b = bs.find(x => x.id === bid);
    if (b) {
      let base = b.name, n = 2, candidate = b.name + "副本";
      while (bs.some(x => x.name === candidate)) { candidate = base + "副本" + n; n++; }
      $("copy-new-name").value = candidate;
    }
  });
}
async function duplicateBuilding() {
  const srcId = $("copy-src-building").value;
  if (!srcId) { showToast("请选择源建筑"); return; }
  let newName = $("copy-new-name").value.trim();
  const withDev = $("copy-with-devices").checked;
  const withLog = $("copy-with-logs").checked;
  const bs = await dbGetAll(SB), src = bs.find(b => b.id === srcId);
  if (!src) { showToast("源建筑不存在"); return; }
  if (!newName) {
    let base = src.name, n = 2, candidate = src.name + "副本";
    const allB = await dbGetAll(SB);
    while (allB.some(x => x.name === candidate)) { candidate = base + "副本" + n; n++; }
    newName = candidate;
  }
  if (bs.some(b => b.name === newName)) {
    let base = newName.replace(/副本\d*$/, '').trim(), n = 2, candidate = base + "副本";
    const allB = await dbGetAll(SB);
    while (allB.some(x => x.name === candidate)) { candidate = base + "副本" + n; n++; }
    newName = candidate;
  }
  const allB = sortBuildings(await dbGetAll(SB));
  const maxBOrder = allB.length ? Math.max(...allB.map(b => b.sortOrder !== undefined ? b.sortOrder : 0)) : -1;
  const newB = { id: genId(), name: newName, address: src.address || "", remark: (src.remark || "") + "（复制自" + src.name + "）", sortOrder: maxBOrder + 1 };
  await dbPut(SB, newB);
  const srcFloors = sortFloors((await dbGetAll(SF)).filter(f => f.buildingId === srcId));
  let devCount = 0, logCount = 0;
  for (const sf of srcFloors) {
    // 复制楼层图片（新建 imageId，避免原建筑删除时影响副本）
    let newImageId = null;
    if (sf.imageId) {
      const imgData = await getImage(sf.imageId);
      if (imgData) newImageId = await saveImage(imgData);
    }
    const nf = { id: genId(), buildingId: newB.id, floorName: sf.floorName, imageId: newImageId, scale: sf.scale || "", sortOrder: sf.sortOrder };
    await dbPut(SF, nf);
    if (withDev) {
      const devs = await getDevicesByFloor(sf.id);
      const newDevices = [];
      const newLogs = [];
      for (const sd of devs) {
        // 复制设备照片
        let newPhotoId = null;
        if (sd.photoId) { const photoData = await getImage(sd.photoId); if (photoData) newPhotoId = await saveImage(photoData); }
        const nd = { ...sd, id: genId(), floorId: nf.id, photoId: newPhotoId };
        newDevices.push(nd); devCount++;
        if (withLog) {
          const logs = (await dbGetAll(SL)).filter(l => l.deviceId === sd.id);
          for (const sl of logs) { newLogs.push({ ...sl, id: genId(), deviceId: nd.id }); logCount++; }
        }
      }
      // 批量写入设备和日志
      if (newDevices.length > 0) await dbBulkPut(SD, newDevices);
      if (newLogs.length > 0) await dbBulkPut(SL, newLogs);
    }
  }
  const r = $("batch-copy-result");
  r.classList.add('show'); r.classList.remove('err');
  const record = `<div style="margin-top:4px;padding:4px 0;border-bottom:1px dashed #ddd">✅ 已复制 <strong>${newName}</strong>（${srcFloors.length}层${withDev ? `、${devCount}设备` : ""}${withLog ? `、${logCount}维保` : ""}）</div>`;
  r.innerHTML = record + r.innerHTML;
  // 自动生成下一个副本名
  let base = src.name, n = 2, candidate = src.name + "副本";
  const curB = await dbGetAll(SB);
  while (curB.some(x => x.name === candidate)) { candidate = base + "副本" + n; n++; }
  $("copy-new-name").value = candidate;
  renderTree(); calcStat();
  showToast(`已复制：${newName}`);
}


/* ---------- 楼层快速复制 ---------- */
async function quickCopyFloor(fid) {
  const floors = await dbGetAll(SF);
  const src = floors.find(f => f.id === fid);
  if (!src) { showToast("楼层不存在"); return; }

  let base = src.floorName, n = 2, candidate = src.floorName + "副本";
  const sameBuildingFloors = floors.filter(f => f.buildingId === src.buildingId);
  while (sameBuildingFloors.some(f => f.floorName === candidate)) {
    candidate = base + "副本" + n; n++;
  }

  let newImageId = null;
  if (src.imageId) {
    const imgData = await getImage(src.imageId);
    if (imgData) newImageId = await saveImage(imgData);
  }

  const sameBuildingSorted = sortFloors(sameBuildingFloors);
  const maxOrder = sameBuildingSorted.length ? Math.max(...sameBuildingSorted.map(f => f.sortOrder !== undefined ? f.sortOrder : 0)) : -1;

  const newFloor = {
    id: genId(),
    buildingId: src.buildingId,
    floorName: candidate,
    imageId: newImageId,
    scale: src.scale || "",
    sortOrder: maxOrder + 1
  };
  await dbPut(SF, newFloor);

  const devs = await getDevicesByFloor(src.id);
  let devCount = 0;
  for (const sd of devs) {
    let newPhotoId = null;
    if (sd.photoId) {
      const photoData = await getImage(sd.photoId);
      if (photoData) newPhotoId = await saveImage(photoData);
    }
    const nd = { ...sd, id: genId(), floorId: newFloor.id, photoId: newPhotoId };
    await dbPut(SD, nd);
    devCount++;
  }

  renderTree(); calcStat();
  showToast(`已复制楼层「${candidate}」（${devCount}个设备）`);
}

function openBatchTab(tab) {
  showBatchPanel();
  setTimeout(() => {
    const tabs = document.querySelectorAll('.batch-tab');
    const tabMap = { 'add-b': 0, 'add-f': 1, 'del': 2, 'import': 3, 'copy': 4 };
    const idx = tabMap[tab] !== undefined ? tabMap[tab] : 0;
    if (tabs[idx]) switchBatchTab(tab, tabs[idx]);
  }, 50);
}
