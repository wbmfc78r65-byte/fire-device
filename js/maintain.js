/* ============================================================
 * maintain.js - 维保巡检管理模块（巡检记录重做版）
 * ============================================================ */
/* ---------- 维保到期提醒 ---------- */
function getMaintainDueDevices(days) {
  days = days || 30;
  const today = new Date();
  const dueDate = new Date(today.getTime() + days * 24 * 3600 * 1000);
  const fmt = d => d.toISOString().split('T')[0];
  const todayStr = fmt(today), dueStr = fmt(dueDate);
  return new Promise(resolve => {
    dbGetAll(SD).then(devs => {
      const result = { overdue: [], dueSoon: [], normal: [] };
      devs.forEach(d => {
        if (!d.nextMaintain) { result.normal.push(d); return; }
        if (d.nextMaintain < todayStr) {
          result.overdue.push({ ...d, daysOverdue: Math.floor((today - new Date(d.nextMaintain)) / 86400000) });
        } else if (d.nextMaintain <= dueStr) {
          result.dueSoon.push({ ...d, daysLeft: Math.floor((new Date(d.nextMaintain) - today) / 86400000) });
        } else {
          result.normal.push(d);
        }
      });
      resolve(result);
    });
  });
}
function showMaintainReminder() {
  getMaintainDueDevices(30).then(r => {
    const count = r.overdue.length + r.dueSoon.length;
    if (count === 0) return;
    const badge = $("maintain-reminder-badge");
    if (badge) {
      badge.innerText = count;
      badge.style.display = count > 0 ? "inline-block" : "none";
    }
  });
}
/* ---------- 巡检任务管理 ---------- */
async function createInspectTask(data) {
  // 统一使用S_PLAN表，创建独立单日计划（type=daily, parentId=null）
  const floors = await dbGetAll(SF);
  const devices = await dbGetAll(SD);
  let targetDevices = devices;
  if (data.floorId) {
    targetDevices = targetDevices.filter(d => d.floorId === data.floorId);
  } else if (data.buildingId) {
    const floorIds = floors.filter(f => f.buildingId === data.buildingId).map(f => f.id);
    targetDevices = targetDevices.filter(d => floorIds.includes(d.floorId));
  }
  if (data.deviceType) {
    targetDevices = targetDevices.filter(d => d.deviceType === data.deviceType);
  }
  const task = {
    id: genId(),
    type: "daily",
    parentId: null, // 独立任务，不关联月计划
    name: data.name || "巡检任务",
    date: data.planDate || new Date().toISOString().split('T')[0],
    buildingId: data.buildingId || null,
    floorId: data.floorId || null,
    deviceType: data.deviceType || null,
    deviceIds: targetDevices.map(d => d.id),
    assignee: data.assignee || "",
    totalDevices: targetDevices.length,
    completedDevices: 0,
    status: "pending",
    createdAt: new Date().toISOString(),
    remark: data.remark || ""
  };
  await dbPut(S_PLAN, task);
  addOperationLog("create_task", `创建巡检任务：${task.name}，共${task.totalDevices}台设备`);
  showToast("巡检任务已创建");
  return task;
}
async function getInspectTasks(filter) {
  // 统一从S_PLAN表查询独立日计划（type=daily, parentId=null）
  let tasks = (await dbGetAll(S_PLAN)).filter(p => p.type === "daily" && !p.parentId);
  if (filter) {
    if (filter.status) tasks = tasks.filter(t => t.status === filter.status);
    if (filter.assignee) tasks = tasks.filter(t => t.assignee === filter.assignee);
  }
  return tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
async function updateTaskStatus(taskId, status) {
  const task = (await dbGetAll(S_PLAN)).find(t => t.id === taskId);
  if (!task) return;
  task.status = status;
  if (status === "completed") task.completedAt = new Date().toISOString();
  await dbPut(S_PLAN, task);
  addOperationLog("update_task", `任务「${task.name}」状态更新为：${status}`);
  renderInspectTaskList();
}
async function deleteInspectTask(taskId) {
  if (!await confirmDialog("确认删除该巡检任务？")) return;
  await dbDel(S_PLAN, taskId);
  addOperationLog("delete_task", "删除巡检任务");
  renderInspectTaskList();
  showToast("任务已删除");
  // 刷新工作台数据
  const wb = document.getElementById('maintain-workbench');
  if (wb && wb.style.display !== 'none' && typeof loadWorkbenchData === 'function') loadWorkbenchData();
}
/* ---------- 巡检打卡（重做：固化位置快照） ---------- */
async function startInspection(taskId) {
  const task = (await dbGetAll(S_PLAN)).find(t => t.id === taskId);
  if (!task) { showToast("任务不存在"); return; }
  await updateTaskStatus(taskId, "in-progress");
  currentInspectTask = task;
  showToast(`开始巡检：${task.name}`);
  if (task.floorId) {
    const buildings = await dbGetAll(SB);
    const floors = await dbGetAll(SF);
    const floor = floors.find(f => f.id === task.floorId);
    const building = buildings.find(b => b.id === floor?.buildingId);
    if (building && floor) selectFloor(building.id, floor.id);
  }
  closeModal("modal-inspect-task");
}
async function inspectCheckIn(deviceId, result) {
  const dev = (await dbGetAll(SD)).find(d => d.id === deviceId);
  if (!dev) { showToast("设备不存在"); return; }

  // 打卡瞬间固化位置快照，设备以后删除也不影响历史记录
  const floors = await dbGetAll(SF);
  const buildings = await dbGetAll(SB);
  const floor = floors.find(f => f.id === dev.floorId);
  const building = buildings.find(b => b.id === floor?.buildingId);

  const log = {
    id: genId(),
    deviceId: deviceId,
    taskId: currentInspectTask?.id || null,
    inspectDate: new Date().toISOString().split('T')[0],
    inspectTime: new Date().toTimeString().split(' ')[0],
    result: result || "normal",
    inspector: currentUser?.username || "未知",
    remark: "",
    photo: null,
    snapshot_deviceType: dev.deviceType || "未知设备",
    snapshot_deviceCode: dev.deviceCode || "",
    snapshot_buildingName: building?.name || "",
    snapshot_floorName: floor?.floorName || ""
  };
  await dbPut(S_LOG, log);

  // 同步上传云端（失败不影响本地）
  if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
    try {
      await Cloud.supabase.from('inspect_logs').insert([{
        device_id: log.deviceId,
        task_id: log.taskId,
        inspect_date: log.inspectDate,
        inspect_time: log.inspectTime,
        inspector_name: log.inspector,
        status: log.result,
        remark: log.remark,
        snapshot_device_type: log.snapshot_deviceType,
        snapshot_device_code: log.snapshot_deviceCode,
        snapshot_building_name: log.snapshot_buildingName,
        snapshot_floor_name: log.snapshot_floorName
      }]);
    } catch (e) {
      console.warn("巡检记录上传云端失败，已保留本地记录", e);
    }
  }

  // 根据巡检结果更新设备状态
  if (result === "fault") {
    dev.status = "故障";
  } else if (result === "maintain-needed") {
    dev.status = "待维保";
    const next = new Date();
    next.setDate(next.getDate() + 180);
    dev.nextMaintain = next.toISOString().split('T')[0];
  } else if (result === "normal") {
    dev.status = "正常";
    const next = new Date();
    next.setDate(next.getDate() + 180);
    dev.nextMaintain = next.toISOString().split('T')[0];
  }
  await dbPut(SD, dev);
  addOperationLog("inspect", `巡检打卡：${dev.deviceType} ${dev.deviceCode || ""}`);
  
  // 巡检发现故障：提示生成维修工单（闭环）
  if (result === "fault") {
    setTimeout(async () => {
      const confirm = await confirmDialog(`巡检发现故障：${dev.deviceType} ${dev.deviceCode || ""}\n位置：${building?.name || ""} ${floor?.floorName || ""}\n\n是否立即生成维修工单？`);
      if (confirm) {
        const order = await createWorkOrderFromInspectLog(log, dev);
        showToast(`已生成维修工单：${order.title}`);
      }
    }, 500);
  }
  
  showToast("巡检打卡成功");
  renderDeviceMarkers();
  // 更新日计划进度
  if (typeof updateDailyPlanProgress === 'function') {
    updateDailyPlanProgress(deviceId, log.inspectDate);
  }
  return log;
}

/* ---------- 巡检打卡弹窗（支持自定义表单） ---------- */
let _checkinDeviceId = null;
let _checkinResult = "normal";
let _checkinForm = null; // 当前渲染的表单对象

// 打开巡检打卡弹窗
async function openInspectCheckinModal(deviceId) {
  _checkinDeviceId = deviceId;
  _checkinResult = "normal";
  _checkinForm = null;
  
  const dev = (await dbGetAll(SD)).find(d => d.id === deviceId);
  if (!dev) { showToast("设备不存在"); return; }
  
  const floors = await dbGetAll(SF);
  const buildings = await dbGetAll(SB);
  const floor = floors.find(f => f.id === dev.floorId);
  const building = buildings.find(b => b.id === floor?.buildingId);
  
  // 显示设备信息
  document.getElementById("checkin-device-info").innerHTML = 
    `<b>${dev.deviceType || '未知设备'}</b> ${dev.deviceCode ? '(' + dev.deviceCode + ')' : ''}` +
    `<br>位置：${building?.name || ''} ${floor?.floorName || ''} ${dev.positionDesc || ''}`;
  
  // 重置结果选择
  selectCheckinResult("normal");
  
  // 重置备注
  document.getElementById("checkin-remark").value = "";
  
  // 隐藏表单区域
  document.getElementById("checkin-form-area").style.display = "none";
  document.getElementById("checkin-form-area").innerHTML = "";

  // 清除所有已有的预设提示（避免重复，用querySelectorAll删除全部）
  const selectorParent = document.getElementById("checkin-form-selector")?.parentNode;
  if (selectorParent) {
    selectorParent.querySelectorAll(".preset-hint").forEach(el => el.remove());
  }

  // 设备预设的表单ID
  const presetFormId = dev.inspectFormId || "";

  // 渲染表单选择器（初始值为设备预设的表单）
  await renderFormSelector("checkin-form-selector", presetFormId, async (formId) => {
    await onCheckinFormChange(formId);
  });

  // 如果设备预设了表单，自动加载
  if (presetFormId) {
    await onCheckinFormChange(presetFormId);
    // 在表单选择器上方添加提示（只添加一条）
    const selectorEl = document.getElementById("checkin-form-selector");
    if (selectorEl && selectorEl.parentNode) {
      const hint = document.createElement("div");
      hint.className = "preset-hint";
      hint.style.cssText = "font-size:11px;color:#8b5cf6;background:#f5f3ff;padding:4px 8px;border-radius:4px;margin-bottom:6px;border:1px solid #ddd6fe";
      hint.textContent = "📋 此设备已预设巡检表单，可直接填写或更换";
      selectorEl.parentNode.insertBefore(hint, selectorEl);
    }
  }

  openModal("modal-inspect-checkin");
}

// 选择巡检结果
function selectCheckinResult(result) {
  _checkinResult = result;
  const styles = {
    normal: { el: "checkin-result-normal", active: "#10b981", bg: "#ecfdf5" },
    fault: { el: "checkin-result-fault", active: "#ef4444", bg: "#fef2f2" },
    "maintain-needed": { el: "checkin-result-maintain", active: "#f59e0b", bg: "#fffbeb" }
  };
  Object.entries(styles).forEach(([key, s]) => {
    const el = document.getElementById(s.el);
    if (key === result) {
      el.style.borderColor = s.active;
      el.style.background = s.bg;
    } else {
      el.style.borderColor = "#e5e7eb";
      el.style.background = "#fff";
    }
  });
}

// 表单选择变化时渲染表单
async function onCheckinFormChange(formId) {
  const area = document.getElementById("checkin-form-area");
  if (!formId) {
    area.style.display = "none";
    area.innerHTML = "";
    _checkinForm = null;
    return;
  }
  area.style.display = "block";
  area.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:20px">加载表单中...</div>';
  _checkinForm = await renderFormFillById(formId, "checkin-form-area", {}, false);
}

// 提交巡检打卡（含表单数据）
async function submitInspectCheckin() {
  if (!_checkinDeviceId) { showToast("设备信息缺失"); return; }
  
  const remark = document.getElementById("checkin-remark").value.trim();
  let formDataRecord = null;
  
  // 如果选择了表单，先收集并保存表单数据
  if (_checkinForm) {
    const data = collectFormData(_checkinForm);
    const valid = validateForm(_checkinForm, data);
    if (!valid.ok) {
      showToast("请填写必填项：" + valid.missing.join("、"));
      return;
    }
    // 先创建巡检记录（获取ID用于关联）
    const log = await inspectCheckIn(_checkinDeviceId, _checkinResult);
    if (log) {
      log.remark = remark;
      log.formId = _checkinForm.id;
      log.formName = _checkinForm.name;
      await dbPut(S_LOG, log);
      // 保存表单数据并关联
      formDataRecord = await saveFormData(_checkinForm.id, data, "inspectLog", log.id, currentUser?.username || "未知");
      if (formDataRecord) {
        log.formDataId = formDataRecord.id;
        await dbPut(S_LOG, log);
      }
    }
  } else {
    // 没有表单，直接打卡
    const log = await inspectCheckIn(_checkinDeviceId, _checkinResult);
    if (log && remark) {
      log.remark = remark;
      await dbPut(S_LOG, log);
    }
  }
  
  closeModal("modal-inspect-checkin");
  showToast("巡检打卡成功");
}

// 查看巡检记录关联的表单数据
async function viewInspectFormData(inspectLogId) {
  await viewRelatedFormData("inspectLog", inspectLogId, "巡检表单数据");
}

// 导出巡检记录关联的表单数据
async function exportInspectFormData(inspectLogId) {
  await exportRelatedFormData("inspectLog", inspectLogId, "巡检表单数据_" + inspectLogId + ".txt");
}

async function getDeviceInspectHistory(deviceId) {
  const logs = await dbGetAll(S_LOG);
  return logs.filter(l => l.deviceId === deviceId)
    .sort((a, b) => new Date(b.inspectDate) - new Date(a.inspectDate));
}
/* ---------- 导入扫码巡检记录（同步固化快照） ---------- */
async function importPendingInspectRecords() {
  try {
    const pending = JSON.parse(localStorage.getItem("firemap_inspect_pending") || "[]");
    if (!pending.length) return;
    let imported = 0;
    for (const record of pending) {
      if (record.synced) continue;
      const dev = (await dbGetAll(SD)).find(d => d.id === record.deviceId);
      if (!dev) continue;

      const floors = await dbGetAll(SF);
      const buildings = await dbGetAll(SB);
      const floor = floors.find(f => f.id === dev.floorId);
      const building = buildings.find(b => b.id === floor?.buildingId);

      const log = {
        id: genId(),
        deviceId: record.deviceId,
        taskId: null,
        inspectDate: record.date ? record.date.split(" ")[0] : new Date().toISOString().split('T')[0],
        inspectTime: record.date ? record.date.split(" ")[1] || "" : new Date().toTimeString().split(' ')[0],
        result: record.result === "正常" ? "normal" : record.result === "故障" ? "fault" : "maintain-needed",
        inspector: record.person || "未知",
        remark: record.remark || "",
        photo: record.photo || null,
        source: "qrcode",
        snapshot_deviceType: dev.deviceType || "未知设备",
        snapshot_deviceCode: dev.deviceCode || "",
        snapshot_buildingName: building?.name || "",
        snapshot_floorName: floor?.floorName || ""
      };
      await dbPut(S_LOG, log);

      if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
        try {
          await Cloud.supabase.from('inspect_logs').insert([{
            device_id: log.deviceId,
            task_id: null,
            inspect_date: log.inspectDate,
            inspect_time: log.inspectTime,
            inspector_name: log.inspector,
            status: log.result,
            remark: log.remark,
            snapshot_device_type: log.snapshot_deviceType,
            snapshot_device_code: log.snapshot_deviceCode,
            snapshot_building_name: log.snapshot_buildingName,
            snapshot_floor_name: log.snapshot_floorName
          }]);
        } catch (e) { console.warn("扫码记录上传云端失败", e); }
      }

      if (record.result === "故障") {
        dev.status = "故障";
        await dbPut(SD, dev);
      } else if (record.result === "需维保") {
        dev.status = "待维保";
        const next = new Date();
        next.setDate(next.getDate() + 180);
        dev.nextMaintain = next.toISOString().split('T')[0];
        await dbPut(SD, dev);
      }
      record.synced = true;
      imported++;
    }
    const remaining = pending.filter(r => !r.synced);
    localStorage.setItem("firemap_inspect_pending", JSON.stringify(remaining));
    if (imported > 0) {
      showToast(`已导入 ${imported} 条扫码巡检记录`);
      if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
    }
  } catch(e) {
    console.error("导入巡检记录失败:", e);
  }
}
/* ---------- 逾期预警 ---------- */
function getOverdueStats() {
  return getMaintainDueDevices(30).then(r => ({
    overdueCount: r.overdue.length,
    dueSoonCount: r.dueSoon.length,
    overdueDevices: r.overdue,
    dueSoonDevices: r.dueSoon
  }));
}
/* ---------- 生成楼层巡检二维码 ---------- */
async function generateFloorInspectQR() {
  const floorId = $("f-id").value;
  if (!floorId) { showToast("请先保存楼层信息"); return; }
  const floors = await dbGetAll(SF);
  const buildings = await dbGetAll(SB);
  const floor = floors.find(f => f.id === floorId);
  if (!floor) { showToast("楼层不存在"); return; }
  const building = buildings.find(b => b.id === floor.buildingId);
  if (typeof Cloud !== 'undefined' && Cloud.enabled) {
    const devs = await getDevicesByFloor(floorId);
    await Cloud.syncFloor({
      id: floorId,
      buildingId: floor.buildingId,
      buildingName: building?.name || "",
      floorName: floor.floorName,
      deviceCount: devs.length
    });
  }
  // 地址优先级：楼层自定义地址 > 全局默认地址
  const customUrl = (floor.qrUrl || "").trim();
  let baseUrl = customUrl;
  if (!baseUrl) {
    try { baseUrl = localStorage.getItem("firemap_qr_baseurl") || ""; } catch(e) {}
  }
  if (!baseUrl) {
    showToast("请先在二维码设置中配置基础地址");
    const preview = $("floor-qr-preview");
    const canvas = $("floor-qr-canvas");
    preview.style.display = "block";
    canvas.innerHTML = '<div style="color:#ef4444;padding:20px;text-align:center">请先配置二维码基础地址<br><span style="font-size:11px">在楼层二维码的地址栏填写，或点击「用全局」使用全局默认地址</span></div>';
    return;
  }
  // 统一推导楼层巡检页地址：device.html → floor-inspect.html；纯域名 → 拼接
  const pageUrl = buildFloorInspectUrl(baseUrl);
  const url = pageUrl + (pageUrl.indexOf("?") >= 0 ? "&" : "?") + "floorId=" + encodeURIComponent(floorId);
  const preview = $("floor-qr-preview");
  const canvas = $("floor-qr-canvas");
  preview.style.display = "block";
  canvas.innerHTML = "";
  if (typeof QRCode !== 'undefined') {
    try {
      new QRCode(canvas, { text: url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
    } catch(e) {
      canvas.innerHTML = '<div style="color:#ef4444;padding:20px;text-align:center">二维码生成失败<br><span style="font-size:11px">' + e.message + '</span></div>';
    }
  } else {
    canvas.innerHTML = '<div style="color:#999;padding:20px">二维码库未加载</div>';
  }
}
/* ---------- 单设备巡检历史 ---------- */
async function renderInspectLogList(devId) {
  const box = document.getElementById("inspect-log-list-box");
  if (!box) return;
  const logs = await getDeviceInspectHistory(devId);
  if (!logs.length) {
    box.innerHTML = '<div style="color:#999;text-align:center;padding:10px">暂无巡检记录</div>';
    return;
  }
  const resultMap = {
    normal: { text: "正常", color: "#10b981" },
    fault: { text: "故障", color: "#ef4444" },
    "maintain-needed": { text: "需维保", color: "#f59e0b" }
  };
  let html = "";
  logs.forEach(log => {
    const r = resultMap[log.result] || { text: log.result, color: "#666" };
    html += '<div style="padding:8px 0;border-bottom:1px solid #eee">';
    html += '<div style="display:flex;justify-content:space-between;margin-bottom:4px">';
    html += '<span style="font-weight:500">' + (log.inspector || "未知") + '</span>';
    html += '<span style="color:#999;font-size:11px">' + (log.inspectDate || "") + ' ' + (log.inspectTime || "") + '</span>';
    html += '</div>';
    html += '<div style="color:' + r.color + ';font-weight:500">' + r.text + '</div>';
    if (log.remark) html += '<div style="color:#666;margin-top:2px">' + log.remark + '</div>';
    if (log.source === "qrcode") html += '<div style="color:#999;font-size:11px;margin-top:2px">📱 扫码巡检</div>';
    html += '</div>';
  });
  box.innerHTML = html;
}
/* ---------- 维保统计 ---------- */
async function getMaintainStats() {
  const devs = await dbGetAll(SD);
  const logs = await dbGetAll(S_LOG);
  const workOrders = await dbGetAll(S_WORKORDER);
  const allPlans = await dbGetAll(S_PLAN);
  const tasks = allPlans.filter(p => p.type === "daily" && !p.parentId);
  // 直接用已加载的 devices 计算维保到期，避免重复查询数据库
  const dueToday = new Date();
  const dueDate = new Date(dueToday.getTime() + 30 * 24 * 3600 * 1000);
  const fmt = d => d.toISOString().split('T')[0];
  const todayStr = fmt(dueToday), dueStr = fmt(dueDate);
  const due = { overdue: [], dueSoon: [], normal: [] };
  devs.forEach(d => {
    if (!d.nextMaintain) { due.normal.push(d); return; }
    if (d.nextMaintain < todayStr) {
      due.overdue.push({ ...d, daysOverdue: Math.floor((dueToday - new Date(d.nextMaintain)) / 86400000) });
    } else if (d.nextMaintain <= dueStr) {
      due.dueSoon.push({ ...d, daysLeft: Math.floor((new Date(d.nextMaintain) - dueToday) / 86400000) });
    } else {
      due.normal.push(d);
    }
  });
  
  // 故障数：直接统计当前状态为"故障"的设备数量
  // （巡检发现故障自动设为"故障"，工单验收通过自动恢复为"正常"，syncDeviceStatusFromInspectRecords 也会同步）
  const unhandledFaultCount = devs.filter(d => d.status === "故障").length;
  
  return {
    totalDevices: devs.length,
    normalDevices: devs.filter(d => d.status === "正常").length,
    faultDevices: unhandledFaultCount,
    maintainDevices: devs.filter(d => d.status === "待维保").length,
    overdueMaintain: due.overdue.length,
    dueSoonMaintain: due.dueSoon.length,
    totalInspectLogs: logs.length,
    todayInspectLogs: logs.filter(l => l.inspectDate === new Date().toISOString().split('T')[0]).length,
    pendingTasks: tasks.filter(t => t.status === "pending").length,
    inProgressTasks: tasks.filter(t => t.status === "in-progress").length,
    completedTasks: tasks.filter(t => t.status === "completed").length
  };
}
/* ---------- 维保提醒面板 ---------- */
function renderMaintainReminderPanel() {
  getMaintainDueDevices(30).then(r => {
    const box = $("maintain-reminder-body");
    if (!box) return;
    let html = "";
    if (r.overdue.length > 0) {
      html += `<div style="color:#dc2626;font-weight:bold;margin:8px 0 4px">⚠️ 已逾期（${r.overdue.length}个）</div>`;
      r.overdue.forEach(d => {
        html += `<div class="reminder-item overdue" onclick="locateDeviceById('${d.id}')">
          <span class="reminder-dot" style="background:#dc2626"></span>
          <span class="reminder-info">${d.deviceType} ${d.deviceCode || ""}</span>
          <span class="reminder-date">逾期${d.daysOverdue}天</span>
        </div>`;
      });
    }
    if (r.dueSoon.length > 0) {
      html += `<div style="color:#d97706;font-weight:bold;margin:12px 0 4px">⏰ 即将到期（${r.dueSoon.length}个）</div>`;
      r.dueSoon.forEach(d => {
        html += `<div class="reminder-item due-soon" onclick="locateDeviceById('${d.id}')">
          <span class="reminder-dot" style="background:#d97706"></span>
          <span class="reminder-info">${d.deviceType} ${d.deviceCode || ""}</span>
          <span class="reminder-date">还剩${d.daysLeft}天</span>
        </div>`;
      });
    }
    if (!html) html = '<div style="padding:16px;color:#666;text-align:center">✅ 暂无到期维保设备</div>';
    box.innerHTML = html;
  });
}
/* ---------- 巡检任务列表 ---------- */
async function renderInspectTaskList() {
  const box = $("inspect-task-list");
  if (!box) return;
  const tasks = await getInspectTasks();
  const buildings = await dbGetAll(SB);
  const floors = await dbGetAll(SF);
  if (!tasks.length) {
    box.innerHTML = '<div style="padding:16px;color:#666;text-align:center">暂无巡检任务，点击上方按钮创建</div>';
    return;
  }
  let html = "";
  tasks.forEach(t => {
    const b = buildings.find(x => x.id === t.buildingId);
    const f = floors.find(x => x.id === t.floorId);
    const statusText = { pending: "待开始", "in-progress": "进行中", completed: "已完成" }[t.status] || t.status;
    const statusColor = { pending: "#6b7280", "in-progress": "#3b82f6", completed: "#10b981" }[t.status] || "#666";
    const total = t.totalDevices || 0;
    const done = t.completedDevices || 0;
    const percent = total > 0 ? Math.round(done / total * 100) : 0;
    html += `<div class="task-card">
      <div class="task-header">
        <span class="task-name">${t.name}</span>
        <span class="task-status" style="background:${statusColor}">${statusText}</span>
      </div>
      <div class="task-info">
        <span>📍 ${b?.name || "全部"} ${f?.floorName || ""}</span>
        <span>📅 ${t.date || t.planDate || ""}</span>
        ${t.assignee ? `<span>👤 ${t.assignee}</span>` : ""}
        <span>🔧 ${done}/${total}台</span>
      </div>
      <div style="margin:6px 0">
        <div style="background:#e5e7eb;border-radius:4px;height:6px;overflow:hidden">
          <div style="background:#3b82f6;height:100%;width:${percent}%;transition:width .3s"></div>
        </div>
        <div style="font-size:11px;color:#999;margin-top:2px">进度 ${percent}%</div>
      </div>
      <div class="task-actions">
        ${t.status === "pending" ? `<button class="btn small primary" onclick="startInspection('${t.id}')">开始巡检</button>` : ""}
        ${t.status === "in-progress" ? `<button class="btn small" onclick="updateTaskStatus('${t.id}','completed')">完成</button>` : ""}
        <button class="btn small del" onclick="deleteInspectTask('${t.id}')">删除</button>
      </div>
    </div>`;
  });
  box.innerHTML = html;
}
/* ---------- 定位设备 ---------- */

// 显示设备ID定位弹窗（仅超级管理员）
function showDeviceIdLocator() {
  // 权限校验
  if (typeof isSuperAdmin === 'function' && !isSuperAdmin()) {
    showToast("⚠️ 仅超级管理员可使用ID定位功能");
    return;
  }
  // 如果弹窗已存在，直接显示
  let modal = document.getElementById('modal-device-id-locator');
  if (modal) {
    modal.classList.remove('hidden');
    document.getElementById('device-id-input').value = '';
    document.getElementById('device-id-result').innerHTML = '';
    document.getElementById('device-id-input').focus();
    return;
  }
  // 动态创建弹窗
  modal = document.createElement('div');
  modal.id = 'modal-device-id-locator';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-box" style="width:420px">
      <h4>🎯 按设备ID定位</h4>
      <p style="color:#666;font-size:13px;margin:8px 0">输入设备ID（如：17881670217670.7g5zwde96da），系统将自动切换到对应楼层并在地图上高亮定位。</p>
      <input type="text" id="device-id-input" placeholder="请输入设备ID..." style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;box-sizing:border-box;margin:8px 0" onkeydown="if(event.key==='Enter')doDeviceIdLocate()"/>
      <div id="device-id-result" style="font-size:13px;margin:8px 0;min-height:20px"></div>
      <div class="modal-btn-row">
        <button class="btn primary" onclick="doDeviceIdLocate()">🔍 定位</button>
        <button class="btn ghost" onclick="document.getElementById('modal-device-id-locator').classList.add('hidden')">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => {
    document.getElementById('device-id-input').focus();
  }, 100);
}

// 执行设备ID定位（仅超级管理员）
async function doDeviceIdLocate() {
  // 权限校验
  if (typeof isSuperAdmin === 'function' && !isSuperAdmin()) {
    showToast("⚠️ 仅超级管理员可使用ID定位功能");
    return;
  }
  const deviceId = document.getElementById('device-id-input').value.trim();
  const resultEl = document.getElementById('device-id-result');
  if (!deviceId) {
    resultEl.innerHTML = '<span style="color:#ef4444">⚠️ 请输入设备ID</span>';
    return;
  }
  resultEl.innerHTML = '<span style="color:#666">🔍 正在查找...</span>';
  try {
    const dev = (await dbGetAll(SD)).find(d => d.id === deviceId);
    if (!dev) {
      resultEl.innerHTML = '<span style="color:#ef4444">❌ 未找到该设备，请检查ID是否正确</span>';
      return;
    }
    // 显示设备信息
    const floors = await dbGetAll(SF);
    const buildings = await dbGetAll(SB);
    const floor = floors.find(f => f.id === dev.floorId);
    const building = buildings.find(b => b.id === floor?.buildingId);
    resultEl.innerHTML = `<span style="color:#10b981">✅ 找到设备：${dev.deviceType || '未知'} ${dev.deviceCode || '(无编号)'}<br>📍 位置：${building?.name || ''} ${floor?.floorName || ''}</span>`;
    // 延迟定位，让用户看到结果
    setTimeout(async () => {
      await locateDeviceById(deviceId);
      document.getElementById('modal-device-id-locator').classList.add('hidden');
    }, 800);
  } catch(e) {
    resultEl.innerHTML = `<span style="color:#ef4444">❌ 查找失败：${e.message}</span>`;
  }
}

async function locateDeviceById(deviceId) {
  const dev = (await dbGetAll(SD)).find(d => d.id === deviceId);
  if (!dev) return;
  const floors = await dbGetAll(SF);
  const buildings = await dbGetAll(SB);
  const floor = floors.find(f => f.id === dev.floorId);
  const building = buildings.find(b => b.id === floor?.buildingId);
  if (building && floor) {
    await selectFloor(building.id, floor.id);
    setTimeout(() => {
      const m = markers.find(x => x._devId === deviceId);
      if (m) {
        map.setView(m.getLatLng(), map.getZoom());
        highlightDeviceMarker(deviceId, true);
        m.openPopup();
      }
    }, 500);
  }
}
/* ---------- 操作日志 ---------- */
let currentUser = null;
function addOperationLog(action, detail) {
  const log = {
    id: genId(),
    userId: currentUser?.id || "anonymous",
    username: currentUser?.username || "未知",
    action: action,
    detail: detail || "",
    time: new Date().toISOString()
  };
  dbPut(S_OPLOG, log).catch(() => {});
}
async function getOperationLogs(limit) {
  let logs = await dbGetAll(S_OPLOG);
  logs = logs.sort((a, b) => new Date(b.time) - new Date(a.time));
  return limit ? logs.slice(0, limit) : logs;
}
/* ---------- 全局变量 ---------- */
let currentInspectTask = null;
let allInspectRecords = [];
let _inspectSortKey = 'time'; // 当前排序列：time/inspector/building/floor/devType/devCode/status/remark/source
let _inspectSortDir = -1; // 排序方向：1=升序，-1=降序
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (typeof showMaintainReminder === 'function') showMaintainReminder();
    // 根据权限显示ID定位按钮（仅超级管理员）
    const locatorBtn = document.getElementById('device-id-locator-btn');
    if (locatorBtn && typeof isSuperAdmin === 'function' && isSuperAdmin()) {
      locatorBtn.style.display = '';
    }
  }, 1000);
});
/* ---------- UI辅助 ---------- */
function openMaintainReminder() { renderMaintainReminderPanel(); openModal("modal-maintain-reminder"); }
function openInspectTaskManager() { renderInspectTaskList(); openModal("modal-inspect-task"); }
async function openCreateTaskModal() {
  const buildings = await dbGetAll(SB);
  const bSelect = $("task-building");
  bSelect.innerHTML = '<option value="">全部建筑</option>' + buildings.map(b => `<option value="${b.id}">${b.name}</option>`).join("");
  const legs = await getAllLegend();
  const tSelect = $("task-device-type");
  tSelect.innerHTML = '<option value="">全部类型</option>' + legs.map(l => `<option value="${l.name}">${l.name}</option>`).join("");
  $("task-plan-date").value = new Date().toISOString().split('T')[0];
  $("task-name").value = "";
  $("task-assignee").value = "";
  $("task-remark").value = "";
  updateTaskFloorSelect();
  openModal("modal-create-task");
}
async function updateTaskFloorSelect() {
  const buildingId = $("task-building").value;
  const fSelect = $("task-floor");
  if (!buildingId) { fSelect.innerHTML = '<option value="">全部楼层</option>'; return; }
  const floors = await dbGetAll(SF);
  const buildingFloors = floors.filter(f => f.buildingId === buildingId);
  fSelect.innerHTML = '<option value="">全部楼层</option>' + buildingFloors.map(f => `<option value="${f.id}">${f.floorName}</option>`).join("");
}
async function submitCreateTask() {
  const name = $("task-name").value.trim();
  if (!name) { showToast("请输入任务名称"); return; }
  await createInspectTask({
    name: name,
    buildingId: $("task-building").value || null,
    floorId: $("task-floor").value || null,
    deviceType: $("task-device-type").value || null,
    planDate: $("task-plan-date").value,
    assignee: $("task-assignee").value.trim(),
    remark: $("task-remark").value.trim()
  });
  closeModal("modal-create-task");
  // 确保任务管理弹窗打开，并等待渲染完成
  openModal("modal-inspect-task");
  await renderInspectTaskList();
  showToast("巡检任务已创建");
  // 刷新工作台数据
  const wb = document.getElementById('maintain-workbench');
  if (wb && wb.style.display !== 'none' && typeof loadWorkbenchData === 'function') loadWorkbenchData();
}
async function updateMaintainCategoryCount() {
  const badge = $("cat-maintain-count");
  if (!badge) return;
  const r = await getMaintainDueDevices(30);
  const count = r.overdue.length + r.dueSoon.length;
  badge.innerText = count;
  badge.style.display = count > 0 ? "inline-block" : "none";
}

/* ============================================================
   巡检记录统一查看（重做版）
   必备字段：时间、巡检人、建筑、楼层、设备类型、设备编号、结果、备注、来源
   ============================================================ */

// 打开巡检记录弹窗
async function openInspectRecords() {
  openModal('modal-inspect-records');
  enableModalResize("modal-inspect-records");
  document.getElementById('inspect-records-list').innerHTML = '<div style="color:#999;text-align:center;padding:20px">加载中...</div>';
  await loadInspectRecords();
  renderInspectRecords();
}

// 加载巡检记录：合并本地 S_LOG + 云端 inspect_logs，优先用快照
async function loadInspectRecords() {
  let combineList = [];

  // 1. 本地记录
  try {
    const localLogs = await dbGetAll(S_LOG);
    for (const log of localLogs) {
      combineList.push({
        id: log.id,
        device_id: log.deviceId,
        inspect_date: log.inspectDate,
        inspect_time: log.inspectTime,
        inspector_name: log.inspector,
        status: log.result === "normal" ? "正常" : log.result === "fault" ? "故障" : "需维保",
        remark: log.remark || "",
        source: log.source === "qrcode" ? "扫码巡检" : "本地打卡",
        snap_building: log.snapshot_buildingName || "",
        snap_floor: log.snapshot_floorName || "",
        snap_devType: log.snapshot_deviceType || "",
        snap_devCode: log.snapshot_deviceCode || ""
      });
    }
  } catch (e) { console.warn("本地巡检记录读取失败", e); }

  // 2. 云端记录
  if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
    try {
      const { data, error } = await Cloud.supabase.from('inspect_logs').select('*');
      if (!error && Array.isArray(data)) {
        for (const r of data) {
          combineList.push({
            id: r.id || ('cloud_' + r.device_id + '_' + r.inspect_date + '_' + r.inspect_time),
            device_id: r.device_id,
            inspect_date: r.inspect_date,
            inspect_time: r.inspect_time,
            inspector_name: r.inspector_name,
            status: r.status === "normal" ? "正常" : r.status === "fault" ? "故障" : (r.status || "需维保"),
            remark: r.remark || "",
            source: "云端",
            snap_building: r.snapshot_building_name || "",
            snap_floor: r.snapshot_floor_name || "",
            snap_devType: r.snapshot_device_type || "",
            snap_devCode: r.snapshot_device_code || ""
          });
        }
      }
    } catch (err) { console.warn("云端巡检记录读取失败，仅加载本地记录", err); }
  }

  // 按时间倒序
  allInspectRecords = combineList.sort((a, b) => {
    const tA = `${a.inspect_date || ""} ${a.inspect_time || ""}`;
    const tB = `${b.inspect_date || ""} ${b.inspect_time || ""}`;
    return tB.localeCompare(tA);
  });

  // 同步设备状态
  await syncDeviceStatusFromInspectRecords();
}

// 根据巡检记录同步设备状态（独立函数，可在任何地方调用）
async function syncDeviceStatusFromInspectRecords() {
  try {
    // 状态归一化函数（支持中英文）
    const normStatus = (s) => {
      if (!s) return "需维保";
      const v = String(s).toLowerCase().trim();
      if (v === "normal" || v === "正常") return "正常";
      if (v === "fault" || v === "故障") return "故障";
      if (v === "maintain-needed" || v === "需维保" || v === "待维保") return "需维保";
      return s; // 其他值原样返回
    };
    // 加载所有巡检记录（本地+云端）
    const allRecords = [];
    // 本地记录
    let localCount = 0;
    try {
      const localLogs = await dbGetAll(S_LOG);
      for (const log of localLogs) {
        allRecords.push({
          id: log.id,
          device_id: log.deviceId,
          inspect_date: log.inspectDate,
          inspect_time: log.inspectTime,
          status: normStatus(log.result)
        });
        localCount++;
      }
    } catch(e) { console.warn("同步-本地记录读取失败", e); }
    // 云端记录
    let cloudCount = 0;
    if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
      try {
        const { data, error } = await Cloud.supabase.from('inspect_logs').select('id,device_id,inspect_date,inspect_time,status');
        if (error) console.warn("同步-云端记录读取失败:", error.message);
        if (Array.isArray(data)) {
          for (const r of data) {
            allRecords.push({
              id: r.id,
              device_id: r.device_id,
              inspect_date: r.inspect_date,
              inspect_time: r.inspect_time,
              status: normStatus(r.status)
            });
            cloudCount++;
          }
        }
      } catch(e) { console.warn("同步-云端记录异常", e); }
    } else {
      console.log("同步-云端未启用，仅同步本地记录");
    }
    console.log(`同步-共加载 ${allRecords.length} 条巡检记录（本地${localCount}条，云端${cloudCount}条）`);
    if (!allRecords.length) return;
    // 按时间倒序
    allRecords.sort((a, b) => {
      const tA = `${a.inspect_date || ""} ${a.inspect_time || ""}`;
      const tB = `${b.inspect_date || ""} ${b.inspect_time || ""}`;
      return tB.localeCompare(tA);
    });
    // 按设备取最新一条
    const latestByDevice = {};
    for (const r of allRecords) {
      if (!r.device_id) continue;
      if (!latestByDevice[r.device_id]) latestByDevice[r.device_id] = r;
    }
    console.log(`同步-涉及 ${Object.keys(latestByDevice).length} 台设备的最新记录`);
    // 加载工单和历史档案，用于判断故障是否已修复
    const workOrders = await dbGetAll(S_WORKORDER);
    const archiveList = typeof getArchive === 'function' ? getArchive() : [];
    // 更新设备状态
    const devices = await dbGetAll(SD);
    let updated = 0;
    const faultDevs = [], maintainDevs = [], normalDevs = [];
    console.log(`同步-开始判断 ${devices.length} 台设备状态，工单 ${workOrders.length} 条，历史档案 ${archiveList.length} 条`);
    for (const dev of devices) {
      const latest = latestByDevice[dev.id];
      if (!latest) continue;
      let newStatus = null;
      if (latest.status === "故障") {
        // 检查在故障时间之后是否有已验收的工单（工单表或历史档案）
        const faultTime = new Date((latest.inspect_date || latest.inspectDate || "") + " " + (latest.inspect_time || latest.inspectTime || ""));
        const hasAcceptedOrder = workOrders.some(w => {
          if (w.deviceId !== dev.id) return false;
          if (w.status !== "accepted") return false;
          // 严格匹配：必须有关联的巡检记录ID，且和当前故障记录一致（避免旧工单误判新故障）
          if (!w.inspectLogId || !latest.id || w.inspectLogId !== latest.id) return false;
          const acceptTime = new Date(w.acceptedAt || w.completedAt || w.createdAt || "");
          return acceptTime > faultTime;
        });
        const matchedArchives = archiveList.filter(a => {
          if (a.deviceId !== dev.id && a.device_id !== dev.id) return false;
          // 严格匹配：必须有关联的巡检记录ID，且和当前故障记录一致（避免旧档案误判新故障）
          if (!a.inspectLogId || !latest.id || a.inspectLogId !== latest.id) return false;
          const archiveTime = new Date(a.acceptedAt || a.archiveTime || 0);
          return archiveTime > faultTime;
        });
        const hasAcceptedArchive = matchedArchives.length > 0;
        console.log(`  🔍 设备[${dev.deviceType || dev.id}] 最新巡检=故障(${latest.inspect_date} ${latest.inspect_time}) 记录ID=${latest.id || '无'} 已验收工单=${hasAcceptedOrder} 已验收档案=${hasAcceptedArchive}(${matchedArchives.length}条) 原状态=${dev.status}`);
        if (hasAcceptedOrder || hasAcceptedArchive) {
          newStatus = "正常"; // 故障已修复
          console.log(`    → 判定为已修复，改为正常`);
        } else {
          newStatus = "故障"; // 故障未处理
          console.log(`    → 判定为未处理，保持故障`);
        }
      }
      else if (latest.status === "需维保") newStatus = "待维保";
      else if (latest.status === "正常") newStatus = "正常";
      if (newStatus && dev.status !== newStatus) {
        dev.status = newStatus;
        await dbPut(SD, dev);
        updated++;
        if (newStatus === "故障") faultDevs.push(dev.deviceType || dev.id);
        else if (newStatus === "待维保") maintainDevs.push(dev.deviceType || dev.id);
        else normalDevs.push(dev.deviceType || dev.id);
      }
    }
    if (updated > 0) {
      console.log(`同步-已更新 ${updated} 台设备状态：故障${faultDevs.length}台，待维保${maintainDevs.length}台，正常${normalDevs.length}台`);
      console.log("  故障设备:", faultDevs);
      // 刷新顶部栏统计
      if (typeof calcStat === 'function') calcStat();
      // 刷新已打开的设施列表总览
      const facilityModal = document.getElementById('modal-facility-list');
      if (facilityModal && !facilityModal.classList.contains('hidden') && typeof openFacilityList === 'function') {
        openFacilityList();
      }
      // 刷新地图标记
      if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
      showToast(`已同步 ${updated} 台设备状态`);
    } else {
      console.log("同步-设备状态已是最新，无需更新");
    }
  } catch (e) { console.warn("同步设备状态失败", e); }
}

// 渲染巡检记录列表（9列）
async function renderInspectRecords() {
  const filterVal = document.getElementById('inspect-record-filter')?.value || "";
  const list = filterVal ? allInspectRecords.filter(r => r.status === filterVal) : allInspectRecords;
  document.getElementById('inspect-record-count').innerText = '共 ' + list.length + ' 条';

  if (!list.length) {
    document.getElementById('inspect-records-list').innerHTML = '<div style="color:#999;text-align:center;padding:20px">暂无巡检记录</div>';
    return;
  }

  // 构建当前存在的设备ID集合（用于标记"设备已删除"）
  const allDevices = await dbGetAll(SD);
  const existingDeviceIds = new Set(allDevices.map(d => d.id));

  // 仅对没有快照的旧记录，一次性查表补全位置
  const needQueryIds = [...new Set(list.filter(x => !x.snap_building).map(r => r.device_id).filter(Boolean))];
  const devMap = {};
  if (needQueryIds.length > 0) {
    const allDev = await dbGetAll(SD);
    const allFloor = await dbGetAll(SF);
    const allBuild = await dbGetAll(SB);
    for (const did of needQueryIds) {
      const d = allDev.find(x => x.id === did);
      if (!d) { devMap[did] = { building: "", floor: "", devType: "已删除设备", devCode: "" }; continue; }
      const f = allFloor.find(x => x.id === d.floorId);
      const b = allBuild.find(x => x.id === f?.buildingId);
      devMap[did] = {
        building: b?.name || "",
        floor: f?.floorName || "",
        devType: d.deviceType || "未知",
        devCode: d.deviceCode || ""
      };
    }
  }

  // 组装最终展示数据（同时存到全局供导出用）
  // 加载所有工单，用于匹配巡检记录的工单状态
  // 先从云端同步最新工单状态（手机验收后能及时反映）
  try { if (typeof syncWorkOrdersFromCloud === 'function') await syncWorkOrdersFromCloud(); } catch(e) {}
  const allOrders = await dbGetAll(S_WORKORDER);
  // 补同步：把本地有 inspectLogId 的工单同步到云端（确保之前创建的工单也能关联）
  try {
    if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
      for (const o of allOrders) {
        if (o.inspectLogId) syncWorkOrderToCloud(o);
      }
    }
  } catch(e) {}
  const orderMap = {};
  for (const o of allOrders) {
    if (o.inspectLogId) orderMap[o.inspectLogId] = o;
  }
  
  // 加载历史档案（已验收工单已归档，即使工单删除也能判断故障已修复）
  const archiveList = typeof getArchive === 'function' ? getArchive() : [];
  // 按设备ID分组历史档案
  const archiveByDevice = {};
  for (const a of archiveList) {
    const did = a.deviceId || a.device_id;
    if (did) {
      if (!archiveByDevice[did]) archiveByDevice[did] = [];
      archiveByDevice[did].push(a);
    }
  }
  // 按巡检记录ID分组历史档案（精确匹配用，避免旧档案误判新故障）
  const archiveByLogId = {};
  for (const a of archiveList) {
    if (a.inspectLogId) archiveByLogId[a.inspectLogId] = a;
  }
  
  window._exportList = list.map(item => {
    if (item.snap_building || item.snap_floor || item.snap_devType) {
      return {
        time: `${item.inspect_date || ""} ${item.inspect_time || ""}`.trim(),
        inspector: item.inspector_name || "未知",
        building: item.snap_building || "-",
        floor: item.snap_floor || "-",
        devType: item.snap_devType || "-",
        devCode: item.snap_devCode || "-",
        status: item.status || "未知",
        remark: item.remark || "-",
        source: item.source || "-"
      };
    }
    const info = devMap[item.device_id] || { building: "-", floor: "-", devType: "已删除设备", devCode: "-" };
    return {
      time: `${item.inspect_date || ""} ${item.inspect_time || ""}`.trim(),
      inspector: item.inspector_name || "未知",
      building: info.building || "-",
      floor: info.floor || "-",
      devType: info.devType || "-",
      devCode: info.devCode || "-",
      status: item.status || "未知",
      remark: item.remark || "-",
      source: item.source || "-"
    };
  });

  let html = '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  html += '<thead><tr style="background:#f5f5f5">';
  const sortableCols = [
    ['time', '巡检时间'], ['inspector', '巡检人'], ['building', '建筑'], ['floor', '楼层'],
    ['devType', '设备类型'], ['devCode', '设备编号'], ['status', '巡检结果'], ['remark', '备注事件'], ['source', '来源']
  ];
  sortableCols.forEach(([key, label]) => {
    const arrow = key === _inspectSortKey ? (_inspectSortDir === 1 ? ' ▲' : ' ▼') : '';
    html += `<th onclick="sortInspectRecords('${key}')" style="padding:8px;text-align:left;border-bottom:2px solid #ddd;cursor:pointer;user-select:none;white-space:nowrap" title="点击排序">${label}${arrow}</th>`;
  });
  html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #ddd">工单状态</th>';
  html += '<th style="padding:8px;text-align:center;border-bottom:2px solid #ddd">操作</th>';
  html += '</tr></thead><tbody>';

  // 按设备ID分组工单（不依赖 inspectLogId，更可靠）
  const ordersByDevice = {};
  for (const o of allOrders) {
    const did = o.deviceId || o.device_id;
    if (did) {
      if (!ordersByDevice[did]) ordersByDevice[did] = [];
      ordersByDevice[did].push(o);
    }
  }
  
  // 已匹配的工单ID集合（确保一个工单只匹配一个故障记录）
  const matchedOrderIds = new Set();
  
  // 按当前排序状态排序（默认按巡检时间从早到晚）
  const sortedList = list.map((item, idx) => ({ item, idx })).sort((a, b) => {
    const ra = window._exportList[a.idx];
    const rb = window._exportList[b.idx];
    if (!ra || !rb) return 0;
    let va = ra[_inspectSortKey];
    let vb = rb[_inspectSortKey];
    if (_inspectSortKey === 'time') {
      // 时间字段：转换成时间戳比较
      const ta = new Date(String(va || '').replace(' ', 'T')).getTime() || 0;
      const tb = new Date(String(vb || '').replace(' ', 'T')).getTime() || 0;
      return (ta - tb) * _inspectSortDir;
    }
    // 其他字段：字符串比较（中文按拼音）
    va = String(va || '').trim();
    vb = String(vb || '').trim();
    if (va === vb) return 0;
    return va.localeCompare(vb, 'zh-Hans-CN') * _inspectSortDir;
  });

  sortedList.forEach(({ item, idx }) => {
    const row = window._exportList[idx];
    const deviceId = item.device_id || item.deviceId;
    const inspectTime = new Date((item.inspect_date || item.inspectDate || "") + " " + (item.inspect_time || item.inspectTime || ""));
    
    // 判断设备是否无效（ID为空 或 设备已删除）
    const isDeviceEmpty = !deviceId; // 设备ID为空
    const isDeviceDeleted = deviceId && !existingDeviceIds.has(deviceId); // 设备已删除
    const isDeviceInvalid = isDeviceEmpty || isDeviceDeleted;
    
    // 找到该设备的工单（优先用 inspectLogId 精确匹配，其次用设备ID匹配，同一设备多条记录共享同一个工单）
    let matchedOrder = orderMap[item.id] || null;
    if (!matchedOrder && deviceId && ordersByDevice[deviceId]) {
      // 找该设备所有未处理的工单（pending/processing/completed），不排除已被其他记录匹配的
      const candidates = ordersByDevice[deviceId].filter(o => {
        return o.status === 'pending' || o.status === 'processing' || o.status === 'completed';
      });
      if (candidates.length > 0) {
        // 按时间排序，取最早的
        candidates.sort((a, b) => new Date(a.createdAt || a.created_at || 0) - new Date(b.createdAt || b.created_at || 0));
        matchedOrder = candidates[0];
      }
    }
    // 匹配成功，记录该工单已被使用（仅用于精确匹配去重）
    if (matchedOrder) {
      matchedOrderIds.add(matchedOrder.id);
    }
    
    // 判断故障是否已修复：有已验收工单，或历史档案中有该记录的验收记录（精确匹配inspectLogId）
    let isFixed = false;
    let archiveRecord = null;
    if (row.status === '故障') {
      if (matchedOrder && matchedOrder.status === 'accepted') {
        isFixed = true;
      } else if (item.id && archiveByLogId[item.id]) {
        // 精确匹配：档案记录的 inspectLogId 和当前故障记录ID一致
        archiveRecord = archiveByLogId[item.id];
        isFixed = true;
      }
    }
    
    // 巡检结果显示
    let displayStatus = row.status || '未知';
    let statusCss = row.status === '正常' ? 'color:#22c55e' : row.status === '故障' ? 'color:#ef4444' : 'color:#f59e0b';
    if (isFixed) {
      displayStatus = '故障(已修复)';
      statusCss = 'color:#10b981';
    }
    // 工单状态：故障记录显示生成工单按钮或工单状态
    let orderCell = '<span style="color:#999">-</span>';
    if (row.status === '故障') {
      if (isDeviceInvalid) {
        // 设备无效（ID为空或已删除），不允许生成工单
        orderCell = '<span style="color:#9ca3af;font-size:12px">🚫 无法生成工单</span>';
      } else if (matchedOrder) {
        const orderStatusMap = { pending: "待派单", processing: "进行中", completed: "待验收", accepted: "已验收" };
        const orderColorMap = { pending: "#ef4444", processing: "#f59e0b", completed: "#3b82f6", accepted: "#10b981" };
        const os = orderStatusMap[matchedOrder.status] || matchedOrder.status;
        const oc = orderColorMap[matchedOrder.status] || "#666";
        orderCell = `<span style="color:${oc};font-weight:500;cursor:pointer" onclick="viewWorkOrderFromInspect('${matchedOrder.id}')">🔧 ${os}</span>`;
      } else if (archiveRecord) {
        // 工单已删除但已归档，显示已归档
        orderCell = '<span style="color:#10b981;font-weight:500">📚 已归档</span>';
      } else {
        orderCell = `<button class="btn small primary" style="padding:2px 8px;font-size:11px" onclick="createWorkOrderFromInspectRecord('${item.id}')">生成工单</button>`;
      }
    }
    html += `<tr style="border-bottom:1px solid #eee">
      <td style="padding:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px" data-full="${row.time || ''}">${row.time || ''}</td>
      <td style="padding:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px" data-full="${row.inspector || ''}">${row.inspector || ''}</td>
      <td style="padding:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px" data-full="${row.building || ''}">${row.building || ''}</td>
      <td style="padding:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px" data-full="${row.floor || ''}">${row.floor || ''}</td>
      <td style="padding:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px" data-full="${row.devType || ''}">${row.devType || ''}${isDeviceEmpty ? ' <span style="color:#f59e0b;font-size:11px;font-weight:normal">⚠️无设备信息</span>' : isDeviceDeleted ? ' <span style="color:#ef4444;font-size:11px;font-weight:normal">⚠️已删除</span>' : ''}</td>
      <td style="padding:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px" data-full="${row.devCode || ''}">${row.devCode || ''}</td>
      <td style="padding:8px;${statusCss};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px" data-full="${displayStatus || ''}">${displayStatus || ''}</td>
      <td style="padding:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px" data-full="${row.remark || ''}">${row.remark || ''}</td>
      <td style="padding:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px" data-full="${row.source || ''}">${row.source || ''}</td>
      <td style="padding:8px;white-space:nowrap">${orderCell}</td>
      <td style="padding:8px;white-space:nowrap;text-align:center">
        ${(item.formId || item.form_data_id) ? `<button class="btn small" style="padding:2px 8px;font-size:11px;background:#f0fdfa;color:#0d9488;border:1px solid #99f6e4;margin-right:4px" onclick="viewInspectFormData('${item.id}')" title="查看关联表单数据">📋 表单</button><button class="btn small" style="padding:2px 8px;font-size:11px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;margin-right:4px" onclick="exportInspectFormData('${item.id}')" title="导出表单数据">📤 导出</button>` : ''}
        ${(typeof isSuperAdmin === 'function' && isSuperAdmin()) ? `<button class="btn small" style="padding:2px 8px;font-size:11px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca" onclick="deleteInspectRecord('${item.id}')" title="删除此记录">🗑️ 删除</button>` : (item.formId || item.form_data_id) ? '' : '<span style="color:#ccc;font-size:11px">-</span>'}
      </td>
    </tr>`;
  });

  html += '</tbody></table>';
  document.getElementById('inspect-records-list').innerHTML = html;
}

// 点击表头排序巡检记录
function sortInspectRecords(key) {
  if (_inspectSortKey === key) {
    // 同一列：切换升降序
    _inspectSortDir = _inspectSortDir === 1 ? -1 : 1;
  } else {
    // 新列：默认降序（时间默认降序，其他默认升序）
    _inspectSortKey = key;
    _inspectSortDir = key === 'time' ? -1 : 1;
  }
  renderInspectRecords();
}

// 一键清理无效巡检记录（设备已删除的记录）
async function cleanupInvalidInspectRecords() {
  try {
    // 加载所有设备
    const allDevices = await dbGetAll(SD);
    const existingDeviceIds = new Set(allDevices.map(d => d.id));
    console.log('清理无效记录：当前设备数', allDevices.length, '设备ID集合', [...existingDeviceIds]);
    
    // 用 allInspectRecords（已包含本地+云端）找出无效记录
    if (!allInspectRecords || allInspectRecords.length === 0) {
      await loadInspectRecords();
    }
    
    const invalidRecords = allInspectRecords.filter(r => {
      const did = r.device_id || r.deviceId;
      const isEmpty = !did; // 设备ID为空
      const isDeleted = did && !existingDeviceIds.has(did); // 设备已删除
      const isInvalid = isEmpty || isDeleted;
      if (isInvalid) {
        console.log('  无效记录:', r.id, '设备ID:', did || '(空)', '设备类型:', r.snap_devType, '时间:', r.inspect_date, r.inspect_time, isEmpty ? '[无设备信息]' : '[已删除]');
      }
      return isInvalid;
    });
    
    console.log('清理无效记录：找到', invalidRecords.length, '条无效记录');
    
    if (invalidRecords.length === 0) {
      showToast("没有需要清理的无效记录");
      return;
    }
    
    // 确认删除
    const ok = await confirmDialog(`找到 ${invalidRecords.length} 条设备已删除的巡检记录。\n\n这些记录对应的设备已不存在，保留它们没有实际意义。\n\n确定要删除这些记录吗？删除后不可恢复！`);
    if (!ok) return;
    
    // 分别删除本地和云端记录
    let localDeleted = 0, cloudDeleted = 0;
    
    // 删除本地记录
    const localLogs = await dbGetAll(S_LOG);
    for (const rec of invalidRecords) {
      const localLog = localLogs.find(l => l.id === rec.id);
      if (localLog) {
        await dbDel(S_LOG, localLog.id);
        localDeleted++;
      }
    }
    
    // 删除云端记录
    if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
      for (const rec of invalidRecords) {
        try {
          // 云端记录的ID可能是原始ID，也可能是我们生成的 cloud_ 开头的ID
          let cloudId = rec.id;
          if (cloudId.startsWith('cloud_')) {
            // 从生成的ID中提取原始信息，或者用 device_id + 时间来匹配删除
            console.log('  云端记录ID为生成的，尝试用 device_id + 时间删除:', cloudId);
          }
          await Cloud.supabase.from('inspect_logs').delete().eq('id', cloudId);
          cloudDeleted++;
        } catch(e) { 
          console.warn('删除云端记录失败:', rec.id, e);
        }
      }
    }
    
    showToast(`已清理 ${localDeleted + cloudDeleted} 条无效记录（本地${localDeleted}条，云端${cloudDeleted}条）`);
    
    // 重新加载巡检记录
    await loadInspectRecords();
    await renderInspectRecords();
    
    // 刷新统计
    if (typeof calcStat === 'function') calcStat();
    if (typeof loadWorkbenchData === 'function') loadWorkbenchData();
    
  } catch(e) {
    console.error('清理无效记录失败:', e);
    showToast("清理失败：" + e.message);
  }
}

// 删除单条巡检记录
async function deleteInspectRecord(recordId) {
  if (!recordId) return;
  // 权限校验：只有超级管理员可以删除
  if (typeof isSuperAdmin === 'function' && !isSuperAdmin()) {
    showToast("⚠️ 仅超级管理员可删除巡检记录");
    return;
  }
  try {
    const ok = await confirmDialog("⚠️确认删除这条巡检记录？\n\n删除后不可恢复，本地和云端都会同步删除。");
    if (!ok) return;
    
    // 删除本地记录
    await dbDel(S_LOG, recordId);
    
    // 删除云端记录
    if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
      try {
        await Cloud.supabase.from('inspect_logs').delete().eq('id', recordId);
      } catch(e) { console.warn('删除云端记录失败:', recordId, e); }
    }
    
    showToast("记录已删除");
    
    // 重新加载巡检记录
    await loadInspectRecords();
    await renderInspectRecords();
    
    // 刷新统计
    if (typeof calcStat === 'function') calcStat();
    if (typeof loadWorkbenchData === 'function') loadWorkbenchData();
    
  } catch(e) {
    console.error('删除巡检记录失败:', e);
    showToast("删除失败：" + e.message);
  }
}

// 导出 Excel（与弹窗完全一致，文件名带日期）
async function exportInspectRecordsExcel() {
  if (!window._exportList || window._exportList.length === 0) {
    showToast("正在加载巡检记录，请稍候…");
    await loadInspectRecords();
    await renderInspectRecords();
  }
  const rows = [];
  rows.push(["巡检时间", "巡检人", "建筑", "楼层", "设备类型", "设备编号", "巡检结果", "备注事件", "来源"]);
  window._exportList.forEach(r => {
    rows.push([r.time, r.inspector, r.building, r.floor, r.devType, r.devCode, r.status, r.remark, r.source]);
  });
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  // 设置每列宽度，确保内容不换行显示
  sheet['!cols'] = [
    { wch: 18 }, // 巡检时间
    { wch: 10 }, // 巡检人
    { wch: 15 }, // 建筑
    { wch: 8 },  // 楼层
    { wch: 12 }, // 设备类型
    { wch: 12 }, // 设备编号
    { wch: 10 }, // 巡检结果
    { wch: 20 }, // 备注事件
    { wch: 10 }  // 来源
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "巡检记录");
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  XLSX.writeFile(wb, "巡检记录_" + dateStr + ".xlsx");
  showToast("导出完成");
}
// 弹窗拖拽移动 + 右下角缩放
function enableModalResize(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  const box = modal.querySelector('.resizable-modal');
  const resizeHandle = modal.querySelector('.resize-handle');
  const dragHandle = modal.querySelector('#inspect-modal-header');
  if (!box) return;
  if (box._dragResizeEnabled) return;
  box._dragResizeEnabled = true;

  // ===== 拖拽移动 =====
  let isDragging = false;
  let dragStartX, dragStartY, boxStartLeft, boxStartTop;

  if (dragHandle) {
    dragHandle.addEventListener('mousedown', e => {
      // 点击在按钮/下拉框上时不触发拖拽
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      // 把 transform 居中转为像素定位，方便拖拽
      const rect = box.getBoundingClientRect();
      box.style.transform = 'none';
      box.style.left = rect.left + 'px';
      box.style.top = rect.top + 'px';
      boxStartLeft = rect.left;
      boxStartTop = rect.top;
      e.preventDefault();
    });
  }

  // ===== 右下角缩放 =====
  let isResizing = false;
  let resizeStartX, resizeStartY, startW, startH;

  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', e => {
      isResizing = true;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      startW = box.offsetWidth;
      startH = box.offsetHeight;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  document.addEventListener('mousemove', e => {
    if (isDragging) {
      let newLeft = boxStartLeft + (e.clientX - dragStartX);
      let newTop = boxStartTop + (e.clientY - dragStartY);
      // 限制不拖出屏幕
      newLeft = Math.max(-box.offsetWidth + 100, Math.min(newLeft, window.innerWidth - 100));
      newTop = Math.max(0, Math.min(newTop, window.innerHeight - 60));
      box.style.left = newLeft + 'px';
      box.style.top = newTop + 'px';
    }
    if (isResizing) {
      let w = startW + (e.clientX - resizeStartX);
      let h = startH + (e.clientY - resizeStartY);
      w = Math.max(600, Math.min(w, window.innerWidth * 0.95));
      h = Math.max(400, Math.min(h, window.innerHeight * 0.90));
      box.style.width = w + 'px';
      box.style.height = h + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    isResizing = false;
  });
}

/* ============================================================
 * 巡检计划自动生成
 * ============================================================ */

// 创建巡检计划
async function createInspectPlan(data) {
  const plan = {
    id: genId(),
    name: data.name || "巡检计划",
    cycle: data.cycle || "monthly", // monthly/quarterly/yearly/weekly
    buildingId: data.buildingId || null,
    floorId: data.floorId || null,
    deviceType: data.deviceType || null,
    assignee: data.assignee || "",
    nextDate: data.nextDate || new Date().toISOString().split('T')[0],
    status: data.status || "active", // active/disabled
    createdAt: new Date().toISOString(),
    lastGenerated: null,
    remark: data.remark || ""
  };
  await dbPut(S_PLAN, plan);
  addOperationLog("create_plan", `创建巡检计划：${plan.name}`);
  showToast("巡检计划已创建");
  return plan;
}

// 获取巡检计划列表
async function getInspectPlans(filter) {
  let plans = await dbGetAll(S_PLAN);
  if (filter) {
    if (filter.status) plans = plans.filter(p => p.status === filter.status);
    if (filter.cycle) plans = plans.filter(p => p.cycle === filter.cycle);
  }
  return plans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// 更新巡检计划
async function updateInspectPlan(planId, updates) {
  const plans = await dbGetAll(S_PLAN);
  const plan = plans.find(p => p.id === planId);
  if (!plan) return;
  Object.assign(plan, updates);
  await dbPut(S_PLAN, plan);
  renderInspectPlanList();
}

// 删除巡检计划
async function deleteInspectPlan(planId) {
  if (!await confirmDialog("确认删除该巡检计划？")) return;
  await dbDel(S_PLAN, planId);
  addOperationLog("delete_plan", "删除巡检计划");
  renderInspectPlanList();
  showToast("计划已删除");
  // 刷新工作台数据
  const wb = document.getElementById('maintain-workbench');
  if (wb && wb.style.display !== 'none' && typeof loadWorkbenchData === 'function') loadWorkbenchData();
}

// 计算下次执行日期
function calcNextDate(currentDate, cycle) {
  const d = new Date(currentDate);
  switch (cycle) {
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
    default: d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().split('T')[0];
}

// 检查到期计划并自动生成巡检任务
async function checkAndGenerateTasks() {
  const today = new Date().toISOString().split('T')[0];
  const plans = await getInspectPlans({ status: "active" });
  let generated = 0;

  for (const plan of plans) {
    if (plan.nextDate <= today) {
      // 生成巡检任务（已统一存入S_PLAN表）
      const task = await createInspectTask({
        name: plan.name + "（" + today + "）",
        buildingId: plan.buildingId,
        floorId: plan.floorId,
        deviceType: plan.deviceType,
        planDate: today,
        assignee: plan.assignee,
        remark: "由计划自动生成：" + plan.name
      });
      task.fromPlanId = plan.id;
      await dbPut(S_PLAN, task);

      // 更新计划下次日期
      plan.lastGenerated = today;
      plan.nextDate = calcNextDate(today, plan.cycle);
      await dbPut(S_PLAN, plan);
      generated++;
    }
  }

  if (generated > 0) {
    showToast(`已自动生成 ${generated} 个巡检任务`);
    addOperationLog("auto_generate", `自动生成 ${generated} 个巡检任务`);
  }
  return generated;
}

// 渲染巡检计划列表
async function renderInspectPlanList() {
  const box = document.getElementById("inspect-plan-list");
  if (!box) return;
  const plans = await getInspectPlans();
  const buildings = await dbGetAll(SB);
  const floors = await dbGetAll(SF);

  if (!plans.length) {
    box.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无巡检计划，点击上方按钮创建</div>';
    return;
  }

  const cycleText = { weekly: "每周", monthly: "每月", quarterly: "每季度", yearly: "每年" };
  let html = "";
  plans.forEach(p => {
    const b = buildings.find(x => x.id === p.buildingId);
    const f = floors.find(x => x.id === p.floorId);
    const statusColor = p.status === "active" ? "#10b981" : "#9ca3af";
    const statusText = p.status === "active" ? "启用中" : "已停用";
    html += `<div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:bold;font-size:14px">${p.name}</span>
        <span style="font-size:12px;color:${statusColor};background:${statusColor}15;padding:2px 8px;border-radius:10px">${statusText}</span>
      </div>
      <div style="font-size:12px;color:#666;line-height:1.8">
        <div>周期：${cycleText[p.cycle] || p.cycle} | 下次执行：${p.nextDate}</div>
        <div>范围：${b?.name || "全部建筑"} ${f?.floorName || ""} ${p.deviceType ? "(" + p.deviceType + ")" : ""}</div>
        <div>负责人：${p.assignee || "未分配"} | 上次生成：${p.lastGenerated || "从未"}</div>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px">
        <button class="btn small" onclick="updateInspectPlan('${p.id}',{status:'${p.status === 'active' ? 'disabled' : 'active'}'})">${p.status === 'active' ? '停用' : '启用'}</button>
        <button class="btn small del" onclick="deleteInspectPlan('${p.id}')">删除</button>
      </div>
    </div>`;
  });
  box.innerHTML = html;
}

// 打开巡检计划管理
function openInspectPlanManager() {
  renderInspectPlanList();
  openModal('modal-inspect-plan');
}

// 打开创建计划弹窗
async function openCreatePlanModal() {
  const buildings = await dbGetAll(SB);
  const bSelect = document.getElementById("plan-building");
  bSelect.innerHTML = '<option value="">全部建筑</option>' + buildings.map(b => `<option value="${b.id}">${b.name}</option>`).join("");
  document.getElementById("plan-name").value = "";
  document.getElementById("plan-cycle").value = "monthly";
  document.getElementById("plan-assignee").value = "";
  document.getElementById("plan-next-date").value = new Date().toISOString().split('T')[0];
  updatePlanFloorSelect();
  openModal('modal-create-plan');
}

// 更新计划楼层下拉
async function updatePlanFloorSelect() {
  const buildingId = document.getElementById("plan-building").value;
  const fSelect = document.getElementById("plan-floor");
  if (!buildingId) {
    fSelect.innerHTML = '<option value="">全部楼层</option>';
    return;
  }
  const floors = await dbGetAll(SF);
  const buildingFloors = floors.filter(f => f.buildingId === buildingId);
  fSelect.innerHTML = '<option value="">全部楼层</option>' + buildingFloors.map(f => `<option value="${f.id}">${f.floorName}</option>`).join("");
}

// 提交创建计划
async function submitCreatePlan() {
  const name = document.getElementById("plan-name").value.trim();
  if (!name) { showToast("请输入计划名称"); return; }
  await createInspectPlan({
    name: name,
    cycle: document.getElementById("plan-cycle").value,
    buildingId: document.getElementById("plan-building").value || null,
    floorId: document.getElementById("plan-floor").value || null,
    assignee: document.getElementById("plan-assignee").value.trim(),
    nextDate: document.getElementById("plan-next-date").value
  });
  closeModal('modal-create-plan');
  openModal('modal-inspect-plan');
  await renderInspectPlanList();
  showToast("巡检计划已创建");
  // 刷新工作台数据
  const wb = document.getElementById('maintain-workbench');
  if (wb && wb.style.display !== 'none' && typeof loadWorkbenchData === 'function') loadWorkbenchData();
}

/* ============================================================
 * 隐患整改闭环
 * ============================================================ */

// 创建隐患整改单
async function createHiddenDanger(data) {
  const danger = {
    id: genId(),
    deviceId: data.deviceId || null,
    inspectLogId: data.inspectLogId || null,
    title: data.title || "隐患整改",
    description: data.description || "",
    level: data.level || "normal", // normal/major
    status: "pending", // pending/processing/completed/accepted
    reporter: currentUser?.username || "未知",
    assignee: data.assignee || "",
    deadline: data.deadline || "",
    createdAt: new Date().toISOString(),
    completedAt: null,
    acceptedAt: null,
    fixDescription: "",
    photos: [],
    remark: data.remark || "",
    // 位置快照
    snapshot_buildingName: data.snapshot_buildingName || "",
    snapshot_floorName: data.snapshot_floorName || "",
    snapshot_deviceType: data.snapshot_deviceType || "",
    snapshot_deviceCode: data.snapshot_deviceCode || ""
  };
  await dbPut(S_HIDDEN, danger);
  addOperationLog("create_danger", `创建隐患整改：${danger.title}`);
  showToast("隐患整改单已创建");
  return danger;
}

// 获取隐患列表
async function getHiddenDangers(filter) {
  let dangers = await dbGetAll(S_HIDDEN);
  if (filter) {
    if (filter.status) dangers = dangers.filter(d => d.status === filter.status);
    if (filter.level) dangers = dangers.filter(d => d.level === filter.level);
    if (filter.deviceId) dangers = dangers.filter(d => d.deviceId === filter.deviceId);
  }
  return dangers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// 更新隐患状态
async function updateHiddenDanger(dangerId, updates) {
  const dangers = await dbGetAll(S_HIDDEN);
  const danger = dangers.find(d => d.id === dangerId);
  if (!danger) return;
  Object.assign(danger, updates);
  if (updates.status === "completed" && !danger.completedAt) danger.completedAt = new Date().toISOString();
  if (updates.status === "accepted" && !danger.acceptedAt) danger.acceptedAt = new Date().toISOString();
  await dbPut(S_HIDDEN, danger);
  renderHiddenDangerList();
  showToast("已更新");
}

// 删除隐患单
async function deleteHiddenDanger(dangerId) {
  if (!await confirmDialog("确认删除该隐患整改单？")) return;
  await dbDel(S_HIDDEN, dangerId);
  renderHiddenDangerList();
  showToast("已删除");
}

// 获取超期未整改的隐患
async function getOverdueDangers() {
  const today = new Date().toISOString().split('T')[0];
  const dangers = await getHiddenDangers();
  return dangers.filter(d => d.status !== "accepted" && d.deadline && d.deadline < today);
}

// 渲染隐患整改列表
async function renderHiddenDangerList() {
  const box = document.getElementById("hidden-danger-list");
  if (!box) return;
  const filter = document.getElementById('hidden-danger-filter')?.value || '';
  let dangers = await getHiddenDangers(filter ? { status: filter } : null);

  if (!dangers.length) {
    box.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无隐患记录</div>';
    return;
  }

  const statusMap = {
    pending: { text: "待整改", color: "#ef4444" },
    processing: { text: "整改中", color: "#f59e0b" },
    completed: { text: "待验收", color: "#3b82f6" },
    accepted: { text: "已验收", color: "#10b981" }
  };
  const levelMap = { normal: "一般", major: "重大" };
  const today = new Date().toISOString().split('T')[0];

  let html = "";
  dangers.forEach(d => {
    const s = statusMap[d.status] || { text: d.status, color: "#666" };
    const overdue = d.status !== "accepted" && d.deadline && d.deadline < today;
    html += `<div style="padding:12px;border:1px solid ${overdue ? '#ef4444' : '#e5e7eb'};border-radius:8px;margin-bottom:8px;background:${overdue ? '#fef2f2' : '#fff'}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:bold;font-size:14px">${d.title}</span>
        <div style="display:flex;gap:6px;align-items:center">
          ${overdue ? '<span style="font-size:11px;color:#ef4444;font-weight:bold">⚠️已超期</span>' : ''}
          <span style="font-size:11px;color:${d.level === 'major' ? '#ef4444' : '#666'}">${levelMap[d.level] || ''}</span>
          <span style="font-size:12px;color:${s.color};background:${s.color}15;padding:2px 8px;border-radius:10px">${s.text}</span>
        </div>
      </div>
      <div style="font-size:12px;color:#666;line-height:1.8">
        <div>🏢 建筑：${d.snapshot_buildingName || '-'} | 🏬 楼层：${d.snapshot_floorName || '-'} | 🔧 设备：${d.snapshot_deviceType || ''} ${d.snapshot_deviceCode || ''}</div>
        <div>描述：${d.description || '-'}</div>
        <div>上报人：${d.reporter} | 整改人：${d.assignee || '未分配'} | 期限：${d.deadline || '未设置'}</div>
        ${d.fixDescription ? `<div>整改说明：${d.fixDescription}</div>` : ''}
      </div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        ${d.status === 'pending' ? `<button class="btn small primary" onclick="startFixDanger('${d.id}')">开始整改</button>` : ''}
        ${d.status === 'processing' ? `<button class="btn small primary" onclick="completeFixDanger('${d.id}')">完成整改</button>` : ''}
        ${d.status === 'completed' ? `<button class="btn small primary" onclick="acceptDanger('${d.id}')">验收通过</button>` : ''}
        <button class="btn small" onclick="editDanger('${d.id}')">编辑</button>
        <button class="btn small del" onclick="deleteHiddenDanger('${d.id}')">删除</button>
      </div>
    </div>`;
  });
  box.innerHTML = html;
}

// 开始整改
function startFixDanger(id) {
  updateHiddenDanger(id, { status: "processing" });
}

// 完成整改
async function completeFixDanger(id) {
  const desc = prompt("请输入整改说明：");
  if (desc === null) return;
  await updateHiddenDanger(id, { status: "completed", fixDescription: desc });
}

// 验收通过
async function acceptDanger(id) {
  if (!await confirmDialog("确认验收通过？")) return;
  updateHiddenDanger(id, { status: "accepted" });
}

// 编辑隐患单
async function editDanger(id) {
  const dangers = await dbGetAll(S_HIDDEN);
  const d = dangers.find(x => x.id === id);
  if (!d) return;
  document.getElementById("danger-id").value = d.id;
  document.getElementById("danger-title").value = d.title;
  document.getElementById("danger-desc").value = d.description;
  document.getElementById("danger-level").value = d.level;
  document.getElementById("danger-assignee").value = d.assignee;
  document.getElementById("danger-deadline").value = d.deadline;
  openModal('modal-edit-danger');
}

// 保存隐患编辑
async function saveDangerEdit() {
  const id = document.getElementById("danger-id").value;
  await updateHiddenDanger(id, {
    title: document.getElementById("danger-title").value,
    description: document.getElementById("danger-desc").value,
    level: document.getElementById("danger-level").value,
    assignee: document.getElementById("danger-assignee").value,
    deadline: document.getElementById("danger-deadline").value
  });
  closeModal('modal-edit-danger');
}

// 打开隐患整改管理
function openHiddenDangerManager() {
  renderHiddenDangerList();
  openModal('modal-hidden-danger');
}

// 从巡检记录快速创建隐患单
async function createDangerFromInspect(log) {
  const devs = await dbGetAll(SD);
  const dev = devs.find(d => d.id === log.deviceId);
  const floors = await dbGetAll(SF);
  const buildings = await dbGetAll(SB);
  const floor = floors.find(f => f.id === dev?.floorId);
  const building = buildings.find(b => b.id === floor?.buildingId);

  document.getElementById("danger-id").value = "";
  document.getElementById("danger-title").value = (dev?.deviceType || "设备") + "隐患整改";
  document.getElementById("danger-desc").value = log.remark || "巡检发现异常";
  document.getElementById("danger-level").value = "normal";
  document.getElementById("danger-assignee").value = "";
  document.getElementById("danger-deadline").value = "";
  document.getElementById("danger-device-id").value = log.deviceId || "";
  document.getElementById("danger-log-id").value = log.id || "";
  document.getElementById("danger-building-name").value = building?.name || "";
  document.getElementById("danger-floor-name").value = floor?.floorName || "";
  document.getElementById("danger-device-type").value = dev?.deviceType || "";
  document.getElementById("danger-device-code").value = dev?.deviceCode || "";
  openModal('modal-edit-danger');
}

// 提交新建隐患单
async function submitCreateDanger() {
  await createHiddenDanger({
    deviceId: document.getElementById("danger-device-id").value || null,
    inspectLogId: document.getElementById("danger-log-id").value || null,
    title: document.getElementById("danger-title").value,
    description: document.getElementById("danger-desc").value,
    level: document.getElementById("danger-level").value,
    assignee: document.getElementById("danger-assignee").value,
    deadline: document.getElementById("danger-deadline").value,
    snapshot_buildingName: document.getElementById("danger-building-name").value,
    snapshot_floorName: document.getElementById("danger-floor-name").value,
    snapshot_deviceType: document.getElementById("danger-device-type").value,
    snapshot_deviceCode: document.getElementById("danger-device-code").value
  });
  closeModal('modal-edit-danger');
  openModal('modal-hidden-danger');
  if (typeof renderHiddenDangerList === 'function') await renderHiddenDangerList();
  showToast("隐患单已创建");
}

// 打开新建隐患单弹窗（清空表单）
function openCreateDangerModal() {
  document.getElementById("danger-id").value = "";
  document.getElementById("danger-title").value = "";
  document.getElementById("danger-desc").value = "";
  document.getElementById("danger-level").value = "normal";
  document.getElementById("danger-assignee").value = "";
  document.getElementById("danger-deadline").value = "";
  document.getElementById("danger-device-id").value = "";
  document.getElementById("danger-log-id").value = "";
  document.getElementById("danger-building-name").value = "";
  document.getElementById("danger-floor-name").value = "";
  document.getElementById("danger-device-type").value = "";
  document.getElementById("danger-device-code").value = "";
  document.getElementById("danger-modal-title").innerText = "➕ 新建隐患整改单";
  openModal('modal-edit-danger');
}

// 统一提交隐患单（新建或编辑）
async function submitDangerForm() {
  const id = document.getElementById("danger-id").value;
  if (id) {
    // 编辑模式
    await updateHiddenDanger(id, {
      title: document.getElementById("danger-title").value,
      description: document.getElementById("danger-desc").value,
      level: document.getElementById("danger-level").value,
      assignee: document.getElementById("danger-assignee").value,
      deadline: document.getElementById("danger-deadline").value
    });
  } else {
    // 新建模式
    await createHiddenDanger({
      deviceId: document.getElementById("danger-device-id").value || null,
      inspectLogId: document.getElementById("danger-log-id").value || null,
      title: document.getElementById("danger-title").value,
      description: document.getElementById("danger-desc").value,
      level: document.getElementById("danger-level").value,
      assignee: document.getElementById("danger-assignee").value,
      deadline: document.getElementById("danger-deadline").value,
      snapshot_buildingName: document.getElementById("danger-building-name").value,
      snapshot_floorName: document.getElementById("danger-floor-name").value,
      snapshot_deviceType: document.getElementById("danger-device-type").value,
      snapshot_deviceCode: document.getElementById("danger-device-code").value
    });
  }
  closeModal('modal-edit-danger');
  openModal('modal-hidden-danger');
  if (typeof renderHiddenDangerList === 'function') await renderHiddenDangerList();
  showToast("隐患单已创建");
}

/* ============================================================
 * 设备档案详情
 * ============================================================ */

let currentArchiveDeviceId = null;
let archiveTabSeq = 0; // 档案Tab切换序号，防止异步竞态覆盖内容

// 渲染设备基本信息（供打开档案和切换Tab复用）
function renderArchiveInfoHTML(dev) {
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
      <div><span style="color:#666">设备类型：</span>${dev.deviceType || '-'}</div>
      <div><span style="color:#666">设备编号：</span>${dev.deviceCode || '-'}</div>
      <div><span style="color:#666">安装日期：</span>${dev.installDate || '-'}</div>
      <div><span style="color:#666">使用年限：</span>${dev.lifeYears ? dev.lifeYears + '年' : '不限'}</div>
      <div><span style="color:#666">下次维保：</span>${dev.nextMaintain || '-'}</div>
      <div><span style="color:#666">生产厂家：</span>${dev.manufacturer || '-'}</div>
      <div><span style="color:#666">规格型号：</span>${dev.model || '-'}</div>
      <div><span style="color:#666">责任人：</span>${dev.person || '-'}</div>
      <div style="grid-column:1/-1"><span style="color:#666">位置描述：</span>${dev.positionDesc || '-'}</div>
      <div style="grid-column:1/-1"><span style="color:#666">备注：</span>${dev.remark || '-'}</div>
    </div>
  `;
}

// 打开设备档案详情
async function openDeviceArchive(deviceId) {
  currentArchiveDeviceId = deviceId;
  const devs = await dbGetAll(SD);
  const dev = devs.find(d => d.id === deviceId);
  if (!dev) { showToast("设备不存在"); return; }

  const floors = await dbGetAll(SF);
  const buildings = await dbGetAll(SB);
  const floor = floors.find(f => f.id === dev.floorId);
  const building = buildings.find(b => b.id === floor?.buildingId);

  // 填充基本信息
  document.getElementById("archive-device-name").innerText = (dev.deviceType || "未知设备") + (dev.deviceCode ? " - " + dev.deviceCode : "");
  document.getElementById("archive-device-location").innerText = (building?.name || "") + " " + (floor?.floorName || "") + " " + (dev.positionDesc || "");
  document.getElementById("archive-device-status").innerText = dev.status || "未知";
  document.getElementById("archive-device-status").style.color = dev.status === "正常" ? "#10b981" : dev.status === "故障" ? "#ef4444" : "#f59e0b";

  document.getElementById("archive-tab-content").innerHTML = renderArchiveInfoHTML(dev);

  // 切换到基本信息Tab
  switchArchiveTab('info');

  openModal('modal-device-archive');
}

// 切换档案Tab
async function switchArchiveTab(tab) {
  // 更新Tab样式
  document.querySelectorAll('.archive-tab').forEach(t => {
    t.style.background = t.dataset.tab === tab ? '#2563eb' : '#f3f4f6';
    t.style.color = t.dataset.tab === tab ? '#fff' : '#374151';
  });

  // 记录本次切换序号：异步完成后若序号已变，说明用户又切了别的Tab，丢弃本次结果
  const mySeq = ++archiveTabSeq;

  const box = document.getElementById("archive-tab-content");
  const deviceId = currentArchiveDeviceId;
  if (!deviceId) return;

  if (tab === 'info') {
    // 重新渲染基本信息（切换过其他Tab后内容已残留，必须重新填充）
    const devs = await dbGetAll(SD);
    if (mySeq !== archiveTabSeq) return;
    const dev = devs.find(d => d.id === deviceId);
    if (dev) box.innerHTML = renderArchiveInfoHTML(dev);
    return;
  }

  if (tab === 'maintain') {
    // 维保记录
    const logs = await dbGetAll(SL);
    if (mySeq !== archiveTabSeq) return;
    const devLogs = logs.filter(l => l.deviceId === deviceId).sort((a, b) => new Date(b.date) - new Date(a.date));
    if (!devLogs.length) {
      box.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无维保记录</div>';
      return;
    }
    let html = '<div style="position:relative;padding-left:20px">';
    devLogs.forEach((l, i) => {
      const isLast = i === devLogs.length - 1;
      html += `<div style="position:relative;padding-bottom:${isLast ? '0' : '16px'}">
        <div style="position:absolute;left:-16px;top:4px;width:10px;height:10px;border-radius:50%;background:#10b981;border:2px solid #fff;box-shadow:0 0 0 2px #10b981"></div>
        ${!isLast ? '<div style="position:absolute;left:-12px;top:14px;bottom:0;width:2px;background:#e5e7eb"></div>' : ''}
        <div style="font-weight:bold;font-size:13px">${l.date || ''} - ${l.result || '维保'}</div>
        <div style="font-size:12px;color:#666;margin-top:2px">维保人：${l.person || '未知'}</div>
        ${l.remark ? `<div style="font-size:12px;color:#666;margin-top:2px">备注：${l.remark}</div>` : ''}
      </div>`;
    });
    html += '</div>';
    box.innerHTML = html;
  }

  if (tab === 'inspect') {
    // 巡检记录
    const logs = await dbGetAll(S_LOG);
    if (mySeq !== archiveTabSeq) return;
    const devLogs = logs.filter(l => l.deviceId === deviceId).sort((a, b) => new Date(b.inspectDate) - new Date(a.inspectDate));
    if (!devLogs.length) {
      box.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无巡检记录</div>';
      return;
    }
    const resultMap = { normal: "正常", fault: "故障", "maintain-needed": "需维保" };
    const colorMap = { normal: "#10b981", fault: "#ef4444", "maintain-needed": "#f59e0b" };
    let html = '<div style="position:relative;padding-left:20px">';
    devLogs.forEach((l, i) => {
      const isLast = i === devLogs.length - 1;
      const color = colorMap[l.result] || "#666";
      html += `<div style="position:relative;padding-bottom:${isLast ? '0' : '16px'}">
        <div style="position:absolute;left:-16px;top:4px;width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px ${color}"></div>
        ${!isLast ? '<div style="position:absolute;left:-12px;top:14px;bottom:0;width:2px;background:#e5e7eb"></div>' : ''}
        <div style="font-weight:bold;font-size:13px">${l.inspectDate || ''} ${l.inspectTime || ''} - <span style="color:${color}">${resultMap[l.result] || l.result}</span></div>
        <div style="font-size:12px;color:#666;margin-top:2px">巡检人：${l.inspector || '未知'}</div>
        ${l.remark ? `<div style="font-size:12px;color:#666;margin-top:2px">备注：${l.remark}</div>` : ''}
      </div>`;
    });
    html += '</div>';
    box.innerHTML = html;
  }

  if (tab === 'danger') {
    // 隐患整改记录
    const dangers = await getHiddenDangers({ deviceId: deviceId });
    if (mySeq !== archiveTabSeq) return;
    if (!dangers.length) {
      box.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无隐患整改记录</div>';
      return;
    }
    const statusMap = { pending: "待整改", processing: "整改中", completed: "待验收", accepted: "已验收" };
    const colorMap = { pending: "#ef4444", processing: "#f59e0b", completed: "#3b82f6", accepted: "#10b981" };
    let html = '<div style="position:relative;padding-left:20px">';
    dangers.forEach((d, i) => {
      const isLast = i === dangers.length - 1;
      const color = colorMap[d.status] || "#666";
      html += `<div style="position:relative;padding-bottom:${isLast ? '0' : '16px'}">
        <div style="position:absolute;left:-16px;top:4px;width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px ${color}"></div>
        ${!isLast ? '<div style="position:absolute;left:-12px;top:14px;bottom:0;width:2px;background:#e5e7eb"></div>' : ''}
        <div style="font-weight:bold;font-size:13px">${d.title} - <span style="color:${color}">${statusMap[d.status] || d.status}</span></div>
        <div style="font-size:12px;color:#666;margin-top:2px">上报：${d.reporter} | 整改：${d.assignee || '未分配'} | 期限：${d.deadline || '未设置'}</div>
        <div style="font-size:12px;color:#666;margin-top:2px">描述：${d.description || '-'}</div>
        ${d.fixDescription ? `<div style="font-size:12px;color:#10b981;margin-top:2px">整改说明：${d.fixDescription}</div>` : ''}
      </div>`;
    });
    html += '</div>';
    box.innerHTML = html;
  }
}

/* ============================================================
 * 维保工单系统
 * ============================================================ */

// 创建维保工单
async function createWorkOrder(data) {
  const order = {
    id: genId(),
    title: data.title || "维保工单",
    deviceId: data.deviceId || null,
    type: data.type || "repair", // repair=故障维修, maintain=定期维保, emergency=紧急抢修
    status: "pending", // pending=待派单, processing=进行中, completed=已完成, accepted=已验收
    priority: data.priority || "normal", // normal=一般, urgent=紧急
    reporter: currentUser?.username || "未知",
    assignee: data.assignee || "",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    acceptedAt: null,
    description: data.description || "",
    fixDescription: "",
    partsUsed: [], // 更换的配件 [{name, qty, price}]
    cost: 0,
    photos: [],
    remark: data.remark || "",
    // 位置快照
    snapshot_buildingName: data.snapshot_buildingName || "",
    snapshot_floorName: data.snapshot_floorName || "",
    snapshot_deviceType: data.snapshot_deviceType || "",
    snapshot_deviceCode: data.snapshot_deviceCode || ""
  };
  await dbPut(S_WORKORDER, order);
  addOperationLog("create_workorder", `创建维保工单：${order.title}`);
  // 同步到云端（扫码页面维修员界面从云端加载）
  syncWorkOrderToCloud(order);
  // 微信通知
  if (typeof sendWechatNotify === 'function') {
    sendWechatNotify("新工单", `【新工单】${order.title}\n类型：${order.type}\n上报人：${order.reporter}\n描述：${order.description}`);
  }
  showToast("维保工单已创建");
  return order;
}

// 获取工单列表
async function getWorkOrders(filter) {
  let orders = await dbGetAll(S_WORKORDER);
  if (filter) {
    if (filter.status) orders = orders.filter(o => o.status === filter.status);
    if (filter.priority) orders = orders.filter(o => o.priority === filter.priority);
    if (filter.assignee) orders = orders.filter(o => o.assignee === filter.assignee);
    if (filter.deviceId) orders = orders.filter(o => o.deviceId === filter.deviceId);
  }
  return orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// 更新工单
async function updateWorkOrder(orderId, updates) {
  const orders = await dbGetAll(S_WORKORDER);
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  Object.assign(order, updates);
  if (updates.status === "processing" && !order.startedAt) order.startedAt = new Date().toISOString();
  if (updates.status === "completed" && !order.completedAt) order.completedAt = new Date().toISOString();
  if (updates.status === "accepted" && !order.acceptedAt) order.acceptedAt = new Date().toISOString();
  await dbPut(S_WORKORDER, order);
  return order;
}

// 同步工单到云端（扫码页面维修员界面从云端加载工单）
async function syncWorkOrderToCloud(order) {
  try {
    if (typeof Cloud === 'undefined' || !Cloud.enabled || !Cloud.supabase) return false;

    // 字段转换：驼峰命名 → 下划线命名（扫码页面期望的格式）
    const cloudOrder = {
      id: order.id,
      title: order.title || '',
      status: order.status || 'pending',
      type: order.type || 'repair',
      priority: order.priority || 'normal',
      assignee: order.assignee || '',
      assignee_id: order.assigneeId || '',
      reporter: order.reporter || '',
      description: order.description || '',
      fix_description: order.fixDescription || '',
      cost: order.cost || 0,
      parts_used: order.partsUsed ? JSON.stringify(order.partsUsed) : '[]',
      // 位置快照（下划线命名）
      snapshot_building_name: order.snapshot_buildingName || '',
      snapshot_floor_name: order.snapshot_floorName || '',
      snapshot_device_type: order.snapshot_deviceType || '',
      snapshot_device_code: order.snapshot_deviceCode || '',
      building_name: order.snapshot_buildingName || '',
      floor_name: order.snapshot_floorName || '',
      device_code: order.snapshot_deviceCode || '',
      // 时间
      created_at: order.createdAt || new Date().toISOString(),
      started_at: order.startedAt || null,
      completed_at: order.completedAt || null,
      accepted_at: order.acceptedAt || null,
      // 闭环留痕
      assigned_by: order.assignedBy || '',
      assigned_at: order.assignedAt || null,
      completed_by: order.completedBy || '',
      accepted_by: order.acceptedBy || '',
      accept_remark: order.acceptRemark || '',
      // 关联巡检记录
      inspect_log_id: order.inspectLogId || null,
      device_id: order.deviceId || null
    };

    // 先查询是否存在
    const { data: existing, error: queryError } = await Cloud.supabase
      .from('work_orders')
      .select('id')
      .eq('id', order.id);

    if (queryError) {
      console.error('查询云端工单失败:', queryError);
      return false;
    }

    let error;
    if (existing && existing.length > 0) {
      // 存在则更新
      const result = await Cloud.supabase
        .from('work_orders')
        .update(cloudOrder)
        .eq('id', order.id);
      error = result.error;
    } else {
      // 不存在则插入
      const result = await Cloud.supabase
        .from('work_orders')
        .insert(cloudOrder);
      error = result.error;
    }

    if (error) {
      console.error('同步工单到云端失败:', error);
      console.error('失败详情:', JSON.stringify(error, null, 2));
      console.error('尝试同步的数据:', cloudOrder);
      // 保存最后一次错误，方便用户查看
      window._lastSyncError = error;
      return false;
    }
    console.log('工单同步云端成功:', order.id);
    return true;
  } catch (e) {
    console.error('同步工单到云端异常:', e);
    console.error('异常详情:', e.message, e.stack);
    window._lastSyncError = e;
    return false;
  }
}

// 一键同步所有工单到云端（用于修复同步失败的情况）
async function syncAllWorkOrdersToCloud() {
  try {
    if (typeof Cloud === 'undefined' || !Cloud.enabled || !Cloud.supabase) {
      showToast('云端未连接，无法同步');
      return;
    }
    const orders = await dbGetAll(S_WORKORDER);
    if (!orders.length) {
      showToast('暂无工单需要同步');
      return;
    }
    showToast('正在同步 ' + orders.length + ' 条工单到云端...');
    let success = 0;
    let failed = 0;
    for (const order of orders) {
      const result = await syncWorkOrderToCloud(order);
      if (result) success++;
      else failed++;
    }
    showToast('同步完成：成功 ' + success + ' 条，失败 ' + failed + ' 条');
    if (failed > 0) {
      console.warn('同步失败的工单:', orders.filter((o, i) => {
        // 简单标记，实际需要看 syncWorkOrderToCloud 的返回
        return false;
      }));
    }
  } catch (e) {
    console.error('一键同步工单失败:', e);
    showToast('同步失败：' + (e.message || e));
  }
}

// 全局变量：保存数据大屏窗口引用
let dataScreenWindow = null;

// 工单状态变化后统一刷新所有界面
async function refreshAllAfterOrderChange() {
  // 1. 刷新工单列表
  if (typeof renderWorkOrderList === 'function') {
    try { await renderWorkOrderList(); } catch(e) {}
  }
  // 2. 刷新工作台（总是刷新数据，不管工作台是否打开，这样下次打开时就是最新的）
  if (typeof loadWorkbenchData === 'function') {
    try { loadWorkbenchData(); } catch(e) {}
  }
  // 3. 刷新顶部栏统计
  if (typeof calcStat === 'function') {
    try { calcStat(); } catch(e) {}
  }
  // 4. 刷新地图标记
  if (typeof renderDeviceMarkers === 'function') {
    try { renderDeviceMarkers(); } catch(e) {}
  }
  // 5. 刷新已打开的设施列表
  const facilityModal = document.getElementById('modal-facility-list');
  if (facilityModal && !facilityModal.classList.contains('hidden') && typeof openFacilityList === 'function') {
    try { openFacilityList(); } catch(e) {}
  }
  // 6. 尝试刷新数据大屏窗口
  if (dataScreenWindow && !dataScreenWindow.closed) {
    try {
      // 数据大屏是独立窗口，发送消息通知刷新
      dataScreenWindow.postMessage({ type: 'refreshDataScreen' }, '*');
    } catch(e) {}
  }
}

// 删除工单
async function deleteWorkOrder(orderId) {
  if (!await confirmDialog("确认删除该维保工单？\n（已验收的工单已自动归档到历史档案，删除工单不影响档案记录）")) return;
  await dbDel(S_WORKORDER, orderId);
  // 同步删除云端工单
  try {
    if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
      await Cloud.supabase.from('work_orders').delete().eq('id', orderId);
    }
  } catch(e) { console.warn('删除云端工单失败:', e); }
  renderWorkOrderList();
  showToast("工单已删除");
  // 统一刷新所有相关界面（工作台、顶部统计、地图标记等）
  if (typeof refreshAllAfterOrderChange === 'function') {
    try { await refreshAllAfterOrderChange(); } catch(e) {}
  }
}

// 从云端同步工单状态（维修员在手机上操作后，主系统能看到最新状态）
async function syncWorkOrdersFromCloud() {
  try {
    if (typeof Cloud === 'undefined' || !Cloud.enabled || !Cloud.supabase) return false;

    const { data, error } = await Cloud.supabase.from('work_orders').select('*');
    if (error) { console.error('从云端同步工单失败:', error); return false; }

    const cloudOrders = data || [];
    const localOrders = await dbGetAll(S_WORKORDER);
    let updated = 0;

    for (const cloudOrder of cloudOrders) {
      const localOrder = localOrders.find(o => o.id === cloudOrder.id);
      if (localOrder) {
        // 云端状态更新，则同步到本地
        const cloudTime = new Date(cloudOrder.updated_at || cloudOrder.completed_at || cloudOrder.accepted_at || cloudOrder.created_at || 0);
        const localTime = new Date(localOrder.updatedAt || localOrder.completedAt || localOrder.acceptedAt || localOrder.createdAt || 0);
        if (cloudTime > localTime || cloudOrder.status !== localOrder.status) {
          const wasAccepted = localOrder.status === 'accepted';
          // 字段转换：下划线命名 → 驼峰命名
          localOrder.status = cloudOrder.status || localOrder.status;
          localOrder.fixDescription = cloudOrder.fix_description || localOrder.fixDescription;
          localOrder.cost = cloudOrder.cost || localOrder.cost;
          localOrder.completedBy = cloudOrder.completed_by || localOrder.completedBy;
          localOrder.completedAt = cloudOrder.completed_at || localOrder.completedAt;
          localOrder.acceptedBy = cloudOrder.accepted_by || localOrder.acceptedBy;
          localOrder.acceptedAt = cloudOrder.accepted_at || localOrder.acceptedAt;
          localOrder.acceptRemark = cloudOrder.accept_remark || localOrder.acceptRemark;
          localOrder.assignee = cloudOrder.assignee || localOrder.assignee;
          localOrder.assigneeId = cloudOrder.assignee_id || localOrder.assigneeId;
          // 关联巡检记录
          localOrder.inspectLogId = cloudOrder.inspect_log_id || localOrder.inspectLogId;
          localOrder.deviceId = cloudOrder.device_id || localOrder.deviceId;
          await dbPut(S_WORKORDER, localOrder);
          updated++;
          
          // 闭环：如果工单刚变成已验收，自动更新设备状态为正常，自动归档并删除工单
          if (!wasAccepted && localOrder.status === 'accepted') {
            // 更新设备状态为正常
            if (localOrder.deviceId) {
              try {
                const devs = await dbGetAll(SD);
                const dev = devs.find(d => d.id === localOrder.deviceId);
                if (dev && (dev.status === "故障" || dev.status === "待维保")) {
                  dev.status = "正常";
                  await dbPut(SD, dev);
                }
              } catch(e) { console.warn('同步验收后更新设备状态失败:', e); }
            }
            // 自动归档到历史档案
            if (typeof addToArchive === 'function') {
              try { addToArchive(localOrder); } catch(e) { console.warn('自动归档失败:', e); }
            }
            // 自动删除工单（已归档，不需要保留）
            try {
              await dbDel(S_WORKORDER, localOrder.id);
              // 同步删除云端工单
              if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
                await Cloud.supabase.from('work_orders').delete().eq('id', localOrder.id);
              }
            } catch(e) { console.warn('验收后自动删除工单失败:', e); }
          }
        }
      }
    }
    
    // 处理云端有但本地没有的已验收工单：直接归档并删除
    for (const cloudOrder of cloudOrders) {
      const localExists = localOrders.find(o => o.id === cloudOrder.id);
      if (!localExists && cloudOrder.status === 'accepted') {
        // 转换为本地格式
        const archiveOrder = {
          id: cloudOrder.id,
          title: cloudOrder.title || '',
          status: 'accepted',
          type: cloudOrder.type || 'repair',
          deviceId: cloudOrder.device_id || null,
          description: cloudOrder.description || '',
          snapshot_buildingName: cloudOrder.snapshot_building_name || cloudOrder.building_name || '',
          snapshot_floorName: cloudOrder.snapshot_floor_name || cloudOrder.floor_name || '',
          snapshot_deviceType: cloudOrder.snapshot_device_type || '',
          snapshot_deviceCode: cloudOrder.snapshot_device_code || cloudOrder.device_code || '',
          assignee: cloudOrder.assignee || '',
          fixDescription: cloudOrder.fix_description || '',
          cost: cloudOrder.cost || 0,
          completedBy: cloudOrder.completed_by || '',
          completedAt: cloudOrder.completed_at || '',
          acceptedBy: cloudOrder.accepted_by || '',
          acceptedAt: cloudOrder.accepted_at || '',
          acceptRemark: cloudOrder.accept_remark || '',
          createdAt: cloudOrder.created_at || '',
          inspectLogId: cloudOrder.inspect_log_id || null
        };
        // 归档到历史档案
        if (typeof addToArchive === 'function') {
          try { addToArchive(archiveOrder); } catch(e) {}
        }
        // 更新设备状态为正常
        if (archiveOrder.deviceId) {
          try {
            const devs = await dbGetAll(SD);
            const dev = devs.find(d => d.id === archiveOrder.deviceId);
            if (dev && (dev.status === "故障" || dev.status === "待维保")) {
              dev.status = "正常";
              await dbPut(SD, dev);
            }
          } catch(e) {}
        }
        // 删除云端工单
        try {
          await Cloud.supabase.from('work_orders').delete().eq('id', cloudOrder.id);
          updated++;
        } catch(e) { console.warn('删除云端已验收工单失败:', e); }
      }
    }

    if (updated > 0) {
      console.log('从云端同步了 ' + updated + ' 条工单状态');
      // 刷新顶部统计和地图标记（设备状态可能已更新）
      if (typeof calcStat === 'function') calcStat();
      if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
    }
    return updated > 0;
  } catch (e) {
    console.error('从云端同步工单异常:', e);
    return false;
  }
}

// 渲染工单列表
async function renderWorkOrderList() {
  const box = document.getElementById("workorder-list");
  if (!box) return;

  // 先从云端同步最新状态（维修员手机操作后，主系统能看到）
  try {
    await syncWorkOrdersFromCloud();
  } catch(e) {}

  const filter = document.getElementById('workorder-filter')?.value || '';
  let allOrders = await getWorkOrders(null);
  let orders = filter ? allOrders.filter(o => o.status === filter) : allOrders;
  
  // 状态统计
  const statusCount = { pending: 0, processing: 0, completed: 0, accepted: 0 };
  allOrders.forEach(o => { if (statusCount[o.status] !== undefined) statusCount[o.status]++; });

  // 顶部工具栏：一键同步到云端 + 状态统计
  let toolbarHtml = `<div style="margin-bottom:10px;padding:8px 12px;background:#f8fafc;border-radius:6px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:12px;color:#666">共 ${allOrders.length} 条工单</span>
      <button class="btn small ghost" onclick="syncAllWorkOrdersToCloud()" style="padding:4px 10px;font-size:12px">☁️ 一键同步到云端</button>
    </div>
    <div style="display:flex;gap:12px;font-size:11px;color:#666">
      <span>📋 待派单：<b style="color:#ef4444">${statusCount.pending}</b></span>
      <span>🔧 进行中：<b style="color:#f59e0b">${statusCount.processing}</b></span>
      <span>✅ 待验收：<b style="color:#3b82f6">${statusCount.completed}</b></span>
      <span>📚 已验收：<b style="color:#10b981">${statusCount.accepted}</b></span>
    </div>
  </div>`;

  if (!orders.length) {
    box.innerHTML = toolbarHtml + '<div style="padding:20px;color:#999;text-align:center">暂无维保工单</div>';
    return;
  }

  const statusMap = {
    pending: { text: "待派单", color: "#ef4444" },
    processing: { text: "进行中", color: "#f59e0b" },
    completed: { text: "待验收", color: "#3b82f6" },
    accepted: { text: "已验收", color: "#10b981" }
  };
  const typeMap = { repair: "故障维修", maintain: "定期维保", emergency: "紧急抢修" };
  const priorityMap = { normal: "一般", urgent: "紧急" };

  let html = "";
  orders.forEach(o => {
    const s = statusMap[o.status] || { text: o.status, color: "#666" };
    const sourceTag = o.inspectLogId ? '<span style="font-size:11px;background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:4px;margin-left:6px">📋 来自巡检</span>' : '';
    html += `<div data-order-id="${o.id}" style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;border-left:4px solid ${o.priority === 'urgent' ? '#ef4444' : s.color}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:bold;font-size:14px">${o.title}${sourceTag}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <span style="font-size:11px;color:${o.priority === 'urgent' ? '#ef4444' : '#666'}">${priorityMap[o.priority] || ''}</span>
          <span style="font-size:12px;color:${s.color};background:${s.color}15;padding:2px 8px;border-radius:10px">${s.text}</span>
        </div>
      </div>
      <div style="font-size:12px;color:#666;line-height:1.8">
        <div>类型：${typeMap[o.type] || o.type}</div>
        <div>🏢 建筑：${o.snapshot_buildingName || '-'} | 🏬 楼层：${o.snapshot_floorName || '-'} | 🔧 设备：${o.snapshot_deviceType || ''} ${o.snapshot_deviceCode || ''}</div>
        <div>上报人：${o.reporter || '未知'} | 创建时间：${o.createdAt?.split('T')[0] || ''} ${o.createdAt?.split('T')[1]?.substring(0,5) || ''}</div>
        <div style="white-space:pre-line;background:#f8fafc;padding:6px 8px;border-radius:4px;margin-top:4px">📝 故障描述：${o.description || '-'}</div>
        ${o.assignedBy ? `<div style="color:#d97706">📋 派单：${o.assignedBy} → ${o.assignee} | ${o.assignedAt?.split('T')[0] || ''} ${o.assignedAt?.split('T')[1]?.substring(0,5) || ''}</div>` : ''}
        ${o.fixDescription ? `<div style="color:#10b981;white-space:pre-line">🔧 维修：${o.completedBy || o.assignee || '未知'} | ${o.completedAt?.split('T')[0] || ''} ${o.completedAt?.split('T')[1]?.substring(0,5) || ''}<br>维修说明：${o.fixDescription}${o.cost ? ' | 费用：¥' + o.cost : ''}</div>` : ''}
        ${o.partsUsed && o.partsUsed.length ? `<div style="color:#10b981">🔩 更换配件：${o.partsUsed.map(p => p.name + '×' + p.qty).join('、')}</div>` : ''}
        ${o.acceptRemark ? `<div style="color:#059669">✅ 验收：${o.acceptedBy || '未知'} | ${o.acceptedAt?.split('T')[0] || ''} ${o.acceptedAt?.split('T')[1]?.substring(0,5) || ''}<br>验收意见：${o.acceptRemark}</div>` : (o.status === 'accepted' ? `<div style="color:#059669">✅ 验收：${o.acceptedBy || '未知'} | ${o.acceptedAt?.split('T')[0] || ''} ${o.acceptedAt?.split('T')[1]?.substring(0,5) || ''}</div>` : '')}
      </div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        ${o.formId ? `<button class="btn small" style="background:#f0fdfa;color:#0d9488;border:1px solid #99f6e4" onclick="viewWorkOrderFormData('${o.id}')">📋 维保表单</button><button class="btn small" style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe" onclick="exportWorkOrderFormData('${o.id}')">📤 导出</button>` : ''}
        ${o.acceptFormId ? `<button class="btn small" style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0" onclick="viewAcceptFormData('${o.id}')">✅ 验收表单</button><button class="btn small" style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe" onclick="exportAcceptFormData('${o.id}')">📤 导出</button>` : ''}
        ${o.status === 'pending' ? `<button class="btn small primary" onclick="assignWorkOrder('${o.id}')">派单</button>` : ''}
        ${o.status === 'processing' ? `<button class="btn small primary" onclick="completeWorkOrder('${o.id}')">完成维修</button>` : ''}
        ${o.status === 'completed' ? `<button class="btn small primary" onclick="acceptWorkOrder('${o.id}')">验收通过</button>` : ''}
        ${o.status === 'accepted' && o.acceptPhoto ? `<button class="btn small" onclick="viewAcceptPhoto('${o.id}')">📷 验收照片</button>` : ''}
        <button class="btn small" onclick="editWorkOrder('${o.id}')">编辑</button>
        <button class="btn small del" onclick="deleteWorkOrder('${o.id}')">删除</button>
      </div>
    </div>`;
  });
  box.innerHTML = toolbarHtml + html;
}

// 查看工单关联的表单数据
async function viewWorkOrderFormData(orderId) {
  await viewRelatedFormData("workOrder", orderId, "维保表单数据");
}

// 导出工单关联的表单数据
async function exportWorkOrderFormData(orderId) {
  await exportRelatedFormData("workOrder", orderId, "维保表单数据_" + orderId + ".txt");
}

// 查看验收关联的表单数据
async function viewAcceptFormData(orderId) {
  await viewRelatedFormData("acceptance", orderId, "验收表单数据");
}

// 导出验收关联的表单数据
async function exportAcceptFormData(orderId) {
  await exportRelatedFormData("acceptance", orderId, "验收表单数据_" + orderId + ".txt");
}

// 派单
// 打开派单弹窗
async function assignWorkOrder(id) {
  const orders = await dbGetAll(S_WORKORDER);
  const order = orders.find(o => o.id === id);
  if (!order) return;

  // 填充工单信息
  document.getElementById('assign-order-id').value = id;
  document.getElementById('assign-order-info').innerHTML = `
    <div><b>工单标题：</b>${order.title || '-'}</div>
    <div><b>故障设备：</b>${order.snapshot_deviceType || ''} ${order.snapshot_deviceCode || ''}</div>
    <div><b>位置：</b>${order.snapshot_buildingName || '-'} / ${order.snapshot_floorName || '-'}</div>
    <div><b>故障描述：</b>${order.description || '-'}</div>
  `;

  // 填充维修人员下拉框（从人员管理中筛选维修员）
  const staff = getStaff();
  const repairers = staff.filter(s => s.roles && s.roles.includes('repairer'));
  const select = document.getElementById('assign-repairer');
  select.innerHTML = '<option value="">请选择维修人员</option>';
  repairers.forEach(r => {
    const option = document.createElement('option');
    // value 保存为 "工号|姓名" 格式，扫码页面可以用工号匹配（工号唯一）
    // 注意：本地人员的工号是 workId 字段，不是 id（id 是自动生成的 staff_xxx）
    const workId = r.workId || r.id || '';
    option.value = workId + '|' + (r.name || '');
    option.textContent = (workId ? '[' + workId + '] ' : '') + r.name + (r.phone ? '（' + r.phone + '）' : '');
    select.appendChild(option);
  });

  // 如果没有维修员，提示去添加
  if (repairers.length === 0) {
    select.innerHTML = '<option value="">暂无维修员，请先在「人员管理」中添加</option>';
  }

  openModal('modal-assign');
}

// 确认派单
async function confirmAssign() {
  const id = document.getElementById('assign-order-id').value;
  const assigneeValue = document.getElementById('assign-repairer').value;
  if (!assigneeValue) { showToast('请选择维修人员'); return; }
  
  // 解析 "工号|姓名" 格式
  let assigneeId = '';
  let assigneeName = assigneeValue;
  if (assigneeValue.includes('|')) {
    const parts = assigneeValue.split('|');
    assigneeId = parts[0] || '';
    assigneeName = parts[1] || assigneeValue;
  }

  // 获取工单详情用于通知
  const orders = await dbGetAll(S_WORKORDER);
  const order = orders.find(o => o.id === id);

  // 记录派单人和派单时间（闭环留痕）
  const assigner = currentUser?.username || "未知";
  const updatedOrder = await updateWorkOrder(id, {
    status: "processing",
    assignee: assigneeName,
    assigneeId: assigneeId,
    assignedBy: assigner,
    assignedAt: new Date().toISOString()
  });

  // 同步到云端（扫码页面维修员界面从云端加载）
  let syncSuccess = false;
  if (updatedOrder) {
    showToast('正在同步到云端...');
    syncSuccess = await syncWorkOrderToCloud(updatedOrder);
  }

  if (typeof sendWechatNotify === 'function' && order) {
    const notifyContent = `【工单派单】
维修人：${assigneeName}${assigneeId ? '（工号：' + assigneeId + '）' : ''}
工单标题：${order.title || '维修工单'}
故障设备：${order.snapshot_deviceType || ''} ${order.snapshot_deviceCode || ''}
位置：${order.snapshot_buildingName || '-'} / ${order.snapshot_floorName || '-'}
故障描述：${order.description || '无'}
请及时处理！`;
    sendWechatNotify("工单派单通知", notifyContent);
  }

  closeModal('modal-assign');
  if (syncSuccess) {
    showToast("已派单，云端同步成功，已发送微信通知");
  } else {
    const err = window._lastSyncError;
    let errMsg = '';
    if (err) {
      if (err.message) errMsg = err.message;
      if (err.details) errMsg += ' | ' + err.details;
      if (err.code) errMsg += ' (代码:' + err.code + ')';
    }
    showToast("已派单，云端同步失败：" + (errMsg || '未知错误') + "，请点击「一键同步到云端」重试");
    console.error('派单同步失败详情:', err);
  }
  // 统一刷新所有界面
  await refreshAllAfterOrderChange();
}

// 完成维修
// 维修完成（打开弹窗，填写维修说明、费用、配件）
let _completeForm = null; // 维修完成弹窗中当前渲染的表单

async function completeWorkOrder(id) {
  const orders = await dbGetAll(S_WORKORDER);
  const order = orders.find(o => o.id === id);
  if (!order) return;

  // 填充工单信息
  document.getElementById("complete-wo-id").value = id;
  document.getElementById("complete-wo-info").innerHTML = `
    <div>标题：${order.title || '-'}</div>
    <div>设备：${order.snapshot_deviceType || ''} ${order.snapshot_deviceCode || ''}</div>
    <div>位置：${order.snapshot_buildingName || '-'} / ${order.snapshot_floorName || '-'}</div>
    <div>故障描述：${order.description || '-'}</div>
  `;
  // 清空表单
  document.getElementById("complete-description").value = "";
  document.getElementById("complete-cost").value = "0";
  document.getElementById("complete-parts").value = "";
  
  // 重置自定义表单
  _completeForm = null;
  document.getElementById("complete-form-area").style.display = "none";
  document.getElementById("complete-form-area").innerHTML = "";
  await renderFormSelector("complete-form-selector", "", async (formId) => {
    const area = document.getElementById("complete-form-area");
    if (!formId) {
      area.style.display = "none";
      area.innerHTML = "";
      _completeForm = null;
      return;
    }
    area.style.display = "block";
    area.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:16px">加载表单中...</div>';
    _completeForm = await renderFormFillById(formId, "complete-form-area", {}, false);
  });
  
  openModal("modal-complete-workorder");
}

// 提交维修完成
async function submitCompleteWorkOrder() {
  const id = document.getElementById("complete-wo-id").value;
  const desc = document.getElementById("complete-description").value.trim();
  const cost = parseFloat(document.getElementById("complete-cost").value) || 0;
  const partsStr = document.getElementById("complete-parts").value.trim();

  if (!desc) { showToast("请输入维修说明"); return; }

  // 解析配件
  let partsUsed = [];
  if (partsStr) {
    partsUsed = partsStr.split(/[,，、]/).map(p => {
      const match = p.trim().match(/^(.+?)[×x*](\d+)$/);
      if (match) return { name: match[1].trim(), qty: parseInt(match[2]) };
      return { name: p.trim(), qty: 1 };
    }).filter(p => p.name);
  }

  // 记录维修完成人（闭环留痕）
  const completer = currentUser?.username || "未知";
  const updates = {
    status: "completed",
    fixDescription: desc,
    cost: cost,
    partsUsed: partsUsed,
    completedBy: completer,
    completedAt: new Date().toISOString()
  };
  
  // 如果填写了自定义表单，保存表单数据
  if (_completeForm) {
    const formData = collectFormData(_completeForm);
    const valid = validateForm(_completeForm, formData);
    if (!valid.ok) {
      showToast("请填写表单必填项：" + valid.missing.join("、"));
      return;
    }
    updates.formId = _completeForm.id;
    updates.formName = _completeForm.name;
    const formDataRecord = await saveFormData(_completeForm.id, formData, "workOrder", id, completer);
    if (formDataRecord) {
      updates.formDataId = formDataRecord.id;
    }
  }
  
  const updatedOrder = await updateWorkOrder(id, updates);

  // 同步到云端
  if (updatedOrder) syncWorkOrderToCloud(updatedOrder);

  closeModal("modal-complete-workorder");
  showToast("维修已完成，即将进入验收环节");

  // 统一刷新所有界面
  await refreshAllAfterOrderChange();

  // 自动打开验收弹窗（形成闭环：维修完成 → 自动进入验收）
  setTimeout(() => {
    acceptWorkOrder(id);
  }, 500);
}

// 验收通过（打开验收弹窗，含拍照留证，自动填充工单和维修信息）
let _acceptForm = null; // 验收弹窗中当前渲染的表单

async function acceptWorkOrder(id) {
  const orders = await dbGetAll(S_WORKORDER);
  const order = orders.find(o => o.id === id);
  if (!order) return;
  // 填充工单信息（包含完整的维修记录，形成闭环）
  document.getElementById("accept-wo-id").value = id;
  document.getElementById("accept-wo-info").innerHTML = `
    <div><b>工单标题：</b>${order.title || '-'}</div>
    <div><b>故障设备：</b>${order.snapshot_deviceType || ''} ${order.snapshot_deviceCode || ''}</div>
    <div><b>位置：</b>${order.snapshot_buildingName || '-'} / ${order.snapshot_floorName || '-'}</div>
    <div><b>故障描述：</b>${order.description || '-'}</div>
    ${order.assignedBy ? `<div><b>派单：</b>${order.assignedBy} → ${order.assignee || '未分配'} | ${order.assignedAt?.split('T')[0] || ''} ${order.assignedAt?.split('T')[1]?.substring(0,5) || ''}</div>` : ''}
    <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #166534">
      <b>🔧 维修信息：</b><br>
      <b>维修人：</b>${order.completedBy || order.assignee || '未知'} | <b>维修时间：</b>${order.completedAt?.split('T')[0] || ''} ${order.completedAt?.split('T')[1]?.substring(0,5) || ''}<br>
      <b>维修说明：</b>${order.fixDescription || '-'}<br>
      ${order.cost ? `<b>维修费用：</b>¥${order.cost}` : ''}
      ${order.partsUsed && order.partsUsed.length ? `<br><b>更换配件：</b>${order.partsUsed.map(p => p.name + '×' + p.qty).join('、')}` : ''}
    </div>
  `;
  // 清空表单
  document.getElementById("accept-remark").value = "";
  document.getElementById("accept-photo").value = "";
  document.getElementById("accept-photo-preview").style.display = "none";
  document.getElementById("accept-photo-img").src = "";
  window._acceptPhotoData = null;
  
  // 重置自定义验收表单
  _acceptForm = null;
  document.getElementById("accept-form-area").style.display = "none";
  document.getElementById("accept-form-area").innerHTML = "";
  await renderFormSelector("accept-form-selector", "", async (formId) => {
    const area = document.getElementById("accept-form-area");
    if (!formId) {
      area.style.display = "none";
      area.innerHTML = "";
      _acceptForm = null;
      return;
    }
    area.style.display = "block";
    area.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:16px">加载表单中...</div>';
    _acceptForm = await renderFormFillById(formId, "accept-form-area", {}, false);
  });
  
  openModal("modal-accept-workorder");
}

// 验收照片上传
function onAcceptPhotoChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    // 压缩图片
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const maxSize = 800;
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = h * maxSize / w; w = maxSize; }
        else { w = w * maxSize / h; h = maxSize; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', 0.7);
      window._acceptPhotoData = compressed;
      document.getElementById("accept-photo-img").src = compressed;
      document.getElementById("accept-photo-preview").style.display = "block";
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// 清除验收照片
function clearAcceptPhoto() {
  window._acceptPhotoData = null;
  document.getElementById("accept-photo").value = "";
  document.getElementById("accept-photo-preview").style.display = "none";
  document.getElementById("accept-photo-img").src = "";
}

// 提交验收
async function submitAcceptWorkOrder() {
  const id = document.getElementById("accept-wo-id").value;
  const remark = document.getElementById("accept-remark").value.trim();
  const photo = window._acceptPhotoData || null;
  const orders = await dbGetAll(S_WORKORDER);
  const order = orders.find(o => o.id === id);
  // 更新工单（记录验收人，闭环留痕）
  const acceptor = currentUser?.username || "未知";
  const updates = { status: "accepted", acceptedAt: new Date().toISOString(), acceptedBy: acceptor };
  if (remark) updates.acceptRemark = remark;
  if (photo) updates.acceptPhoto = photo;
  
  // 如果填写了自定义验收表单，保存表单数据
  if (_acceptForm) {
    const formData = collectFormData(_acceptForm);
    const valid = validateForm(_acceptForm, formData);
    if (!valid.ok) {
      showToast("请填写验收表单必填项：" + valid.missing.join("、"));
      return;
    }
    updates.acceptFormId = _acceptForm.id;
    updates.acceptFormName = _acceptForm.name;
    const formDataRecord = await saveFormData(_acceptForm.id, formData, "acceptance", id, acceptor);
    if (formDataRecord) {
      updates.acceptFormDataId = formDataRecord.id;
    }
  }
  
  const updatedOrder = await updateWorkOrder(id, updates);

  // 同步到云端
  if (updatedOrder) syncWorkOrderToCloud(updatedOrder);
  // 闭环：工单验收后，自动更新设备状态为正常
  if (order && order.deviceId) {
    const devs = await dbGetAll(SD);
    const dev = devs.find(d => d.id === order.deviceId);
    // 故障或待维保状态都恢复为正常（已报废不恢复）
    if (dev && (dev.status === "故障" || dev.status === "待维保")) {
      dev.status = "正常";
      await dbPut(SD, dev);
      if (typeof calcStat === 'function') calcStat();
      if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
    }
  }
  closeModal("modal-accept-workorder");
  showToast("验收通过，已自动归档" + (photo ? "，照片已保存" : ""));

  // 自动归档到历史档案（独立存储，删除工单不影响历史）
  if (updatedOrder) addToArchive(updatedOrder);
  
  // 验收通过后自动删除工单（已归档，不需要保留在工单列表中）
  if (updatedOrder) {
    try {
      await dbDel(S_WORKORDER, id);
      // 同步删除云端工单
      if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
        await Cloud.supabase.from('work_orders').delete().eq('id', id);
      }
    } catch(e) { console.warn('验收后自动删除工单失败:', e); }
  }

  // 统一刷新所有界面（含设备状态已更新）
  await refreshAllAfterOrderChange();
}

// ========== 历史档案（独立存储，只读不可删） ==========
const ARCHIVE_KEY = "firemap_archive";

// 统一时间格式化函数（处理各种时间格式，避免乱码）
function formatDate(dateInput) {
  if (!dateInput) return '-';
  try {
    // 如果是 Date 对象
    if (dateInput instanceof Date) {
      return dateInput.toISOString().split('T')[0];
    }
    // 如果是数字（时间戳）
    if (typeof dateInput === 'number') {
      return new Date(dateInput).toISOString().split('T')[0];
    }
    // 如果是字符串
    if (typeof dateInput === 'string') {
      // 已经是 YYYY-MM-DD 格式
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
        return dateInput;
      }
      // ISO 格式或其他可解析格式
      const d = new Date(dateInput);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
      // 尝试提取日期部分
      const match = dateInput.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (match) {
        return match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
      }
      return dateInput.substring(0, 10);
    }
    return '-';
  } catch (e) {
    console.error('时间格式化失败:', dateInput, e);
    return '-';
  }
}

// 获取所有历史档案
function getArchive() {
  try {
    return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]");
  } catch (e) {
    return [];
  }
}

// 保存历史档案
function saveArchive(list) {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list));
}

// 将工单添加到历史档案（验收通过后自动调用）
function addToArchive(order) {
  try {
    const archive = getArchive();
    // 避免重复归档
    if (archive.find(a => a.id === order.id)) {
      console.log('该工单已在历史档案中:', order.id);
      return;
    }
    // 构建完整的档案记录（包含闭环全部信息）
    const record = {
      id: order.id,
      archiveTime: new Date().toISOString(),
      // 工单基本信息
      title: order.title || '',
      type: order.type || 'repair',
      priority: order.priority || 'normal',
      status: 'accepted',
      deviceId: order.deviceId || null,
      // 位置快照
      buildingName: order.snapshot_buildingName || '',
      floorName: order.snapshot_floorName || '',
      deviceType: order.snapshot_deviceType || '',
      deviceCode: order.snapshot_deviceCode || '',
      // 巡检/上报信息
      reporter: order.reporter || '',
      description: order.description || '',
      createdAt: order.createdAt || '',
      // 派单信息
      assignedBy: order.assignedBy || '',
      assignee: order.assignee || '',
      assignedAt: order.assignedAt || '',
      startedAt: order.startedAt || '',
      // 维修信息
      fixDescription: order.fixDescription || '',
      cost: order.cost || 0,
      partsUsed: order.partsUsed || [],
      completedBy: order.completedBy || '',
      completedAt: order.completedAt || '',
      // 验收信息
      acceptedBy: order.acceptedBy || '',
      acceptedAt: order.acceptedAt || '',
      acceptRemark: order.acceptRemark || '',
      acceptPhoto: order.acceptPhoto || null,
      // 关联
      inspectLogId: order.inspectLogId || null
    };
    archive.unshift(record); // 最新的在前面
    saveArchive(archive);
    console.log('工单已归档到历史档案:', order.id);
  } catch (e) {
    console.error('归档失败:', e);
  }
}

// 打开历史档案弹窗
async function openArchive() {
  openModal('modal-archive');
  renderArchiveList();
}

// 渲染历史档案列表
function renderArchiveList() {
  const box = document.getElementById('archive-list');
  const filter = document.getElementById('archive-filter')?.value || '';
  const keyword = document.getElementById('archive-search')?.value?.trim() || '';

  let list = getArchive();

  // 按筛选条件过滤
  if (filter) {
    list = list.filter(r => r.type === filter);
  }
  // 关键词搜索
  if (keyword) {
    const kw = keyword.toLowerCase();
    list = list.filter(r =>
      (r.title || '').toLowerCase().includes(kw) ||
      (r.buildingName || '').toLowerCase().includes(kw) ||
      (r.floorName || '').toLowerCase().includes(kw) ||
      (r.deviceType || '').toLowerCase().includes(kw) ||
      (r.deviceCode || '').toLowerCase().includes(kw) ||
      (r.assignee || '').toLowerCase().includes(kw) ||
      (r.acceptedBy || '').toLowerCase().includes(kw)
    );
  }

  document.getElementById('archive-count').innerText = '共 ' + list.length + ' 条档案';

  if (!list.length) {
    box.innerHTML = '<div style="padding:30px;color:#999;text-align:center">暂无历史档案<br><span style="font-size:12px">工单验收通过后将自动归档</span></div>';
    return;
  }

  const typeMap = { repair: '故障维修', maintain: '定期维保', emergency: '紧急抢修' };

  let html = '';
  list.forEach(r => {
    html += `<div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;border-left:4px solid #10b981">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:bold;font-size:14px">${r.title || '维修工单'}</span>
        <span style="font-size:11px;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px">已归档</span>
      </div>
      <div style="font-size:12px;color:#666;line-height:1.8">
        <div>📋 类型：${typeMap[r.type] || r.type} | 🏢 ${r.buildingName || '-'} / 🏬 ${r.floorName || '-'} | 🔧 ${r.deviceType || ''} ${r.deviceCode || ''}</div>
        <div>📝 故障：${r.description || '-'}</div>
        <div>👤 上报：${r.reporter || '未知'} | 🔧 维修：${r.assignee || '未分配'} | ✅ 验收：${r.acceptedBy || '未知'}</div>
        <div>📅 创建：${formatDate(r.createdAt)} | 维修完成：${formatDate(r.completedAt)} | 验收：${formatDate(r.acceptedAt)}</div>
        ${r.fixDescription ? `<div style="color:#166534">🔧 维修说明：${r.fixDescription}</div>` : ''}
        ${r.cost ? `<div style="color:#92400e">💰 费用：¥${r.cost}</div>` : ''}
        ${r.acceptRemark ? `<div style="color:#065f46">✅ 验收意见：${r.acceptRemark}</div>` : ''}
      </div>
      <div style="margin-top:8px;display:flex;gap:6px">
        <button class="btn small" onclick="viewArchiveDetail('${r.id}')">查看详情</button>
        ${r.acceptPhoto ? `<button class="btn small" onclick="viewArchivePhoto('${r.id}')">📷 验收照片</button>` : ''}
      </div>
    </div>`;
  });
  box.innerHTML = html;
}

// 查看档案详情
function viewArchiveDetail(id) {
  const archive = getArchive();
  const r = archive.find(a => a.id === id);
  if (!r) return;
  const typeMap = { repair: '故障维修', maintain: '定期维保', emergency: '紧急抢修' };
  const partsText = r.partsUsed && r.partsUsed.length ? r.partsUsed.map(p => p.name + '×' + p.qty).join('、') : '无';

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div style="background:#fff;border-radius:12px;max-width:600px;width:100%;max-height:85vh;overflow-y:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0">📚 档案详情</h3>
      <button style="background:none;border:none;font-size:20px;cursor:pointer" onclick="this.closest('div[style]').parentElement.parentElement.remove()">✕</button>
    </div>
    <div style="font-size:13px;line-height:2">
      <div style="background:#f0fdf4;padding:12px;border-radius:8px;margin-bottom:12px">
        <b>基本信息</b><br>
        工单标题：${r.title || '-'}<br>
        类型：${typeMap[r.type] || r.type}<br>
        位置：${r.buildingName || '-'} / ${r.floorName || '-'}<br>
        设备：${r.deviceType || ''} ${r.deviceCode || ''}
      </div>
      <div style="background:#fef2f2;padding:12px;border-radius:8px;margin-bottom:12px">
        <b>故障/上报信息</b><br>
        上报人：${r.reporter || '未知'}<br>
        创建时间：${formatDate(r.createdAt)}<br>
        故障描述：${r.description || '-'}
      </div>
      <div style="background:#eff6ff;padding:12px;border-radius:8px;margin-bottom:12px">
        <b>派单信息</b><br>
        派单人：${r.assignedBy || '-'}<br>
        维修人：${r.assignee || '-'}<br>
        派单时间：${formatDate(r.assignedAt)}
      </div>
      <div style="background:#f0fdf4;padding:12px;border-radius:8px;margin-bottom:12px">
        <b>维修信息</b><br>
        维修人：${r.completedBy || r.assignee || '-'}<br>
        完成时间：${formatDate(r.completedAt)}<br>
        维修说明：${r.fixDescription || '-'}<br>
        更换配件：${partsText}<br>
        维修费用：¥${r.cost || 0}
      </div>
      <div style="background:#ecfdf5;padding:12px;border-radius:8px">
        <b>验收信息</b><br>
        验收人：${r.acceptedBy || '-'}<br>
        验收时间：${formatDate(r.acceptedAt)}<br>
        验收意见：${r.acceptRemark || '-'}
      </div>
    </div>
    <div style="margin-top:16px;text-align:center">
      <button class="btn" onclick="this.closest('div[style]').parentElement.parentElement.remove()">关闭</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

// 查看档案中的验收照片
function viewArchivePhoto(id) {
  const archive = getArchive();
  const r = archive.find(a => a.id === id);
  if (!r || !r.acceptPhoto) { showToast('无照片'); return; }
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.8);z-index:10001;display:flex;align-items:center;justify-content:center;cursor:pointer';
  modal.onclick = () => modal.remove();
  modal.innerHTML = `<div style="text-align:center;max-width:90%"><img src="${r.acceptPhoto}" style="max-width:100%;max-height:80vh;border-radius:8px"/><div style="color:#fff;margin-top:10px">点击任意处关闭</div></div>`;
  document.body.appendChild(modal);
}

// 导出历史档案为Excel
function exportArchiveExcel() {
  const list = getArchive();
  if (!list.length) { showToast('暂无历史档案'); return; }

  const rows = [];
  rows.push(["归档时间","工单标题","类型","建筑","楼层","设备类型","设备编号","故障描述","上报人","维修人","维修说明","更换配件","费用(元)","验收人","验收意见","创建时间","完成时间","验收时间"]);
  const typeMap = { repair: '故障维修', maintain: '定期维保', emergency: '紧急抢修' };

  list.forEach(r => {
    const partsText = r.partsUsed && r.partsUsed.length ? r.partsUsed.map(p => p.name + '×' + p.qty).join('、') : '';
    rows.push([
      formatDate(r.archiveTime),
      r.title || '',
      typeMap[r.type] || r.type,
      r.buildingName || '',
      r.floorName || '',
      r.deviceType || '',
      r.deviceCode || '',
      r.description || '',
      r.reporter || '',
      r.assignee || '',
      r.fixDescription || '',
      partsText,
      r.cost || 0,
      r.acceptedBy || '',
      r.acceptRemark || '',
      formatDate(r.createdAt),
      formatDate(r.completedAt),
      formatDate(r.acceptedAt)
    ]);
  });

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "历史档案");
  XLSX.writeFile(wb, "维修历史档案_" + new Date().toISOString().split('T')[0] + ".xlsx");
  showToast("历史档案已导出");
}

// 一键导入历史数据（把之前已验收的工单批量归档到历史档案）
async function importHistoryToArchive() {
  try {
    const orders = await dbGetAll(S_WORKORDER);
    // 只导入已验收的工单
    const acceptedOrders = orders.filter(o => o.status === 'accepted');
    if (!acceptedOrders.length) {
      showToast("没有已验收的工单需要导入");
      return;
    }
    let count = 0;
    for (const order of acceptedOrders) {
      const archive = getArchive();
      // 避免重复归档
      if (!archive.find(a => a.id === order.id)) {
        addToArchive(order);
        count++;
      }
    }
    showToast(`已导入 ${count} 条历史档案`);
    renderArchiveList();
  } catch (e) {
    console.error('导入历史档案失败:', e);
    showToast("导入失败：" + e.message);
  }
}

// 查看验收照片
async function viewAcceptPhoto(id) {
  const orders = await dbGetAll(S_WORKORDER);
  const order = orders.find(o => o.id === id);
  if (!order || !order.acceptPhoto) { showToast("无验收照片"); return; }
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.8);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer';
  modal.onclick = () => modal.remove();
  modal.innerHTML = `<div style="text-align:center;max-width:90%;max-height:90%"><img src="${order.acceptPhoto}" style="max-width:100%;max-height:80vh;border-radius:8px"/><div style="color:#fff;margin-top:10px;font-size:14px">点击任意处关闭</div></div>`;
  document.body.appendChild(modal);
}

// 编辑工单
async function editWorkOrder(id) {
  const orders = await dbGetAll(S_WORKORDER);
  const o = orders.find(x => x.id === id);
  if (!o) return;
  document.getElementById("wo-id").value = o.id;
  document.getElementById("wo-title").value = o.title;
  document.getElementById("wo-type").value = o.type;
  document.getElementById("wo-priority").value = o.priority;
  document.getElementById("wo-assignee").value = o.assignee;
  document.getElementById("wo-desc").value = o.description;
  document.getElementById("wo-device-id").value = o.deviceId || "";
  document.getElementById("wo-building-name").value = o.snapshot_buildingName || "";
  document.getElementById("wo-floor-name").value = o.snapshot_floorName || "";
  document.getElementById("wo-device-type").value = o.snapshot_deviceType || "";
  document.getElementById("wo-device-code").value = o.snapshot_deviceCode || "";
  openModal('modal-edit-workorder');
}

// 打开新建工单弹窗
function openCreateWorkOrderModal() {
  document.getElementById("wo-id").value = "";
  document.getElementById("wo-title").value = "";
  document.getElementById("wo-type").value = "repair";
  document.getElementById("wo-priority").value = "normal";
  document.getElementById("wo-assignee").value = "";
  document.getElementById("wo-desc").value = "";
  document.getElementById("wo-device-id").value = "";
  document.getElementById("wo-building-name").value = "";
  document.getElementById("wo-floor-name").value = "";
  document.getElementById("wo-device-type").value = "";
  document.getElementById("wo-device-code").value = "";
  openModal('modal-edit-workorder');
}

// 从巡检记录自动创建维修工单（闭环：巡检故障 → 生成工单）
async function createWorkOrderFromInspectLog(log, dev) {
  // 检查该设备是否已有未处理的维修工单（避免重复故障重复生成工单）
  if (log.deviceId) {
    const existingOrders = await dbGetAll(S_WORKORDER);
    const pendingOrder = existingOrders.find(o => 
      o.deviceId === log.deviceId && 
      o.status !== "accepted" && 
      o.status !== "closed"
    );
    if (pendingOrder) {
      console.log(`设备 ${log.deviceId} 已有未处理工单 ${pendingOrder.id}，不重复生成`);
      // 关联巡检记录到已有工单
      log.workOrderId = pendingOrder.id;
      await dbPut(S_LOG, log);
      showToast(`该设备已有未处理工单，已关联到现有工单`);
      return pendingOrder; // 返回已有工单，不生成新的
    }
  }
  
  const order = await createWorkOrder({
    title: `【巡检故障】${log.snapshot_deviceType || dev?.deviceType || '设备'} ${log.snapshot_deviceCode || dev?.deviceCode || ''}`,
    type: "repair",
    priority: "urgent",
    deviceId: log.deviceId,
    description: `【巡检发现故障】
巡检人：${log.inspector || '未知'}
巡检时间：${log.inspectDate || ''} ${log.inspectTime || ''}
建筑：${log.snapshot_buildingName || '未知'}
楼层：${log.snapshot_floorName || '未知'}
设备：${log.snapshot_deviceType || ''} ${log.snapshot_deviceCode || ''}`,
    snapshot_buildingName: log.snapshot_buildingName || "",
    snapshot_floorName: log.snapshot_floorName || "",
    snapshot_deviceType: log.snapshot_deviceType || "",
    snapshot_deviceCode: log.snapshot_deviceCode || ""
  });
  // 关联巡检记录和工单
  order.inspectLogId = log.id;
  await dbPut(S_WORKORDER, order);
  log.workOrderId = order.id;
  await dbPut(S_LOG, log);
  return order;
}

// 从巡检记录列表中的历史故障记录创建工单
async function createWorkOrderFromInspectRecord(recordId) {
  // 先从本地记录找
  let record = (await dbGetAll(S_LOG)).find(r => r.id === recordId);
  // 如果本地没有，从 allInspectRecords 找（云端记录）
  if (!record && typeof allInspectRecords !== 'undefined') {
    record = allInspectRecords.find(r => r.id === recordId);
  }
  if (!record) { showToast("记录不存在"); return; }

  const deviceId = record.device_id || record.deviceId;
  
  // 检查该设备是否已有未处理的维修工单（避免重复故障重复生成工单）
  if (deviceId) {
    const existingOrders = await dbGetAll(S_WORKORDER);
    const pendingOrder = existingOrders.find(o => 
      o.deviceId === deviceId && 
      o.status !== "accepted" && 
      o.status !== "closed"
    );
    if (pendingOrder) {
      const orderStatusText = pendingOrder.status === "pending" ? "待派单" : 
                              pendingOrder.status === "processing" ? "维修中" : 
                              pendingOrder.status === "completed" ? "待验收" : pendingOrder.status;
      const confirm = await confirmDialog(
        `该设备已有未处理的维修工单：\n` +
        `工单：${pendingOrder.title || '未命名'}\n` +
        `状态：${orderStatusText}\n\n` +
        `同一设备的重复故障不需要重复生成工单。\n` +
        `点击"确定"查看已有工单，点击"取消"返回。`
      );
      if (confirm) {
        // 打开工单列表
        if (typeof openWorkOrderList === 'function') openWorkOrderList();
      }
      return;
    }
  }

  // 提取位置信息（兼容本地和云端字段名）
  let buildingName = record.snapshot_buildingName || record.snap_building || "";
  let floorName = record.snapshot_floorName || record.snap_floor || "";
  let deviceType = record.snapshot_deviceType || record.snap_devType || "";
  let deviceCode = record.snapshot_deviceCode || record.snap_devCode || "";

  // 如果位置快照为空，从设备表反查
  if ((!buildingName || !floorName || !deviceType) && deviceId) {
    const dev = (await dbGetAll(SD)).find(d => d.id === deviceId);
    if (dev) {
      if (!deviceType) deviceType = dev.deviceType || "";
      if (!deviceCode) deviceCode = dev.deviceCode || "";
      if (!buildingName || !floorName) {
        const floors = await dbGetAll(SF);
        const buildings = await dbGetAll(SB);
        const floor = floors.find(f => f.id === dev.floorId);
        const building = buildings.find(b => b.id === floor?.buildingId);
        if (!buildingName) buildingName = building?.name || "";
        if (!floorName) floorName = floor?.floorName || "";
      }
    }
  }

  const inspector = record.inspector || record.inspector_name || "未知";
  const inspectDate = record.inspectDate || record.inspect_date || "";
  const inspectTime = record.inspectTime || record.inspect_time || "";

  const order = await createWorkOrder({
    title: `【巡检故障】${deviceType || '设备'} ${deviceCode || ''}`,
    type: "repair",
    priority: "urgent",
    deviceId: deviceId,
    description: `【巡检发现故障】
巡检人：${inspector}
巡检时间：${inspectDate} ${inspectTime}
建筑：${buildingName || '未知'}
楼层：${floorName || '未知'}
设备：${deviceType || '未知'} ${deviceCode || ''}`,
    snapshot_buildingName: buildingName,
    snapshot_floorName: floorName,
    snapshot_deviceType: deviceType,
    snapshot_deviceCode: deviceCode
  });
  order.inspectLogId = recordId;
  await dbPut(S_WORKORDER, order);
  // 同步到云端（包含 inspectLogId）
  syncWorkOrderToCloud(order);
  // 如果是本地记录，更新关联
  if (record.deviceId) {
    record.workOrderId = order.id;
    await dbPut(S_LOG, record);
  }
  showToast(`已生成维修工单：${order.title}`);
  if (typeof renderInspectRecords === 'function') renderInspectRecords();
  // 统一刷新所有相关界面（工单列表、工作台、顶部统计等）
  if (typeof refreshAllAfterOrderChange === 'function') {
    try { await refreshAllAfterOrderChange(); } catch(e) {}
  }
}

// 从巡检记录查看关联工单
function viewWorkOrderFromInspect(orderId) {
  closeModal('modal-inspect-records');
  openModal('modal-workorder');
  if (typeof renderWorkOrderList === 'function') renderWorkOrderList();
  setTimeout(() => {
    const orderEl = document.querySelector(`[data-order-id="${orderId}"]`);
    if (orderEl) orderEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 300);
}

// 从设备快速创建工单
async function createWorkOrderFromDevice(deviceId) {
  const devs = await dbGetAll(SD);
  const dev = devs.find(d => d.id === deviceId);
  const floors = await dbGetAll(SF);
  const buildings = await dbGetAll(SB);
  const floor = floors.find(f => f.id === dev?.floorId);
  const building = buildings.find(b => b.id === floor?.buildingId);

  document.getElementById("wo-id").value = "";
  document.getElementById("wo-title").value = (dev?.deviceType || "设备") + "维修";
  document.getElementById("wo-type").value = "repair";
  document.getElementById("wo-priority").value = "normal";
  document.getElementById("wo-assignee").value = "";
  document.getElementById("wo-desc").value = "";
  document.getElementById("wo-device-id").value = deviceId || "";
  document.getElementById("wo-building-name").value = building?.name || "";
  document.getElementById("wo-floor-name").value = floor?.floorName || "";
  document.getElementById("wo-device-type").value = dev?.deviceType || "";
  document.getElementById("wo-device-code").value = dev?.deviceCode || "";
  openModal('modal-edit-workorder');
}

// 提交工单（新建或编辑）
async function submitWorkOrder() {
  const id = document.getElementById("wo-id").value;
  if (id) {
    await updateWorkOrder(id, {
      title: document.getElementById("wo-title").value,
      type: document.getElementById("wo-type").value,
      priority: document.getElementById("wo-priority").value,
      assignee: document.getElementById("wo-assignee").value,
      description: document.getElementById("wo-desc").value
    });
  } else {
    await createWorkOrder({
      title: document.getElementById("wo-title").value,
      type: document.getElementById("wo-type").value,
      priority: document.getElementById("wo-priority").value,
      assignee: document.getElementById("wo-assignee").value,
      description: document.getElementById("wo-desc").value,
      deviceId: document.getElementById("wo-device-id").value || null,
      snapshot_buildingName: document.getElementById("wo-building-name").value,
      snapshot_floorName: document.getElementById("wo-floor-name").value,
      snapshot_deviceType: document.getElementById("wo-device-type").value,
      snapshot_deviceCode: document.getElementById("wo-device-code").value
    });
  }
  closeModal('modal-edit-workorder');
  openModal('modal-workorder');
  if (typeof renderWorkOrderList === 'function') await renderWorkOrderList();
  // 统一刷新所有相关界面
  if (typeof refreshAllAfterOrderChange === 'function') {
    try { await refreshAllAfterOrderChange(); } catch(e) {}
  }
  showToast(id ? "工单已更新" : "工单已创建");
}

// 打开工单管理
function openWorkOrderManager() {
  renderWorkOrderList();
  openModal('modal-workorder');
}

/* ============================================================
 * 检测报告自动生成
 * ============================================================ */

// 生成检测报告
async function generateInspectionReport(period) {
  // period: monthly/quarterly/yearly
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarter = Math.floor(month / 3);

  let startDate, endDate, title;
  if (period === "monthly") {
    startDate = new Date(year, month, 1).toISOString().split('T')[0];
    endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];
    title = `${year}年${month + 1}月消防设施检测报告`;
  } else if (period === "quarterly") {
    startDate = new Date(year, quarter * 3, 1).toISOString().split('T')[0];
    endDate = new Date(year, quarter * 3 + 3, 0).toISOString().split('T')[0];
    title = `${year}年第${quarter + 1}季度消防设施检测报告`;
  } else {
    startDate = new Date(year, 0, 1).toISOString().split('T')[0];
    endDate = new Date(year, 11, 31).toISOString().split('T')[0];
    title = `${year}年度消防设施检测报告`;
  }

  // 收集数据
  const devices = await dbGetAll(SD);
  const logs = await dbGetAll(S_LOG);
  const allPlans = await dbGetAll(S_PLAN);
  const tasks = allPlans.filter(p => p.type === "daily" && !p.parentId);
  const dangers = await dbGetAll(S_HIDDEN);
  const workOrders = await dbGetAll(S_WORKORDER);
  const maintainLogs = await dbGetAll(SL);

  // 统计
  const totalDevices = devices.length;
  const normalDevices = devices.filter(d => d.status === "正常").length;
  const faultDevices = devices.filter(d => d.status === "故障").length;
  const maintainDevices = devices.filter(d => d.status === "待维保").length;
  const deviceRate = totalDevices > 0 ? ((normalDevices / totalDevices) * 100).toFixed(1) : 0;

  const periodLogs = logs.filter(l => l.inspectDate >= startDate && l.inspectDate <= endDate);
  const periodTasks = tasks.filter(t => (t.date || t.planDate) >= startDate && (t.date || t.planDate) <= endDate);
  const completedTasks = periodTasks.filter(t => t.status === "completed").length;
  const taskRate = periodTasks.length > 0 ? ((completedTasks / periodTasks.length) * 100).toFixed(1) : 0;

  const periodDangers = dangers.filter(d => d.createdAt >= startDate && d.createdAt <= endDate);
  const acceptedDangers = periodDangers.filter(d => d.status === "accepted").length;
  const dangerRate = periodDangers.length > 0 ? ((acceptedDangers / periodDangers.length) * 100).toFixed(1) : 0;

  const periodOrders = workOrders.filter(o => o.createdAt >= startDate && o.createdAt <= endDate);
  const totalCost = periodOrders.reduce((sum, o) => sum + (o.cost || 0), 0);

  const periodMaintain = maintainLogs.filter(l => l.date >= startDate && l.date <= endDate);

  // 维保到期统计
  const dueResult = await getMaintainDueDevices(30);

  // 生成报告HTML
  const reportHtml = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; padding: 40px; color: #333; }
  .report-title { text-align: center; font-size: 24px; font-weight: bold; margin-bottom: 10px; }
  .report-subtitle { text-align: center; font-size: 14px; color: #666; margin-bottom: 30px; }
  .section { margin-bottom: 25px; }
  .section-title { font-size: 16px; font-weight: bold; border-left: 4px solid #2563eb; padding-left: 10px; margin-bottom: 12px; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
  .stat-card { background: #f8fafc; padding: 15px; border-radius: 8px; text-align: center; }
  .stat-num { font-size: 28px; font-weight: bold; color: #2563eb; }
  .stat-label { font-size: 12px; color: #666; margin-top: 5px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
  th { background: #f5f5f5; font-weight: bold; }
  .rate-bar { background: #e5e7eb; height: 8px; border-radius: 4px; overflow: hidden; }
  .rate-fill { height: 100%; background: #10b981; }
  .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #999; }
  .sign-row { display: flex; justify-content: space-between; margin-top: 50px; }
  .sign-box { width: 200px; text-align: center; }
  .sign-line { border-bottom: 1px solid #333; height: 40px; }
  @media print { body { padding: 20px; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="no-print" style="text-align:right;margin-bottom:20px">
    <button onclick="window.print()" style="padding:8px 20px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer">🖨️ 打印报告</button>
  </div>
  <div class="report-title">${title}</div>
  <div class="report-subtitle">报告周期：${startDate} 至 ${endDate} | 生成时间：${new Date().toLocaleString('zh-CN')}</div>

  <div class="section">
    <div class="section-title">一、设施总体情况</div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-num">${totalDevices}</div><div class="stat-label">设施总数</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#10b981">${normalDevices}</div><div class="stat-label">正常运行</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#ef4444">${faultDevices}</div><div class="stat-label">故障设备</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${maintainDevices}</div><div class="stat-label">待维保</div></div>
    </div>
    <p><strong>设备完好率：</strong>${deviceRate}%</p>
    <div class="rate-bar"><div class="rate-fill" style="width:${deviceRate}%"></div></div>
  </div>

  <div class="section">
    <div class="section-title">二、巡检执行情况</div>
    <table>
      <tr><th>指标</th><th>数值</th></tr>
      <tr><td>计划巡检任务数</td><td>${periodTasks.length}</td></tr>
      <tr><td>已完成任务数</td><td>${completedTasks}</td></tr>
      <tr><td>任务完成率</td><td>${taskRate}%</td></tr>
      <tr><td>巡检打卡记录数</td><td>${periodLogs.length}</td></tr>
      <tr><td>维保记录数</td><td>${periodMaintain.length}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">三、隐患整改情况</div>
    <table>
      <tr><th>指标</th><th>数值</th></tr>
      <tr><td>新增隐患数</td><td>${periodDangers.length}</td></tr>
      <tr><td>已验收整改数</td><td>${acceptedDangers}</td></tr>
      <tr><td>整改完成率</td><td>${dangerRate}%</td></tr>
      <tr><td>待整改/整改中</td><td>${periodDangers.length - acceptedDangers}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">四、维保工单情况</div>
    <table>
      <tr><th>指标</th><th>数值</th></tr>
      <tr><td>新增工单数</td><td>${periodOrders.length}</td></tr>
      <tr><td>已验收工单</td><td>${periodOrders.filter(o => o.status === 'accepted').length}</td></tr>
      <tr><td>维修总费用</td><td>¥${totalCost.toFixed(2)}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">五、维保到期预警（未来30天）</div>
    <p>已逾期：${dueResult.overdue.length} 台 | 即将到期：${dueResult.dueSoon.length} 台</p>
    ${dueResult.overdue.length > 0 ? '<p style="color:#ef4444"><strong>⚠️ 已逾期设备：</strong>' + dueResult.overdue.map(d => d.deviceType + (d.deviceCode ? '(' + d.deviceCode + ')' : '')).join('、') + '</p>' : ''}
    ${dueResult.dueSoon.length > 0 ? '<p style="color:#f59e0b"><strong>⏰ 即将到期：</strong>' + dueResult.dueSoon.map(d => d.deviceType + (d.deviceCode ? '(' + d.deviceCode + ')' : '')).join('、') + '</p>' : ''}
  </div>

  <div class="section">
    <div class="section-title">六、结论与建议</div>
    <ol>
      <li>本周期内设备完好率为 ${deviceRate}%，${deviceRate >= 95 ? '运行状况良好' : '需加强维护'}。</li>
      <li>巡检任务完成率 ${taskRate}%，${taskRate >= 90 ? '巡检执行到位' : '存在漏检情况，需加强管理'}。</li>
      <li>隐患整改完成率 ${dangerRate}%，${dangerRate >= 90 ? '整改及时' : '存在超期未整改隐患，需重点关注'}。</li>
      ${dueResult.overdue.length > 0 ? '<li style="color:#ef4444">有 ' + dueResult.overdue.length + ' 台设备维保已逾期，请立即安排维保。</li>' : ''}
      <li>建议下一周期继续加强日常巡检，及时处理故障设备，确保消防设施完好有效。</li>
    </ol>
  </div>

  <div class="sign-row">
    <div class="sign-box"><div class="sign-line"></div><div>检测人签字</div></div>
    <div class="sign-box"><div class="sign-line"></div><div>审核人签字</div></div>
    <div class="sign-box"><div class="sign-line"></div><div>日期</div></div>
  </div>

  <div class="footer">本报告由消防设施数字化管理系统自动生成</div>
</body>
</html>`;

  // 在新窗口打开报告
  const win = window.open('', '_blank');
  win.document.write(reportHtml);
  win.document.close();
}

// 打开报告生成弹窗
function openReportGenerator() {
  openModal('modal-report');
}

/* ============================================================
 * 人员管理模块
 * 支持：巡检员、维修员、验收员，可多选角色
 * ============================================================ */

const STAFF_KEY = "firemap_staff";

// 获取所有人员
function getStaff() {
  try {
    return JSON.parse(localStorage.getItem(STAFF_KEY) || "[]");
  } catch(e) { return []; }
}

// 保存人员列表
function saveStaffList(list) {
  localStorage.setItem(STAFF_KEY, JSON.stringify(list));
}

// 打开人员管理
function openStaffManager() {
  renderStaffList();
  openModal('modal-staff');
}

// 渲染人员列表
function renderStaffList() {
  const staff = getStaff();
  const box = document.getElementById('staff-list');
  if (!box) return;

  // 统计各角色人数
  const inspectorCount = staff.filter(s => s.roles && s.roles.includes('inspector')).length;
  const repairerCount = staff.filter(s => s.roles && s.roles.includes('repairer')).length;
  const acceptorCount = staff.filter(s => s.roles && s.roles.includes('acceptor')).length;

  const el1 = document.getElementById('staff-count-inspector');
  const el2 = document.getElementById('staff-count-repairer');
  const el3 = document.getElementById('staff-count-acceptor');
  if (el1) el1.innerText = inspectorCount;
  if (el2) el2.innerText = repairerCount;
  if (el3) el3.innerText = acceptorCount;

  if (!staff.length) {
    box.innerHTML = '<div style="text-align:center;color:#999;padding:40px 20px"><div style="font-size:48px;margin-bottom:12px">👥</div><div>暂无人员，点击右上角「添加人员」开始添加</div></div>';
    return;
  }

  let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">';
  staff.forEach(s => {
    const roles = s.roles || [];
    const roleTags = roles.map(r => {
      if (r === 'inspector') return '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;background:#dbeafe;color:#1e40af;margin-right:4px">👷 巡检员</span>';
      if (r === 'repairer') return '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;background:#ffedd5;color:#9a3412;margin-right:4px">🔧 维修员</span>';
      if (r === 'acceptor') return '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;background:#dcfce7;color:#166534;margin-right:4px">✅ 验收员</span>';
      return '';
    }).join('');

    const avatar = s.name ? s.name.charAt(0).toUpperCase() : '?';
    const avatarColors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899'];
    const colorIndex = s.name ? s.name.charCodeAt(0) % avatarColors.length : 0;
    const avatarColor = avatarColors[colorIndex];

    html += '<div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;background:#fff;transition:all .2s">';
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">';
    html += '<div style="width:48px;height:48px;border-radius:50%;background:' + avatarColor + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:bold;flex-shrink:0">' + avatar + '</div>';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-size:16px;font-weight:bold;color:#111827">' + (s.name || '未命名') + '</div>';
    html += '<div style="font-size:12px;color:#6b7280;margin-top:2px">工号：' + (s.workId || '未设置') + (s.phone ? ' | ' + s.phone : '') + '</div>';
    html += '</div></div>';
    html += '<div style="margin-bottom:12px;line-height:1.8">' + (roleTags || '<span style="font-size:12px;color:#9ca3af">未分配岗位</span>') + '</div>';
    if (s.remark) html += '<div style="font-size:12px;color:#6b7280;background:#f9fafb;padding:8px 10px;border-radius:6px;margin-bottom:12px;line-height:1.5">📝 ' + s.remark + '</div>';
    html += '<div style="display:flex;gap:8px;border-top:1px solid #f3f4f6;padding-top:12px">';
    html += '<button class="btn small ghost" onclick="editStaff(\'' + s.id + '\')" style="flex:1">✏️ 编辑</button>';
    html += '<button class="btn small del" onclick="deleteStaff(\'' + s.id + '\')" style="flex:1">🗑️ 删除</button>';
    html += '</div></div>';
  });
  html += '</div>';
  box.innerHTML = html;
}

// 打开添加/编辑人员弹窗
function openStaffEditModal(staffId) {
  document.getElementById('staff-edit-id').value = staffId || '';
  document.getElementById('staff-edit-title').innerText = staffId ? '编辑人员' : '添加人员';
  document.getElementById('staff-name').value = '';
  document.getElementById('staff-work-id').value = '';
  document.getElementById('staff-password').value = '';
  document.getElementById('staff-phone').value = '';
  document.getElementById('staff-remark').value = '';
  document.getElementById('staff-role-inspector').checked = false;
  document.getElementById('staff-role-repairer').checked = false;
  document.getElementById('staff-role-acceptor').checked = false;
  updateStaffRoleHighlight();

  if (staffId) {
    const staff = getStaff();
    const s = staff.find(x => x.id === staffId);
    if (s) {
      document.getElementById('staff-name').value = s.name || '';
      document.getElementById('staff-work-id').value = s.workId || '';
      document.getElementById('staff-password').value = s.password || '';
      document.getElementById('staff-phone').value = s.phone || '';
      document.getElementById('staff-remark').value = s.remark || '';
      if (s.roles && s.roles.includes('inspector')) document.getElementById('staff-role-inspector').checked = true;
      if (s.roles && s.roles.includes('repairer')) document.getElementById('staff-role-repairer').checked = true;
      if (s.roles && s.roles.includes('acceptor')) document.getElementById('staff-role-acceptor').checked = true;
      updateStaffRoleHighlight();
    }
  }
  openModal('modal-staff-edit');
}

// 编辑人员（别名，用于列表按钮）
function editStaff(id) {
  openStaffEditModal(id);
}

// 更新角色选择框高亮
function updateStaffRoleHighlight() {
  const roles = ['inspector', 'repairer', 'acceptor'];
  const colors = { inspector: '#2563eb', repairer: '#ea580c', acceptor: '#16a34a' };
  roles.forEach(r => {
    const checkbox = document.getElementById('staff-role-' + r);
    const label = document.getElementById('staff-role-' + r + '-label');
    if (checkbox && label) {
      if (checkbox.checked) {
        label.style.borderColor = colors[r];
        label.style.background = colors[r] + '08';
      } else {
        label.style.borderColor = '#e5e7eb';
        label.style.background = 'transparent';
      }
    }
  });
}

// 保存人员
async function saveStaff() {
  const id = document.getElementById('staff-edit-id').value;
  const name = document.getElementById('staff-name').value.trim();
  const workId = document.getElementById('staff-work-id').value.trim();
  const password = document.getElementById('staff-password').value;
  const phone = document.getElementById('staff-phone').value.trim();
  const remark = document.getElementById('staff-remark').value.trim();
  const roles = [];
  if (document.getElementById('staff-role-inspector').checked) roles.push('inspector');
  if (document.getElementById('staff-role-repairer').checked) roles.push('repairer');
  if (document.getElementById('staff-role-acceptor').checked) roles.push('acceptor');

  if (!name) { showToast('请输入姓名'); return; }
  if (!workId) { showToast('请输入工号'); return; }
  if (!password) { showToast('请输入密码'); return; }
  if (roles.length === 0) { showToast('请至少选择一个岗位'); return; }

  // 检查工号是否重复
  const staff = getStaff();
  const duplicate = staff.find(s => s.workId === workId && s.id !== id);
  if (duplicate) { showToast('工号已存在，请更换'); return; }

  // 编码密码（与扫码页面一致）
  const encodedPwd = btoa(unescape(encodeURIComponent(password)));

  if (id) {
    const idx = staff.findIndex(s => s.id === id);
    if (idx >= 0) {
      staff[idx] = Object.assign({}, staff[idx], { name, workId, password: encodedPwd, phone, remark, roles, updatedAt: new Date().toISOString() });
    }
  } else {
    staff.push({
      id: 'staff_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name, workId, password: encodedPwd, phone, remark, roles,
      createdAt: new Date().toISOString()
    });
  }
  saveStaffList(staff);

  // 同步到云端 inspectors 表（等待同步完成）
  const syncResult = await syncStaffToCloud({ id, name, workId, password: encodedPwd, phone, roles, remark });

  closeModal('modal-staff-edit');
  renderStaffList();
  if (syncResult) {
    showToast(id ? '人员信息已更新并同步云端' : '人员添加成功并同步云端');
  } else {
    showToast(id ? '人员信息已更新（云端同步失败）' : '人员添加成功（云端同步失败）');
  }
}

// 同步人员到云端
async function syncStaffToCloud(staffData) {
  try {
    if (typeof Cloud === 'undefined' || !Cloud.enabled || !Cloud.supabase) {
      console.warn('云端未启用，跳过人员同步');
      return false;
    }
    // 把JS数组转成PostgreSQL数组字符串格式 {inspector,repairer}
    const rolesStr = '{' + (staffData.roles || []).join(',') + '}';
    const record = {
      id: staffData.workId,
      name: staffData.name,
      password: staffData.password,
      roles: rolesStr
    };

    // 先查询是否存在
    const { data: existing, error: queryError } = await Cloud.supabase
      .from('inspectors')
      .select('id')
      .eq('id', staffData.workId);

    if (queryError) {
      console.error('查询云端人员失败:', queryError);
      showToast('云端同步失败: ' + (queryError.message || '查询错误'));
      return false;
    }

    if (existing && existing.length > 0) {
      // 存在则更新
      const { error } = await Cloud.supabase
        .from('inspectors')
        .update(record)
        .eq('id', staffData.workId);
      if (error) {
        console.error('更新云端人员失败:', error);
        showToast('云端同步失败: ' + (error.message || '更新错误'));
        return false;
      }
    } else {
      // 不存在则插入
      const { error } = await Cloud.supabase
        .from('inspectors')
        .insert(record);
      if (error) {
        console.error('插入云端人员失败:', error);
        showToast('云端同步失败: ' + (error.message || '插入错误'));
        return false;
      }
    }

    console.log('人员同步云端成功:', staffData.workId);
    return true;
  } catch (e) {
    console.error('同步人员到云端异常:', e);
    showToast('云端同步异常: ' + e.message);
    return false;
  }
}

// 删除人员
async function deleteStaff(id) {
  const staff = getStaff();
  const s = staff.find(x => x.id === id);
  if (!s) return;
  if (!await confirmDialog('确认删除人员「' + s.name + '」？删除后不可恢复。')) return;
  const newStaff = staff.filter(x => x.id !== id);
  saveStaffList(newStaff);

  // 同步删除云端数据
  try {
    if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase && s.workId) {
      await Cloud.supabase.from('inspectors').delete().eq('id', s.workId);
    }
  } catch (e) {
    console.error('删除云端人员失败:', e);
  }

  renderStaffList();
  showToast('人员已删除');
}

// 一键同步所有本地人员到云端
async function syncAllStaffToCloud() {
  const staff = getStaff();
  if (!staff.length) {
    showToast('暂无人员需要同步');
    return;
  }

  if (typeof Cloud === 'undefined' || !Cloud.enabled || !Cloud.supabase) {
    showToast('云端未启用，无法同步');
    return;
  }

  if (!await confirmDialog('确认将本地 ' + staff.length + ' 个人员同步到云端？\n（云端已有相同工号的会被更新）')) return;

  showToast('正在同步到云端...');
  let success = 0, fail = 0;

  for (const s of staff) {
    if (!s.workId || !s.password) {
      fail++;
      continue;
    }
    try {
      // 把JS数组转成PostgreSQL数组字符串格式 {inspector,repairer}
      const rolesStr = '{' + (s.roles || []).join(',') + '}';
      const record = {
        id: s.workId,
        name: s.name || '',
        password: s.password,
        roles: rolesStr
      };

      // 先查询是否存在
      const { data: existing, error: queryError } = await Cloud.supabase
        .from('inspectors')
        .select('id')
        .eq('id', s.workId);

      if (queryError) {
        console.error('查询失败:', s.workId, queryError);
        fail++;
        continue;
      }

      let error;
      if (existing && existing.length > 0) {
        // 存在则更新
        const result = await Cloud.supabase
          .from('inspectors')
          .update(record)
          .eq('id', s.workId);
        error = result.error;
      } else {
        // 不存在则插入
        const result = await Cloud.supabase
          .from('inspectors')
          .insert(record);
        error = result.error;
      }

      if (error) {
        console.error('同步失败:', s.workId, error);
        fail++;
      } else {
        success++;
      }
    } catch (e) {
      console.error('同步异常:', s.workId, e);
      fail++;
    }
  }

  showToast('同步完成：成功 ' + success + ' 个，失败 ' + fail + ' 个');
  if (fail > 0) {
    alert('同步完成！\n成功：' + success + ' 个\n失败：' + fail + ' 个\n\n失败原因可能是：工号或密码为空、云端权限不足、网络问题。\n请按F12打开控制台查看详细错误。');
  }
}

// 绑定角色选择框点击事件
document.addEventListener('DOMContentLoaded', function() {
  ['inspector', 'repairer', 'acceptor'].forEach(function(r) {
    const cb = document.getElementById('staff-role-' + r);
    if (cb) cb.addEventListener('change', updateStaffRoleHighlight);
  });
});

/* ============================================================
 * 微信通知模块
 * 支持：企业微信机器人、Server酱（方糖）
 * ============================================================ */

// 通知配置
function getNotifyConfig() {
  try {
    return JSON.parse(localStorage.getItem("firemap_notify_config") || "{}");
  } catch(e) { return {}; }
}

function saveNotifyConfig(config) {
  localStorage.setItem("firemap_notify_config", JSON.stringify(config));
}

// 发送微信通知
async function sendWechatNotify(title, content) {
  const config = getNotifyConfig();
  if (!config.enabled) return false;

  try {
    // 企业微信机器人
    if (config.provider === "wecom" && config.wecomWebhook) {
      const res = await fetch(config.wecomWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: { content: `【${title}】\n${content}` }
        })
      });
      const data = await res.json();
      if (data.errcode === 0) return true;
      console.error("企业微信推送失败:", data);
      return false;
    }

    // Server酱（方糖）
    if (config.provider === "serverchan" && config.serverchanKey) {
      const url = `https://sctapi.ftqq.com/${config.serverchanKey}.send`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `title=${encodeURIComponent(title)}&desp=${encodeURIComponent(content)}`
      });
      const data = await res.json();
      if (data.code === 0) return true;
      console.error("Server酱推送失败:", data);
      return false;
    }

    return false;
  } catch(e) {
    console.error("微信通知异常:", e);
    return false;
  }
}

// 测试通知
async function testWechatNotify() {
  const result = await sendWechatNotify("测试通知", "这是一条测试消息，如果收到说明配置成功！");
  if (result) {
    showToast("测试通知发送成功，请查看微信");
  } else {
    showToast("发送失败，请检查配置");
  }
}

// 打开通知设置
function openNotifySettings() {
  const config = getNotifyConfig();
  document.getElementById("notify-enabled").checked = config.enabled || false;
  document.getElementById("notify-provider").value = config.provider || "wecom";
  document.getElementById("notify-wecom-webhook").value = config.wecomWebhook || "";
  document.getElementById("notify-serverchan-key").value = config.serverchanKey || "";
  updateNotifyProviderUI();
  openModal('modal-notify-settings');
}

// 切换推送方式时更新UI
function updateNotifyProviderUI() {
  const provider = document.getElementById("notify-provider").value;
  document.getElementById("wecom-section").style.display = provider === "wecom" ? "block" : "none";
  document.getElementById("serverchan-section").style.display = provider === "serverchan" ? "block" : "none";
}

// 保存通知设置
function saveNotifySettings() {
  const config = {
    enabled: document.getElementById("notify-enabled").checked,
    provider: document.getElementById("notify-provider").value,
    wecomWebhook: document.getElementById("notify-wecom-webhook").value.trim(),
    serverchanKey: document.getElementById("notify-serverchan-key").value.trim()
  };
  saveNotifyConfig(config);
  closeModal('modal-notify-settings');
  showToast("通知设置已保存");
}

// 维保到期自动通知（每天检查一次）
async function checkAndNotifyDueMaintain() {
  const config = getNotifyConfig();
  if (!config.enabled) return;

  // 每天只检查一次
  const lastCheck = localStorage.getItem("firemap_last_due_notify");
  const today = new Date().toISOString().split('T')[0];
  if (lastCheck === today) return;

  const due = await getMaintainDueDevices(7); // 未来7天到期
  if (due.overdue.length > 0 || due.dueSoon.length > 0) {
    let msg = "";
    if (due.overdue.length > 0) {
      msg += `⚠️ 已逾期 ${due.overdue.length} 台：\n`;
      due.overdue.slice(0, 5).forEach(d => {
        msg += `  - ${d.deviceType}${d.deviceCode ? '(' + d.deviceCode + ')' : ''} 逾期${d.daysOverdue}天\n`;
      });
      if (due.overdue.length > 5) msg += `  ...等共${due.overdue.length}台\n`;
    }
    if (due.dueSoon.length > 0) {
      msg += `⏰ 7天内到期 ${due.dueSoon.length} 台：\n`;
      due.dueSoon.slice(0, 5).forEach(d => {
        msg += `  - ${d.deviceType}${d.deviceCode ? '(' + d.deviceCode + ')' : ''} 还剩${d.daysLeft}天\n`;
      });
      if (due.dueSoon.length > 5) msg += `  ...等共${due.dueSoon.length}台\n`;
    }
    if (msg) {
      await sendWechatNotify("维保到期提醒", msg);
    }
  }
  localStorage.setItem("firemap_last_due_notify", today);
}

/* ============================================================
 * 数据大屏
 * ============================================================ */

// 打开数据大屏
async function openDataScreen() {
  try {
  // 先同步设备状态（根据巡检记录更新故障/待维保状态）
  await syncDeviceStatusFromInspectRecords();
  const stats = await getMaintainStats();
  const buildings = await dbGetAll(SB);
  const floors = await dbGetAll(SF);
  const devices = await dbGetAll(SD);
  const dangers = await dbGetAll(S_HIDDEN);
  const workOrders = await dbGetAll(S_WORKORDER);
  // 直接用已加载的 devices 计算维保到期，避免重复查询数据库
  const dueToday = new Date();
  const dueDate = new Date(dueToday.getTime() + 30 * 24 * 3600 * 1000);
  const fmt = d => d.toISOString().split('T')[0];
  const todayStr = fmt(dueToday), dueStr = fmt(dueDate);
  const due = { overdue: [], dueSoon: [], normal: [] };
  devices.forEach(d => {
    if (!d.nextMaintain) { due.normal.push(d); return; }
    if (d.nextMaintain < todayStr) {
      due.overdue.push({ ...d, daysOverdue: Math.floor((dueToday - new Date(d.nextMaintain)) / 86400000) });
    } else if (d.nextMaintain <= dueStr) {
      due.dueSoon.push({ ...d, daysLeft: Math.floor((new Date(d.nextMaintain) - dueToday) / 86400000) });
    } else {
      due.normal.push(d);
    }
  });
  const today = new Date().toISOString().split('T')[0];
  const todayLogs = (await dbGetAll(S_LOG)).filter(l => l.inspectDate === today);

  // 各建筑设备统计
  const buildingStats = buildings.map(b => {
    const bFloors = floors.filter(f => f.buildingId === b.id);
    const bDevices = devices.filter(d => bFloors.some(f => f.id === d.floorId));
    return {
      name: b.name,
      total: bDevices.length,
      normal: bDevices.filter(d => d.status === "正常").length,
      fault: bDevices.filter(d => d.status === "故障").length,
      maintain: bDevices.filter(d => d.status === "待维保").length
    };
  });

  const pendingDangers = dangers.filter(d => d.status !== "accepted").length;
  const pendingOrders = workOrders.filter(o => o.status !== "accepted").length;

  const screenHtml = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>消防设施数据大屏</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: linear-gradient(135deg, #0a1628 0%, #1a2a4a 50%, #0a1628 100%);
    color: #fff;
    font-family: "Microsoft YaHei", sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }
  .screen-header {
    text-align: center;
    padding: 20px;
    background: linear-gradient(90deg, transparent, rgba(37,99,235,0.3), transparent);
    border-bottom: 2px solid #2563eb;
  }
  .screen-title {
    font-size: 32px;
    font-weight: bold;
    background: linear-gradient(90deg, #60a5fa, #fff, #60a5fa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    letter-spacing: 4px;
  }
  .screen-time {
    font-size: 14px;
    color: #93c5fd;
    margin-top: 8px;
  }
  .screen-body {
    display: grid;
    grid-template-columns: 1fr 1.5fr 1fr;
    gap: 15px;
    padding: 15px;
  }
  .panel {
    background: rgba(30, 58, 138, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 8px;
    padding: 15px;
    backdrop-filter: blur(10px);
  }
  .panel-title {
    font-size: 16px;
    font-weight: bold;
    color: #60a5fa;
    margin-bottom: 12px;
    padding-left: 10px;
    border-left: 3px solid #2563eb;
  }
  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .stat-item {
    text-align: center;
    padding: 15px;
    background: rgba(59, 130, 246, 0.1);
    border-radius: 6px;
  }
  .stat-num {
    font-size: 28px;
    font-weight: bold;
  }
  .stat-label {
    font-size: 12px;
    color: #93c5fd;
    margin-top: 5px;
  }
  .num-blue { color: #60a5fa; }
  .num-green { color: #34d399; }
  .num-red { color: #f87171; }
  .num-yellow { color: #fbbf24; }
  .num-orange { color: #fb923c; }
  .progress-bar {
    background: rgba(255,255,255,0.1);
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    margin-top: 5px;
  }
  .progress-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.5s;
  }
  .building-row {
    display: flex;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid rgba(59,130,246,0.2);
    font-size: 13px;
  }
  .building-name {
    width: 80px;
    color: #93c5fd;
  }
  .building-bar {
    flex: 1;
    height: 16px;
    background: rgba(255,255,255,0.1);
    border-radius: 3px;
    overflow: hidden;
    margin: 0 10px;
    display: flex;
  }
  .building-seg { height: 100%; }
  .building-count {
    width: 40px;
    text-align: right;
    color: #fff;
  }
  .alert-list {
    max-height: 200px;
    overflow-y: auto;
  }
  .alert-item {
    padding: 8px;
    margin-bottom: 6px;
    background: rgba(239, 68, 68, 0.1);
    border-left: 3px solid #ef4444;
    border-radius: 4px;
    font-size: 12px;
  }
  .alert-item.warn {
    background: rgba(245, 158, 11, 0.1);
    border-left-color: #f59e0b;
  }
  .center-panel {
    text-align: center;
  }
  .big-stat {
    font-size: 64px;
    font-weight: bold;
    background: linear-gradient(180deg, #60a5fa, #2563eb);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .big-label {
    font-size: 16px;
    color: #93c5fd;
    margin-top: 5px;
  }
  .rate-circle {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    border: 8px solid rgba(59,130,246,0.2);
    border-top-color: #34d399;
    border-right-color: #34d399;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 10px auto;
    font-size: 24px;
    font-weight: bold;
    color: #34d399;
  }
  .close-btn {
    position: fixed;
    top: 15px;
    right: 15px;
    background: rgba(239,68,68,0.8);
    color: #fff;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    z-index: 100;
  }
  .close-btn:hover { background: #ef4444; }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .pulse { animation: pulse 2s infinite; }
</style>
</head>
<body>
  <button class="close-btn" onclick="window.close()">✕ 关闭大屏</button>
  <div class="screen-header">
    <div class="screen-title">🔥 消防设施数字化管理大屏</div>
    <div class="screen-time" id="screen-time"></div>
  </div>
  <div class="screen-body">
    <!-- 左侧 -->
    <div>
      <div class="panel">
        <div class="panel-title">📊 设施总览</div>
        <div class="stat-grid">
          <div class="stat-item"><div class="stat-num num-blue">${stats.totalDevices}</div><div class="stat-label">设施总数</div></div>
          <div class="stat-item"><div class="stat-num num-green">${stats.normalDevices}</div><div class="stat-label">正常运行</div></div>
          <div class="stat-item"><div class="stat-num num-red">${stats.faultDevices}</div><div class="stat-label">故障设备</div></div>
          <div class="stat-item"><div class="stat-num num-yellow">${stats.maintainDevices}</div><div class="stat-label">待维保</div></div>
        </div>
        <div style="margin-top:15px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">
            <span>设备完好率</span>
            <span class="num-green">${stats.totalDevices > 0 ? ((stats.normalDevices/stats.totalDevices)*100).toFixed(1) : 0}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${stats.totalDevices > 0 ? (stats.normalDevices/stats.totalDevices)*100 : 0}%;background:#34d399"></div></div>
        </div>
      </div>
      <div class="panel" style="margin-top:15px">
        <div class="panel-title">🏢 各建筑分布</div>
        ${buildingStats.map(b => `
          <div class="building-row">
            <span class="building-name">${b.name}</span>
            <div class="building-bar">
              <div class="building-seg" style="width:${b.total > 0 ? (b.normal/b.total)*100 : 0}%;background:#34d399"></div>
              <div class="building-seg" style="width:${b.total > 0 ? (b.fault/b.total)*100 : 0}%;background:#f87171"></div>
              <div class="building-seg" style="width:${b.total > 0 ? (b.maintain/b.total)*100 : 0}%;background:#fbbf24"></div>
            </div>
            <span class="building-count">${b.total}</span>
          </div>
        `).join('')}
      </div>
    </div>
    <!-- 中间 -->
    <div class="center-panel">
      <div class="panel">
        <div class="panel-title">📈 今日概况</div>
        <div style="display:flex;justify-content:space-around;margin:20px 0">
          <div>
            <div class="big-stat">${stats.todayInspectLogs}</div>
            <div class="big-label">今日巡检</div>
          </div>
          <div>
            <div class="big-stat num-green">${stats.completedTasks}</div>
            <div class="big-label">已完成任务</div>
          </div>
          <div>
            <div class="big-stat num-yellow">${stats.pendingTasks + stats.inProgressTasks}</div>
            <div class="big-label">待办任务</div>
          </div>
        </div>
      </div>
      <div class="panel" style="margin-top:15px">
        <div class="panel-title">✅ 巡检完成率</div>
        <div class="rate-circle">${stats.pendingTasks + stats.completedTasks + stats.inProgressTasks > 0 ? ((stats.completedTasks/(stats.pendingTasks+stats.completedTasks+stats.inProgressTasks))*100).toFixed(0) : 100}%</div>
        <div style="font-size:13px;color:#93c5fd">总任务 ${stats.pendingTasks + stats.completedTasks + stats.inProgressTasks} 个，已完成 ${stats.completedTasks} 个</div>
      </div>
      <div class="panel" style="margin-top:15px">
        <div class="panel-title">🔧 维保工单</div>
        <div class="stat-grid">
          <div class="stat-item"><div class="stat-num num-blue">${workOrders.length}</div><div class="stat-label">总工单</div></div>
          <div class="stat-item"><div class="stat-num num-yellow">${pendingOrders}</div><div class="stat-label">进行中</div></div>
        </div>
      </div>
    </div>
    <!-- 右侧 -->
    <div>
      <div class="panel">
        <div class="panel-title">⚠️ 预警信息</div>
        <div class="alert-list">
          ${due.overdue.length > 0 ? due.overdue.slice(0,3).map(d => `<div class="alert-item pulse">🔴 ${d.deviceType}${d.deviceCode ? '('+d.deviceCode+')' : ''} 维保已逾期${d.daysOverdue}天</div>`).join('') : ''}
          ${due.dueSoon.length > 0 ? due.dueSoon.slice(0,3).map(d => `<div class="alert-item warn">🟡 ${d.deviceType}${d.deviceCode ? '('+d.deviceCode+')' : ''} ${d.daysLeft}天后到期</div>`).join('') : ''}
          ${due.overdue.length === 0 && due.dueSoon.length === 0 ? '<div style="text-align:center;color:#34d399;padding:20px">✅ 暂无维保预警</div>' : ''}
        </div>
      </div>
      <div class="panel" style="margin-top:15px">
        <div class="panel-title">🚨 隐患整改</div>
        <div class="stat-grid">
          <div class="stat-item"><div class="stat-num num-red">${dangers.length}</div><div class="stat-label">总隐患</div></div>
          <div class="stat-item"><div class="stat-num num-orange">${pendingDangers}</div><div class="stat-label">待整改</div></div>
        </div>
      </div>
      <div class="panel" style="margin-top:15px">
        <div class="panel-title">📋 今日巡检记录</div>
        <div class="alert-list">
          ${todayLogs.length > 0 ? todayLogs.slice(0,5).map(l => `<div class="alert-item" style="background:rgba(59,130,246,0.1);border-left-color:#3b82f6">${l.inspectTime || ''} ${l.inspector || '未知'} - ${l.result === 'normal' ? '正常' : l.result === 'fault' ? '故障' : '需维保'}</div>`).join('') : '<div style="text-align:center;color:#666;padding:20px">今日暂无巡检记录</div>'}
        </div>
      </div>
    </div>
  </div>
  <script>
    function updateTime() {
      const now = new Date();
      document.getElementById('screen-time').innerText =
        now.toLocaleDateString('zh-CN') + ' ' + now.toLocaleTimeString('zh-CN');
    }
    updateTime();
    setInterval(updateTime, 1000);
    // 每30秒自动刷新
    setInterval(() => location.reload(), 30000);
    // 监听主窗口的刷新消息
    window.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'refreshDataScreen') {
        const tip = document.createElement('div');
        tip.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:10px 20px;border-radius:8px;z-index:9999;font-size:14px';
        tip.innerText = '🔄 数据已更新，正在刷新...';
        document.body.appendChild(tip);
        setTimeout(() => { tip.remove(); location.reload(); }, 1000);
      }
    });
  </script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    alert("浏览器拦截了弹窗，请允许此网站弹出窗口后重试");
    return;
  }
  // 保存窗口引用，用于后续刷新
  dataScreenWindow = win;
  win.document.write(screenHtml);
  win.document.close();
  // 监听数据大屏窗口关闭
  win.addEventListener('beforeunload', () => { dataScreenWindow = null; });
  } catch(e) {
    console.error("打开数据大屏失败:", e);
    alert("打开数据大屏失败：" + e.message);
  }
}

/* ============================================================
 * 备件库存管理
 * ============================================================ */

// 出入库记录存在 localStorage
function getPartsRecords() {
  try { return JSON.parse(localStorage.getItem("firemap_parts_records") || "[]"); }
  catch(e) { return []; }
}
function savePartsRecords(records) {
  localStorage.setItem("firemap_parts_records", JSON.stringify(records));
}

// 添加备件
async function addPart(data) {
  const part = {
    id: genId(),
    name: data.name || "",
    spec: data.spec || "",
    category: data.category || "其他",
    unit: data.unit || "个",
    stock: parseInt(data.stock) || 0,
    minStock: parseInt(data.minStock) || 0,
    price: parseFloat(data.price) || 0,
    location: data.location || "",
    remark: data.remark || "",
    createdAt: new Date().toISOString()
  };
  await dbPut(S_PARTS, part);
  addOperationLog("add_part", `添加备件：${part.name}`);
  showToast("备件已添加");
  renderPartsList();
}

// 获取备件列表
async function getParts() {
  const parts = await dbGetAll(S_PARTS);
  return parts.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

// 更新备件
async function updatePart(partId, updates) {
  const parts = await dbGetAll(S_PARTS);
  const part = parts.find(p => p.id === partId);
  if (!part) return;
  Object.assign(part, updates);
  await dbPut(S_PARTS, part);
  renderPartsList();
}

// 删除备件
async function deletePart(partId) {
  if (!await confirmDialog("确认删除该备件？")) return;
  await dbDel(S_PARTS, partId);
  renderPartsList();
  showToast("备件已删除");
}

// 备件入库
async function stockIn(partId, qty, remark) {
  const parts = await dbGetAll(S_PARTS);
  const part = parts.find(p => p.id === partId);
  if (!part) return;
  part.stock += parseInt(qty);
  await dbPut(S_PARTS, part);
  // 记录
  const records = getPartsRecords();
  records.unshift({
    id: genId(),
    partId: partId,
    partName: part.name,
    type: "in",
    qty: parseInt(qty),
    balance: part.stock,
    remark: remark || "",
    operator: currentUser?.username || "未知",
    time: new Date().toISOString()
  });
  savePartsRecords(records);
  showToast(`入库成功，当前库存：${part.stock}${part.unit}`);
  renderPartsList();
}

// 备件出库
async function stockOut(partId, qty, remark) {
  const parts = await dbGetAll(S_PARTS);
  const part = parts.find(p => p.id === partId);
  if (!part) return;
  qty = parseInt(qty);
  if (qty > part.stock) {
    showToast("库存不足！");
    return;
  }
  part.stock -= qty;
  await dbPut(S_PARTS, part);
  // 记录
  const records = getPartsRecords();
  records.unshift({
    id: genId(),
    partId: partId,
    partName: part.name,
    type: "out",
    qty: qty,
    balance: part.stock,
    remark: remark || "",
    operator: currentUser?.username || "未知",
    time: new Date().toISOString()
  });
  savePartsRecords(records);
  showToast(`出库成功，当前库存：${part.stock}${part.unit}`);
  renderPartsList();
}

// 渲染备件列表
async function renderPartsList() {
  const box = document.getElementById("parts-list");
  if (!box) return;
  const parts = await getParts();
  const lowStock = parts.filter(p => p.stock <= p.minStock);

  if (!parts.length) {
    box.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无备件，点击上方按钮添加</div>';
    return;
  }

  let html = `<div style="margin-bottom:10px;font-size:13px;color:#666">共 ${parts.length} 种备件`;
  if (lowStock.length > 0) html += ` <span style="color:#ef4444">⚠️ ${lowStock.length} 种库存不足</span>`;
  html += '</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  html += '<thead><tr style="background:#f5f5f5">';
  html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #ddd">备件名称</th>';
  html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #ddd">规格</th>';
  html += '<th style="padding:8px;text-align:center;border-bottom:2px solid #ddd">库存</th>';
  html += '<th style="padding:8px;text-align:center;border-bottom:2px solid #ddd">最低库存</th>';
  html += '<th style="padding:8px;text-align:center;border-bottom:2px solid #ddd">单价</th>';
  html += '<th style="padding:8px;text-align:center;border-bottom:2px solid #ddd">操作</th>';
  html += '</tr></thead><tbody>';

  parts.forEach(p => {
    const isLow = p.stock <= p.minStock;
    html += '<tr style="border-bottom:1px solid #eee">';
    html += `<td style="padding:8px">${p.name}${isLow ? ' <span style="color:#ef4444;font-size:11px">⚠️不足</span>' : ''}</td>`;
    html += `<td style="padding:8px;color:#666">${p.spec || '-'}</td>`;
    html += `<td style="padding:8px;text-align:center;font-weight:${isLow ? 'bold' : 'normal'};color:${isLow ? '#ef4444' : '#333'}">${p.stock}${p.unit}</td>`;
    html += `<td style="padding:8px;text-align:center;color:#666">${p.minStock}${p.unit}</td>`;
    html += `<td style="padding:8px;text-align:center">¥${p.price || 0}</td>`;
    html += `<td style="padding:8px;text-align:center;white-space:nowrap">
      <button class="btn small" onclick="openStockIn('${p.id}')">入库</button>
      <button class="btn small" onclick="openStockOut('${p.id}')">出库</button>
      <button class="btn small del" onclick="deletePart('${p.id}')">删除</button>
    </td>`;
    html += '</tr>';
  });
  html += '</tbody></table>';
  box.innerHTML = html;
}

// 打开入库弹窗
function openStockIn(partId) {
  document.getElementById("stock-part-id").value = partId;
  document.getElementById("stock-type").value = "in";
  document.getElementById("stock-qty").value = "";
  document.getElementById("stock-remark").value = "";
  document.getElementById("stock-modal-title").innerText = "📥 备件入库";
  openModal('modal-stock');
}

// 打开出库弹窗
function openStockOut(partId) {
  document.getElementById("stock-part-id").value = partId;
  document.getElementById("stock-type").value = "out";
  document.getElementById("stock-qty").value = "";
  document.getElementById("stock-remark").value = "";
  document.getElementById("stock-modal-title").innerText = "📤 备件出库";
  openModal('modal-stock');
}

// 提交出入库
async function submitStock() {
  const partId = document.getElementById("stock-part-id").value;
  const type = document.getElementById("stock-type").value;
  const qty = document.getElementById("stock-qty").value;
  const remark = document.getElementById("stock-remark").value;
  if (!qty || parseInt(qty) <= 0) { showToast("请输入有效数量"); return; }
  if (type === "in") await stockIn(partId, qty, remark);
  else await stockOut(partId, qty, remark);
  closeModal('modal-stock');
}

// 打开添加备件弹窗
function openAddPartModal() {
  document.getElementById("part-id").value = "";
  document.getElementById("part-name").value = "";
  document.getElementById("part-spec").value = "";
  document.getElementById("part-category").value = "其他";
  document.getElementById("part-unit").value = "个";
  document.getElementById("part-stock").value = "0";
  document.getElementById("part-min-stock").value = "0";
  document.getElementById("part-price").value = "0";
  document.getElementById("part-location").value = "";
  document.getElementById("part-remark").value = "";
  openModal('modal-add-part');
}

// 提交添加备件
async function submitAddPart() {
  const name = document.getElementById("part-name").value.trim();
  if (!name) { showToast("请输入备件名称"); return; }
  await addPart({
    name: name,
    spec: document.getElementById("part-spec").value,
    category: document.getElementById("part-category").value,
    unit: document.getElementById("part-unit").value,
    stock: document.getElementById("part-stock").value,
    minStock: document.getElementById("part-min-stock").value,
    price: document.getElementById("part-price").value,
    location: document.getElementById("part-location").value,
    remark: document.getElementById("part-remark").value
  });
  closeModal('modal-add-part');
  openModal('modal-parts');
  await renderPartsList();
  showToast("备件已添加");
}

// 打开备件管理
function openPartsManager() {
  renderPartsList();
  openModal('modal-parts');
}

// 查看出入库记录
function openPartsRecords() {
  const records = getPartsRecords();
  const box = document.getElementById("parts-records-list");
  if (!records.length) {
    box.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无出入库记录</div>';
  } else {
    let html = '<table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<thead><tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">时间</th><th style="padding:8px;text-align:left">备件</th><th style="padding:8px;text-align:center">类型</th><th style="padding:8px;text-align:center">数量</th><th style="padding:8px;text-align:center">结存</th><th style="padding:8px;text-align:left">操作人</th><th style="padding:8px;text-align:left">备注</th></tr></thead><tbody>';
    records.slice(0, 50).forEach(r => {
      html += `<tr style="border-bottom:1px solid #eee">
        <td style="padding:6px">${r.time?.replace('T', ' ').substring(0, 16) || ''}</td>
        <td style="padding:6px">${r.partName}</td>
        <td style="padding:6px;text-align:center;color:${r.type === 'in' ? '#10b981' : '#ef4444'}">${r.type === 'in' ? '入库' : '出库'}</td>
        <td style="padding:6px;text-align:center">${r.type === 'in' ? '+' : '-'}${r.qty}</td>
        <td style="padding:6px;text-align:center">${r.balance}</td>
        <td style="padding:6px">${r.operator}</td>
        <td style="padding:6px;color:#666">${r.remark || '-'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    box.innerHTML = html;
  }
  openModal('modal-parts-records');
}

/* ============================================================
 * 应急预案管理
 * ============================================================ */

// 添加应急预案
async function addEmergencyPlan(data) {
  const plan = {
    id: genId(),
    title: data.title || "",
    type: data.type || "火灾",
    content: data.content || "",
    applicable: data.applicable || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await dbPut(S_EMERGENCY, plan);
  addOperationLog("add_plan", `添加应急预案：${plan.title}`);
  showToast("预案已添加");
  renderEmergencyPlans();
}

// 获取预案列表
async function getEmergencyPlans() {
  const plans = await dbGetAll(S_EMERGENCY);
  return plans.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// 更新预案
async function updateEmergencyPlan(planId, updates) {
  const plans = await dbGetAll(S_EMERGENCY);
  const plan = plans.find(p => p.id === planId);
  if (!plan) return;
  Object.assign(plan, updates);
  plan.updatedAt = new Date().toISOString();
  await dbPut(S_EMERGENCY, plan);
  renderEmergencyPlans();
  showToast("预案已更新");
}

// 删除预案
async function deleteEmergencyPlan(planId) {
  if (!await confirmDialog("确认删除该应急预案？")) return;
  await dbDel(S_EMERGENCY, planId);
  renderEmergencyPlans();
  showToast("预案已删除");
}

// 渲染预案列表
async function renderEmergencyPlans() {
  const box = document.getElementById("emergency-plan-list");
  if (!box) return;
  const plans = await getEmergencyPlans();
  if (!plans.length) {
    box.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无应急预案，点击上方按钮添加</div>';
    return;
  }
  let html = "";
  plans.forEach(p => {
    html += `<div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:bold;font-size:14px">${p.title}</span>
        <span style="font-size:11px;background:#eff6ff;color:#2563eb;padding:2px 8px;border-radius:10px">${p.type}</span>
      </div>
      <div style="font-size:12px;color:#666;margin-bottom:8px">
        适用场景：${p.applicable || '-'} | 更新时间：${p.updatedAt?.split('T')[0] || ''}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn small primary" onclick="viewEmergencyPlan('${p.id}')">查看</button>
        <button class="btn small" onclick="editEmergencyPlan('${p.id}')">编辑</button>
        <button class="btn small" onclick="openDrillFromPlan('${p.id}')">记录演练</button>
        <button class="btn small del" onclick="deleteEmergencyPlan('${p.id}')">删除</button>
      </div>
    </div>`;
  });
  box.innerHTML = html;
}

// 查看预案
async function viewEmergencyPlan(planId) {
  const plans = await dbGetAll(S_EMERGENCY);
  const p = plans.find(x => x.id === planId);
  if (!p) return;
  document.getElementById("plan-view-title").innerText = p.title;
  document.getElementById("plan-view-type").innerText = p.type;
  document.getElementById("plan-view-applicable").innerText = p.applicable || '-';
  document.getElementById("plan-view-content").innerText = p.content || '暂无内容';
  openModal('modal-plan-view');
}

// 编辑预案
async function editEmergencyPlan(planId) {
  const plans = await dbGetAll(S_EMERGENCY);
  const p = plans.find(x => x.id === planId);
  if (!p) return;
  document.getElementById("plan-id").value = p.id;
  document.getElementById("plan-title").value = p.title;
  document.getElementById("plan-type").value = p.type;
  document.getElementById("plan-applicable").value = p.applicable;
  document.getElementById("plan-content").value = p.content;
  openModal('modal-edit-plan');
}

// 打开新建预案弹窗
function openAddPlanModal() {
  document.getElementById("plan-id").value = "";
  document.getElementById("plan-title").value = "";
  document.getElementById("plan-type").value = "火灾";
  document.getElementById("plan-applicable").value = "";
  document.getElementById("plan-content").value = "";
  openModal('modal-edit-plan');
}

// 提交预案
async function submitEmergencyPlan() {
  const id = document.getElementById("plan-id").value;
  const title = document.getElementById("plan-title").value.trim();
  if (!title) { showToast("请输入预案名称"); return; }
  const data = {
    title: title,
    type: document.getElementById("plan-type").value,
    applicable: document.getElementById("plan-applicable").value,
    content: document.getElementById("plan-content").value
  };
  if (id) await updateEmergencyPlan(id, data);
  else await addEmergencyPlan(data);
  closeModal('modal-edit-plan');
  openModal('modal-emergency');
  await renderEmergencyPlans();
  showToast(id ? "预案已更新" : "预案已创建");
}

// 打开应急预案管理
function openEmergencyManager() {
  renderEmergencyPlans();
  openModal('modal-emergency');
}

/* ---------- 演练记录 ---------- */

// 添加演练记录
async function addDrillRecord(data) {
  const drill = {
    id: genId(),
    planId: data.planId || null,
    planTitle: data.planTitle || "",
    date: data.date || new Date().toISOString().split('T')[0],
    location: data.location || "",
    participants: data.participants || "",
    content: data.content || "",
    result: data.result || "",
    problems: data.problems || "",
    improvements: data.improvements || "",
    createdAt: new Date().toISOString()
  };
  await dbPut(S_DRILL, drill);
  addOperationLog("add_drill", `添加演练记录：${drill.planTitle}`);
  showToast("演练记录已添加");
  renderDrillRecords();
}

// 获取演练记录
async function getDrillRecords() {
  const drills = await dbGetAll(S_DRILL);
  return drills.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// 删除演练记录
async function deleteDrillRecord(drillId) {
  if (!await confirmDialog("确认删除该演练记录？")) return;
  await dbDel(S_DRILL, drillId);
  renderDrillRecords();
  showToast("记录已删除");
}

// 渲染演练记录
async function renderDrillRecords() {
  const box = document.getElementById("drill-list");
  if (!box) return;
  const drills = await getDrillRecords();
  if (!drills.length) {
    box.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无演练记录</div>';
    return;
  }
  let html = "";
  drills.forEach(d => {
    html += `<div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:bold;font-size:14px">${d.planTitle || '应急演练'}</span>
        <span style="font-size:12px;color:#666">${d.date}</span>
      </div>
      <div style="font-size:12px;color:#666;line-height:1.8">
        <div>地点：${d.location || '-'} | 参与人员：${d.participants || '-'}</div>
        <div>演练内容：${d.content || '-'}</div>
        <div>演练结果：${d.result || '-'}</div>
        ${d.problems ? `<div>存在问题：${d.problems}</div>` : ''}
        ${d.improvements ? `<div>改进措施：${d.improvements}</div>` : ''}
      </div>
      <div style="margin-top:8px">
        <button class="btn small del" onclick="deleteDrillRecord('${d.id}')">删除</button>
      </div>
    </div>`;
  });
  box.innerHTML = html;
}

// 从预案打开演练记录弹窗
async function openDrillFromPlan(planId) {
  const plans = await dbGetAll(S_EMERGENCY);
  const p = plans.find(x => x.id === planId);
  document.getElementById("drill-id").value = "";
  document.getElementById("drill-plan-id").value = planId || "";
  document.getElementById("drill-plan-title").value = p?.title || "";
  document.getElementById("drill-date").value = new Date().toISOString().split('T')[0];
  document.getElementById("drill-location").value = "";
  document.getElementById("drill-participants").value = "";
  document.getElementById("drill-content").value = "";
  document.getElementById("drill-result").value = "";
  document.getElementById("drill-problems").value = "";
  document.getElementById("drill-improvements").value = "";
  openModal('modal-edit-drill');
}

// 打开新建演练记录
function openAddDrillModal() {
  document.getElementById("drill-id").value = "";
  document.getElementById("drill-plan-id").value = "";
  document.getElementById("drill-plan-title").value = "";
  document.getElementById("drill-date").value = new Date().toISOString().split('T')[0];
  document.getElementById("drill-location").value = "";
  document.getElementById("drill-participants").value = "";
  document.getElementById("drill-content").value = "";
  document.getElementById("drill-result").value = "";
  document.getElementById("drill-problems").value = "";
  document.getElementById("drill-improvements").value = "";
  openModal('modal-edit-drill');
}

// 提交演练记录
async function submitDrillRecord() {
  await addDrillRecord({
    planId: document.getElementById("drill-plan-id").value || null,
    planTitle: document.getElementById("drill-plan-title").value,
    date: document.getElementById("drill-date").value,
    location: document.getElementById("drill-location").value,
    participants: document.getElementById("drill-participants").value,
    content: document.getElementById("drill-content").value,
    result: document.getElementById("drill-result").value,
    problems: document.getElementById("drill-problems").value,
    improvements: document.getElementById("drill-improvements").value
  });
  closeModal('modal-edit-drill');
  openModal('modal-emergency');
  await renderDrillRecords();
  await renderEmergencyPlans();
  showToast("演练记录已添加");
}

/* ============================================================
 * 物联网对接
 * ============================================================ */

// 添加物联网设备
async function addIotDevice(data) {
  const device = {
    id: genId(),
    name: data.name || "",
    type: data.type || "烟感",
    deviceCode: data.deviceCode || "",
    location: data.location || "",
    status: "offline",
    lastOnline: null,
    data: {},
    createdAt: new Date().toISOString()
  };
  await dbPut(S_IOT, device);
  addOperationLog("add_iot", `添加物联网设备：${device.name}`);
  showToast("物联网设备已添加");
  renderIotDevices();
}

// 获取物联网设备列表
async function getIotDevices() {
  const devices = await dbGetAll(S_IOT);
  return devices.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

// 删除物联网设备
async function deleteIotDevice(deviceId) {
  if (!await confirmDialog("确认删除该物联网设备？")) return;
  await dbDel(S_IOT, deviceId);
  renderIotDevices();
  showToast("设备已删除");
}

// 模拟设备数据更新（演示用）
function simulateIotData(device) {
  const types = {
    "烟感": { smoke: Math.random() * 100, temp: 20 + Math.random() * 15 },
    "温感": { temp: 20 + Math.random() * 20, humidity: 40 + Math.random() * 30 },
    "水压": { pressure: 0.3 + Math.random() * 0.5, flow: Math.random() * 10 },
    "摄像头": { online: Math.random() > 0.1, recording: Math.random() > 0.3 },
    "报警主机": { armed: Math.random() > 0.3, zones: 8 + Math.floor(Math.random() * 8) }
  };
  return types[device.type] || { value: Math.random() * 100 };
}

// 刷新物联网设备状态
async function refreshIotDevices() {
  const devices = await getIotDevices();
  for (const dev of devices) {
    // 模拟：90%在线，10%离线
    dev.status = Math.random() > 0.1 ? "online" : "offline";
    if (dev.status === "online") {
      dev.lastOnline = new Date().toISOString();
      dev.data = simulateIotData(dev);
    }
    await dbPut(S_IOT, dev);
  }
  renderIotDevices();
  showToast("设备状态已刷新");
}

// 渲染物联网设备列表
async function renderIotDevices() {
  const box = document.getElementById("iot-device-list");
  if (!box) return;
  const devices = await getIotDevices();
  const online = devices.filter(d => d.status === "online").length;

  if (!devices.length) {
    box.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无物联网设备，点击上方按钮添加</div>';
    return;
  }

  let html = `<div style="margin-bottom:10px;font-size:13px;color:#666">共 ${devices.length} 台设备，在线 ${online} 台，离线 ${devices.length - online} 台</div>`;
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
  devices.forEach(d => {
    const isOnline = d.status === "online";
    html += `<div style="padding:12px;border:1px solid ${isOnline ? '#10b981' : '#d1d5db'};border-radius:8px;background:${isOnline ? '#f0fdf4' : '#f9fafb'}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:bold;font-size:14px">${d.name}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${isOnline ? '#10b981' : '#9ca3af'};color:#fff">${isOnline ? '● 在线' : '○ 离线'}</span>
      </div>
      <div style="font-size:12px;color:#666;line-height:1.6">
        <div>类型：${d.type}</div>
        <div>编号：${d.deviceCode || '-'}</div>
        <div>位置：${d.location || '-'}</div>
        ${isOnline && d.data ? `<div style="margin-top:6px;padding:6px;background:#fff;border-radius:4px">${Object.entries(d.data).map(([k,v]) => `<span style="margin-right:10px">${k}: <b>${typeof v === 'number' ? v.toFixed(1) : v}</b></span>`).join('')}</div>` : ''}
        ${d.lastOnline ? `<div style="color:#9ca3af;margin-top:4px">最后在线：${d.lastOnline.replace('T',' ').substring(0,16)}</div>` : ''}
      </div>
      <div style="margin-top:8px">
        <button class="btn small del" onclick="deleteIotDevice('${d.id}')">删除</button>
      </div>
    </div>`;
  });
  html += '</div>';
  box.innerHTML = html;
}

// 打开添加物联网设备弹窗
function openAddIotModal() {
  document.getElementById("iot-id").value = "";
  document.getElementById("iot-name").value = "";
  document.getElementById("iot-type").value = "烟感";
  document.getElementById("iot-code").value = "";
  document.getElementById("iot-location").value = "";
  openModal('modal-add-iot');
}

// 提交添加物联网设备
async function submitIotDevice() {
  const name = document.getElementById("iot-name").value.trim();
  if (!name) { showToast("请输入设备名称"); return; }
  await addIotDevice({
    name: name,
    type: document.getElementById("iot-type").value,
    deviceCode: document.getElementById("iot-code").value,
    location: document.getElementById("iot-location").value
  });
  closeModal('modal-add-iot');
  openModal('modal-iot');
  await renderIotDevices();
  showToast("物联网设备已添加");
}

// 打开物联网管理
function openIotManager() {
  renderIotDevices();
  openModal('modal-iot');
}

/* ============================================================
 * AI识别
 * ============================================================ */

// 模拟AI识别结果库
const AI_RESULT_LIBRARY = [
  { type: "室内消火栓", status: "正常", issues: [], confidence: 0.95 },
  { type: "灭火器", status: "正常", issues: [], confidence: 0.92 },
  { type: "灭火器", status: "需维保", issues: ["压力指针偏低", "瓶体有锈蚀"], confidence: 0.88 },
  { type: "烟感探测器", status: "正常", issues: [], confidence: 0.96 },
  { type: "温感探测器", status: "正常", issues: [], confidence: 0.94 },
  { type: "应急照明灯", status: "故障", issues: ["灯具不亮", "电池老化"], confidence: 0.91 },
  { type: "疏散指示标志", status: "正常", issues: [], confidence: 0.93 },
  { type: "防火门", status: "需维保", issues: ["闭门器损坏", "门缝过大"], confidence: 0.87 },
  { type: "喷淋头", status: "正常", issues: [], confidence: 0.95 },
  { type: "消防水泵", status: "正常", issues: [], confidence: 0.90 }
];

// 执行AI识别（模拟）
async function runAIRecognition(imageData) {
  // 模拟识别过程
  await new Promise(resolve => setTimeout(resolve, 1500));
  // 随机选择一个结果
  const result = AI_RESULT_LIBRARY[Math.floor(Math.random() * AI_RESULT_LIBRARY.length)];
  const record = {
    id: genId(),
    image: imageData,
    result: result.type,
    status: result.status,
    issues: result.issues,
    confidence: result.confidence,
    createdAt: new Date().toISOString()
  };
  await dbPut(S_AI, record);
  return record;
}

// 处理图片上传
function handleAIImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    const imageData = e.target.result;
    // 显示预览
    document.getElementById("ai-preview").innerHTML = `<img src="${imageData}" style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid #ddd"/>`;
    document.getElementById("ai-result").innerHTML = '<div style="padding:20px;text-align:center;color:#666">🤖 AI正在识别中...</div>';
    // 执行识别
    const record = await runAIRecognition(imageData);
    displayAIResult(record);
    renderAIRecords();
  };
  reader.readAsDataURL(file);
}

// 显示识别结果
function displayAIResult(record) {
  const statusColor = record.status === "正常" ? "#10b981" : record.status === "故障" ? "#ef4444" : "#f59e0b";
  let issuesHtml = "";
  if (record.issues && record.issues.length > 0) {
    issuesHtml = `<div style="margin-top:10px"><div style="font-weight:bold;margin-bottom:4px">⚠️ 发现问题：</div>${record.issues.map(i => `<div style="color:#ef4444;padding:2px 0">• ${i}</div>`).join('')}</div>`;
  }
  document.getElementById("ai-result").innerHTML = `
    <div style="padding:15px;background:#f8fafc;border-radius:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:18px;font-weight:bold">${record.result}</span>
        <span style="background:${statusColor};color:#fff;padding:4px 12px;border-radius:12px;font-size:13px">${record.status}</span>
      </div>
      <div style="color:#666;font-size:13px">识别置信度：${(record.confidence * 100).toFixed(1)}%</div>
      <div class="progress-bar" style="margin-top:5px;background:#e5e7eb;height:6px;border-radius:3px;overflow:hidden">
        <div style="width:${record.confidence * 100}%;height:100%;background:#3b82f6;border-radius:3px"></div>
      </div>
      ${issuesHtml}
      ${record.status !== "正常" ? `<div style="margin-top:12px"><button class="btn primary small" onclick="createWorkOrderFromAI('${record.id}')">🔧 创建维保工单</button></div>` : ''}
    </div>`;
}

// 从AI识别结果创建工单
async function createWorkOrderFromAI(recordId) {
  const records = await dbGetAll(S_AI);
  const record = records.find(r => r.id === recordId);
  if (!record) return;
  await createWorkOrder({
    title: `AI识别发现：${record.result} - ${record.status}`,
    type: "repair",
    priority: record.status === "故障" ? "urgent" : "normal",
    description: `AI识别发现${record.result}状态为${record.status}。${record.issues ? '问题：' + record.issues.join('；') : ''}`,
    deviceId: null
  });
  showToast("已根据AI识别结果创建工单");
}

// 渲染AI识别历史
async function renderAIRecords() {
  const box = document.getElementById("ai-history-list");
  if (!box) return;
  const records = (await dbGetAll(S_AI)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (!records.length) {
    box.innerHTML = '<div style="padding:15px;color:#999;text-align:center;font-size:13px">暂无识别记录</div>';
    return;
  }
  let html = "";
  records.slice(0, 10).forEach(r => {
    const statusColor = r.status === "正常" ? "#10b981" : r.status === "故障" ? "#ef4444" : "#f59e0b";
    html += `<div style="display:flex;gap:10px;padding:8px;border-bottom:1px solid #eee;align-items:center">
      <img src="${r.image}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;border:1px solid #ddd"/>
      <div style="flex:1;min-width:0">
        <div style="font-weight:bold;font-size:13px">${r.result}</div>
        <div style="font-size:11px;color:#666">${r.createdAt.replace('T',' ').substring(0,16)} | 置信度${(r.confidence*100).toFixed(0)}%</div>
      </div>
      <span style="font-size:11px;color:${statusColor};font-weight:bold">${r.status}</span>
    </div>`;
  });
  box.innerHTML = html;
}

// 打开AI识别
function openAIManager() {
  document.getElementById("ai-preview").innerHTML = '<div style="width:200px;height:200px;border:2px dashed #ddd;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#999">图片预览</div>';
  document.getElementById("ai-result").innerHTML = '<div style="padding:20px;text-align:center;color:#999">上传图片开始识别</div>';
  document.getElementById("ai-image-input").value = "";
  renderAIRecords();
  openModal('modal-ai');
}

/* ============================================================
 * 巡检路线
 * ============================================================ */

// 当前执行的路线
let currentRoute = null;
let currentRouteIndex = 0;

// 创建巡检路线
async function createInspectRoute(data) {
  const route = {
    id: genId(),
    name: data.name || "",
    buildingId: data.buildingId || null,
    floorId: data.floorId || null,
    deviceIds: data.deviceIds || [],
    remark: data.remark || "",
    createdAt: new Date().toISOString()
  };
  await dbPut(S_ROUTE, route);
  addOperationLog("create_route", `创建巡检路线：${route.name}`);
  showToast("巡检路线已创建");
  renderRouteList();
}

// 获取巡检路线列表
async function getInspectRoutes() {
  const routes = await dbGetAll(S_ROUTE);
  return routes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// 删除巡检路线
async function deleteInspectRoute(routeId) {
  if (!await confirmDialog("确认删除该巡检路线？")) return;
  await dbDel(S_ROUTE, routeId);
  renderRouteList();
  showToast("路线已删除");
  // 刷新工作台数据
  const wb = document.getElementById('maintain-workbench');
  if (wb && wb.style.display !== 'none' && typeof loadWorkbenchData === 'function') loadWorkbenchData();
}

// 渲染路线列表
async function renderRouteList() {
  const box = document.getElementById("route-list");
  if (!box) return;
  const routes = await getInspectRoutes();
  const buildings = await dbGetAll(SB);
  const floors = await dbGetAll(SF);
  if (!routes.length) {
    box.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无巡检路线，点击上方按钮创建</div>';
    return;
  }
  let html = "";
  routes.forEach(r => {
    const b = buildings.find(x => x.id === r.buildingId);
    const f = floors.find(x => x.id === r.floorId);
    html += `<div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:bold;font-size:14px">${r.name}</span>
        <span style="font-size:11px;color:#666">${r.deviceIds.length}个点位</span>
      </div>
      <div style="font-size:12px;color:#666;margin-bottom:8px">
        ${b?.name || ''} ${f?.floorName || ''}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn primary small" onclick="startRouteExecution('${r.id}')">▶ 开始巡检</button>
        <button class="btn small del" onclick="deleteInspectRoute('${r.id}')">删除</button>
      </div>
    </div>`;
  });
  box.innerHTML = html;
}

// 打开创建路线弹窗
async function openCreateRouteModal() {
  const buildings = await dbGetAll(SB);
  const bSelect = document.getElementById("route-building");
  bSelect.innerHTML = '<option value="">选择建筑</option>' + buildings.map(b => `<option value="${b.id}">${b.name}</option>`).join("");
  document.getElementById("route-floor").innerHTML = '<option value="">先选建筑</option>';
  document.getElementById("route-name").value = "";
  document.getElementById("route-remark").value = "";
  document.getElementById("route-device-checkboxes").innerHTML = '<div style="color:#999;padding:10px;text-align:center">请先选择楼层</div>';
  openModal('modal-create-route');
}

// 更新路线楼层选择
async function updateRouteFloorSelect() {
  const buildingId = document.getElementById("route-building").value;
  const fSelect = document.getElementById("route-floor");
  if (!buildingId) {
    fSelect.innerHTML = '<option value="">先选建筑</option>';
    return;
  }
  const floors = await dbGetAll(SF);
  const buildingFloors = floors.filter(f => f.buildingId === buildingId);
  fSelect.innerHTML = '<option value="">选择楼层</option>' + buildingFloors.map(f => `<option value="${f.id}">${f.floorName}</option>`).join("");
  document.getElementById("route-device-checkboxes").innerHTML = '<div style="color:#999;padding:10px;text-align:center">请先选择楼层</div>';
}

// 加载楼层设备供选择
async function loadRouteDevices() {
  const floorId = document.getElementById("route-floor").value;
  const box = document.getElementById("route-device-checkboxes");
  if (!floorId) {
    box.innerHTML = '<div style="color:#999;padding:10px;text-align:center">请先选择楼层</div>';
    return;
  }
  const devices = await getDevicesByFloor(floorId);
  if (!devices.length) {
    box.innerHTML = '<div style="color:#999;padding:10px;text-align:center">该楼层暂无设备</div>';
    return;
  }
  let html = '<div style="max-height:200px;overflow-y:auto">';
  devices.forEach(d => {
    html += `<label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" class="route-device-check" value="${d.id}"/>
      <span>${d.deviceType || d.type || '未知'} ${d.deviceCode ? '('+d.deviceCode+')' : ''}</span>
    </label>`;
  });
  html += '</div>';
  html += '<div style="margin-top:8px"><button class="btn small" onclick="selectAllRouteDevices(true)">全选</button> <button class="btn small" onclick="selectAllRouteDevices(false)">取消全选</button></div>';
  box.innerHTML = html;
}

// 全选/取消全选
function selectAllRouteDevices(checked) {
  document.querySelectorAll(".route-device-check").forEach(cb => cb.checked = checked);
}

// 提交创建路线
async function submitCreateRoute() {
  const name = document.getElementById("route-name").value.trim();
  if (!name) { showToast("请输入路线名称"); return; }
  const floorId = document.getElementById("route-floor").value;
  if (!floorId) { showToast("请选择楼层"); return; }
  const deviceIds = Array.from(document.querySelectorAll(".route-device-check:checked")).map(cb => cb.value);
  if (!deviceIds.length) { showToast("请至少选择一个设备"); return; }
  await createInspectRoute({
    name: name,
    buildingId: document.getElementById("route-building").value,
    floorId: floorId,
    deviceIds: deviceIds,
    remark: document.getElementById("route-remark").value
  });
  closeModal('modal-create-route');
  openModal('modal-route');
  await renderRouteList();
  showToast("巡检路线已创建");
  // 刷新工作台数据
  const wb = document.getElementById('maintain-workbench');
  if (wb && wb.style.display !== 'none' && typeof loadWorkbenchData === 'function') loadWorkbenchData();
}

// 开始执行路线
async function startRouteExecution(routeId) {
  const routes = await getInspectRoutes();
  const route = routes.find(r => r.id === routeId);
  if (!route) return;
  currentRoute = route;
  currentRouteIndex = 0;
  closeModal('modal-route');
  renderRouteExecution();
  openModal('modal-route-execution');
}

// 渲染路线执行界面
async function renderRouteExecution() {
  if (!currentRoute) return;
  const box = document.getElementById("route-execution-content");
  const devices = await dbGetAll(SD);
  const total = currentRoute.deviceIds.length;
  const completed = currentRouteIndex;

  let html = `<div style="text-align:center;margin-bottom:15px">
    <div style="font-size:18px;font-weight:bold;margin-bottom:5px">${currentRoute.name}</div>
    <div style="color:#666;font-size:13px">进度：${completed} / ${total}</div>
    <div style="background:#e5e7eb;height:8px;border-radius:4px;margin:10px 0;overflow:hidden">
      <div style="width:${total > 0 ? (completed/total)*100 : 0}%;height:100%;background:#3b82f6;border-radius:4px;transition:width 0.3s"></div>
    </div>
  </div>`;

  if (currentRouteIndex >= total) {
    html += `<div style="text-align:center;padding:30px">
      <div style="font-size:48px;margin-bottom:10px">✅</div>
      <div style="font-size:18px;font-weight:bold;color:#10b981">巡检完成！</div>
      <div style="color:#666;margin-top:5px">共巡检 ${total} 个点位</div>
      <button class="btn primary" style="margin-top:15px" onclick="finishRouteExecution()">完成</button>
    </div>`;
  } else {
    const deviceId = currentRoute.deviceIds[currentRouteIndex];
    const dev = devices.find(d => d.id === deviceId);
    html += `<div style="padding:15px;background:#f8fafc;border-radius:8px;margin-bottom:15px">
      <div style="font-size:16px;font-weight:bold;margin-bottom:5px">第 ${currentRouteIndex + 1} 个点位</div>
      <div style="font-size:14px;color:#333">${dev?.deviceType || dev?.type || '未知设备'} ${dev?.deviceCode ? '('+dev.deviceCode+')' : ''}</div>
      <div style="font-size:12px;color:#666;margin-top:3px">位置：${dev?.positionDesc || '-'}</div>
    </div>
    <div style="margin-bottom:15px">
      <label style="font-size:13px;font-weight:bold">检查结果：</label>
      <div style="display:flex;gap:10px;margin-top:8px">
        <label style="flex:1;padding:10px;border:2px solid #10b981;border-radius:8px;text-align:center;cursor:pointer" onclick="checkRouteDevice('normal')">
          <div style="font-size:24px">✅</div><div style="font-size:13px">正常</div>
        </label>
        <label style="flex:1;padding:10px;border:2px solid #ef4444;border-radius:8px;text-align:center;cursor:pointer" onclick="checkRouteDevice('fault')">
          <div style="font-size:24px">❌</div><div style="font-size:13px">故障</div>
        </label>
        <label style="flex:1;padding:10px;border:2px solid #f59e0b;border-radius:8px;text-align:center;cursor:pointer" onclick="checkRouteDevice('maintain-needed')">
          <div style="font-size:24px">⚠️</div><div style="font-size:13px">需维保</div>
        </label>
      </div>
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn" style="flex:1" onclick="skipRouteDevice()">跳过</button>
    </div>`;
  }
  box.innerHTML = html;
}

// 检查当前设备
async function checkRouteDevice(result) {
  if (!currentRoute) return;
  const deviceId = currentRoute.deviceIds[currentRouteIndex];
  await inspectCheckIn(deviceId, result);
  currentRouteIndex++;
  renderRouteExecution();
}

// 跳过当前设备
function skipRouteDevice() {
  if (!currentRoute) return;
  currentRouteIndex++;
  renderRouteExecution();
}

// 完成路线巡检
async function finishRouteExecution() {
  if (!currentRoute) return;
  // 记录路线巡检
  const log = {
    id: genId(),
    routeId: currentRoute.id,
    routeName: currentRoute.name,
    date: new Date().toISOString().split('T')[0],
    inspector: currentUser?.username || "未知",
    totalDevices: currentRoute.deviceIds.length,
    completedDevices: currentRouteIndex,
    createdAt: new Date().toISOString()
  };
  await dbPut(S_ROUTE_LOG, log);
  currentRoute = null;
  currentRouteIndex = 0;
  closeModal('modal-route-execution');
  showToast("路线巡检完成");
}

// 打开巡检路线管理
function openRouteManager() {
  renderRouteList();
  openModal('modal-route');
}

/* ============================================================
 * 巡检计划2.0 - 月计划+日计划+进度跟踪+到期提醒
 * ============================================================ */

// 创建月计划
async function createMonthlyPlan(data) {
  const plan = {
    id: genId(),
    type: "monthly",
    name: data.name || "",
    month: data.month || "", // 格式：2026-09
    buildingIds: data.buildingIds || [],
    assignee: data.assignee || "",
    startDate: data.startDate || "",
    endDate: data.endDate || "",
    frequency: data.frequency || 1, // 频次：每个楼层巡检几次
    sampleMode: data.sampleMode || "all", // all=全部巡检, sample=抽样巡检
    samplePerFloor: data.samplePerFloor || 5, // 每层抽样数量
    sampleTotal: data.sampleTotal || 0, // 总抽样上限（0=不限制）
    totalDevices: 0,
    completedDevices: 0,
    status: "pending", // pending/in-progress/completed
    remark: data.remark || "",
    createdAt: new Date().toISOString()
  };

  // 统计设备总数（抽样模式下按抽样量计算）
  const floors = await dbGetAll(SF);
  const devices = await dbGetAll(SD);
  const targetFloors = floors.filter(f => plan.buildingIds.includes(f.buildingId));
  const targetDevices = devices.filter(d => targetFloors.some(f => f.id === d.floorId));

  if (plan.sampleMode === "sample") {
    // 抽样模式：每层抽样数 × 频次 × 楼层数，但不超过总抽样上限
    let sampleCount = targetFloors.length * plan.samplePerFloor * plan.frequency;
    if (plan.sampleTotal > 0 && sampleCount > plan.sampleTotal) {
      sampleCount = plan.sampleTotal;
    }
    plan.totalDevices = sampleCount;
  } else {
    plan.totalDevices = targetDevices.length * plan.frequency;
  }

  await dbPut(S_PLAN, plan);
  const modeText = plan.sampleMode === "sample" ? `抽样${plan.totalDevices}台` : `全检${plan.totalDevices}台`;
  addOperationLog("create_monthly_plan", `创建月巡检计划：${plan.name}，频次${plan.frequency}次，${modeText}`);
  return plan;
}

// 自动拆解日计划（按楼层分配到工作日，支持频次和抽样）
async function generateDailyPlans(monthlyPlanId) {
  const plans = await dbGetAll(S_PLAN);
  const monthly = plans.find(p => p.id === monthlyPlanId);
  if (!monthly) return;

  const floors = await dbGetAll(SF);
  const devices = await dbGetAll(SD);
  const targetFloors = floors.filter(f => monthly.buildingIds.includes(f.buildingId));
  const frequency = monthly.frequency || 1;
  const isSample = monthly.sampleMode === "sample";
  const samplePerFloor = monthly.samplePerFloor || 5;

  // 计算月份的工作日
  const [year, month] = monthly.month.split('-').map(Number);
  const workDays = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 排除周末
      workDays.push(`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
    }
  }

  // 构建日计划任务列表：每个楼层 × 频次
  const tasks = [];
  for (const floor of targetFloors) {
    const floorDevices = devices.filter(d => d.floorId === floor.id);
    if (floorDevices.length === 0) continue;
    for (let f = 0; f < frequency; f++) {
      tasks.push({ floor, floorDevices, round: f + 1 });
    }
  }

  // 计算总抽样上限的分配
  let remainingSample = monthly.sampleTotal || 0;
  const perTaskSample = isSample && monthly.sampleTotal > 0
    ? Math.max(1, Math.floor(monthly.sampleTotal / tasks.length))
    : samplePerFloor;

  // 按工作日分配，每个工作日一个任务
  let dayIndex = 0;
  let created = 0;
  for (const task of tasks) {
    if (dayIndex >= workDays.length) break;

    let selectedDevices = task.floorDevices;
    let taskSampleCount = perTaskSample;

    if (isSample) {
      // 抽样模式：随机抽取
      if (monthly.sampleTotal > 0) {
        taskSampleCount = Math.min(perTaskSample, remainingSample);
        remainingSample -= taskSampleCount;
      }
      const shuffled = [...task.floorDevices].sort(() => Math.random() - 0.5);
      selectedDevices = shuffled.slice(0, Math.min(taskSampleCount, shuffled.length));
    }

    const roundText = frequency > 1 ? `（第${task.round}轮）` : "";
    const dailyPlan = {
      id: genId(),
      type: "daily",
      parentId: monthlyPlanId,
      name: `${monthly.name} - ${task.floor.floorName}${roundText}`,
      date: workDays[dayIndex],
      buildingId: task.floor.buildingId,
      floorId: task.floor.id,
      deviceIds: selectedDevices.map(d => d.id),
      assignee: monthly.assignee,
      totalDevices: selectedDevices.length,
      completedDevices: 0,
      status: "pending",
      sampleMode: isSample ? "sample" : "all",
      createdAt: new Date().toISOString()
    };
    await dbPut(S_PLAN, dailyPlan);
    dayIndex++;
    created++;
  }

  monthly.status = "in-progress";
  await dbPut(S_PLAN, monthly);
  const modeText = isSample ? `抽样${monthly.totalDevices}台` : `全检`;
  showToast(`已生成 ${created} 个日巡检计划（频次${frequency}次，${modeText}）`);
  renderMonthlyPlanList();
}

// 获取月计划列表
async function getMonthlyPlans() {
  const plans = await dbGetAll(S_PLAN);
  return plans.filter(p => p.type === "monthly").sort((a, b) => b.month.localeCompare(a.month));
}

// 获取某个月计划的所有日计划
async function getDailyPlans(parentId) {
  const plans = await dbGetAll(S_PLAN);
  return plans.filter(p => p.type === "daily" && p.parentId === parentId).sort((a, b) => a.date.localeCompare(b.date));
}

// 更新日计划进度（巡检打卡时调用）
async function updateDailyPlanProgress(deviceId, inspectDate) {
  const plans = await dbGetAll(S_PLAN);
  const dailyPlans = plans.filter(p => p.type === "daily" && p.date === inspectDate && p.deviceIds?.includes(deviceId));

  for (const dp of dailyPlans) {
    if (!dp.checkedDevices) dp.checkedDevices = [];
    if (!dp.checkedDevices.includes(deviceId)) {
      dp.checkedDevices.push(deviceId);
      dp.completedDevices = dp.checkedDevices.length;
      if (dp.completedDevices >= dp.totalDevices) dp.status = "completed";
      else dp.status = "in-progress";
      await dbPut(S_PLAN, dp);

      // 更新父月计划进度
      const monthly = plans.find(p => p.id === dp.parentId);
      if (monthly) {
        const allDaily = await getDailyPlans(monthly.id);
        monthly.completedDevices = allDaily.reduce((sum, d) => sum + (d.completedDevices || 0), 0);
        if (monthly.completedDevices >= monthly.totalDevices) monthly.status = "completed";
        else monthly.status = "in-progress";
        await dbPut(S_PLAN, monthly);
      }
    }
  }
}

// 检查月计划到期提醒（差7天到月底时提醒）
async function checkMonthlyPlanReminder() {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const monthlyPlans = await getMonthlyPlans();
  const incompletePlans = monthlyPlans.filter(p => p.status !== "completed" && p.endDate);

  for (const plan of incompletePlans) {
    // 计算距离计划结束日期还有多少天
    const endDate = new Date(plan.endDate);
    const daysLeft = Math.ceil((endDate - today) / (24 * 3600 * 1000));

    // 差7天到期时提醒
    if (daysLeft !== 7) continue;

    // 每个计划独立记录提醒状态，避免重复
    const remindKey = `firemap_plan_remind_${plan.id}`;
    if (localStorage.getItem(remindKey) === todayStr) continue;

    const remaining = plan.totalDevices - plan.completedDevices;
    if (remaining > 0) {
      const msg = `【巡检计划提醒】\n计划：${plan.name}\n距计划结束还剩 ${daysLeft} 天\n还差 ${remaining} 台设备未巡检\n负责人：${plan.assignee || '未分配'}\n计划截止：${plan.endDate}`;
      await sendWechatNotify("巡检计划到期提醒", msg);
    }

    localStorage.setItem(remindKey, todayStr);
  }
}

// 编辑月计划
async function editMonthlyPlan(planId, updates) {
  const plans = await dbGetAll(S_PLAN);
  const plan = plans.find(p => p.id === planId);
  if (!plan) return;
  Object.assign(plan, updates);
  await dbPut(S_PLAN, plan);
  renderMonthlyPlanList();
  showToast("计划已更新");
}

// 编辑日计划
async function editDailyPlan(planId, updates) {
  const plans = await dbGetAll(S_PLAN);
  const plan = plans.find(p => p.id === planId);
  if (!plan) return;
  Object.assign(plan, updates);
  await dbPut(S_PLAN, plan);
  showToast("日计划已更新");
}

// 删除月计划（同时删除关联的日计划）
async function deleteMonthlyPlan(planId) {
  if (!await confirmDialog("确认删除该月计划？关联的日计划也会一并删除。")) return;
  const dailyPlans = await getDailyPlans(planId);
  for (const dp of dailyPlans) {
    await dbDel(S_PLAN, dp.id);
  }
  await dbDel(S_PLAN, planId);
  renderMonthlyPlanList();
  showToast("月计划已删除");
  // 刷新工作台数据
  const wb = document.getElementById('maintain-workbench');
  if (wb && wb.style.display !== 'none' && typeof loadWorkbenchData === 'function') loadWorkbenchData();
}

// 渲染月计划列表
async function renderMonthlyPlanList() {
  const box = document.getElementById("monthly-plan-list");
  if (!box) return;
  const plans = await getMonthlyPlans();
  const buildings = await dbGetAll(SB);

  if (!plans.length) {
    box.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无月巡检计划，点击上方按钮创建</div>';
    return;
  }

  let html = "";
  for (const p of plans) {
    const bNames = p.buildingIds.map(id => buildings.find(b => b.id === id)?.name).filter(Boolean).join("、");
    const progress = p.totalDevices > 0 ? Math.round((p.completedDevices / p.totalDevices) * 100) : 0;
    const statusColor = p.status === "completed" ? "#10b981" : p.status === "in-progress" ? "#3b82f6" : "#9ca3af";
    const statusText = p.status === "completed" ? "已完成" : p.status === "in-progress" ? "进行中" : "待开始";

    html += `<div style="padding:15px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:bold;font-size:15px">${p.name}</span>
        <span style="font-size:12px;color:${statusColor};background:${statusColor}15;padding:3px 10px;border-radius:10px">${statusText}</span>
      </div>
      <div style="font-size:13px;color:#666;line-height:1.8;margin-bottom:10px">
        <div>📅 月份：${p.month} | 👤 负责人：${p.assignee || '未分配'}</div>
        <div>🏢 建筑：${bNames || '全部'} | 🔄 频次：${p.frequency || 1}次/层</div>
        <div>📊 模式：${p.sampleMode === 'sample' ? `抽样巡检（每层${p.samplePerFloor || 5}台${p.sampleTotal ? '，总上限' + p.sampleTotal + '台' : ''}）` : '全部巡检'} | 进度：${p.completedDevices}/${p.totalDevices} 台（${progress}%）</div>
      </div>
      <div style="background:#e5e7eb;height:8px;border-radius:4px;overflow:hidden;margin-bottom:10px">
        <div style="width:${progress}%;height:100%;background:${statusColor};border-radius:4px;transition:width 0.3s"></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn small primary" onclick="viewDailyPlans('${p.id}')">📋 查看日计划</button>
        <button class="btn small" onclick="editMonthlyPlanModal('${p.id}')">✏️ 编辑</button>
        ${p.status === "pending" ? `<button class="btn small" onclick="generateDailyPlans('${p.id}')">⚡ 生成日计划</button>` : ''}
        <button class="btn small del" onclick="deleteMonthlyPlan('${p.id}')">删除</button>
      </div>
    </div>`;
  }
  box.innerHTML = html;
}

// 查看日计划
async function viewDailyPlans(parentId) {
  const plans = await getDailyPlans(parentId);
  const monthly = (await getMonthlyPlans()).find(p => p.id === parentId);
  const floors = await dbGetAll(SF);
  const buildings = await dbGetAll(SB);

  let html = `<div style="margin-bottom:10px;font-weight:bold">${monthly?.name || ''} - 日计划明细（共${plans.length}天）</div>`;
  if (!plans.length) {
    html += '<div style="padding:15px;color:#999;text-align:center">尚未生成日计划</div>';
  } else {
    html += '<div style="max-height:350px;overflow-y:auto">';
    plans.forEach(dp => {
      const f = floors.find(x => x.id === dp.floorId);
      const b = buildings.find(x => x.id === dp.buildingId);
      const progress = dp.totalDevices > 0 ? Math.round((dp.completedDevices / dp.totalDevices) * 100) : 0;
      const statusColor = dp.status === "completed" ? "#10b981" : dp.status === "in-progress" ? "#3b82f6" : "#9ca3af";
      html += `<div style="padding:10px;border:1px solid #eee;border-radius:6px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:bold">${dp.date} | ${b?.name || ''} ${f?.floorName || ''}</div>
          <div style="font-size:12px;color:#666">${dp.completedDevices}/${dp.totalDevices}台 | 负责人：${dp.assignee || '未分配'}</div>
        </div>
        <span style="font-size:11px;color:${statusColor};font-weight:bold;margin-right:10px">${progress}%</span>
        <button class="btn small" onclick="editDailyPlanModal('${dp.id}')">编辑</button>
      </div>`;
    });
    html += '</div>';
  }
  html += '<div class="modal-btn-row" style="margin-top:10px"><button class="btn ghost" onclick="closeModal(\'modal-daily-plans\')">关闭</button></div>';

  document.getElementById("daily-plans-content").innerHTML = html;
  openModal('modal-daily-plans');
}

// 打开创建月计划弹窗
async function openCreateMonthlyPlanModal() {
  const buildings = await dbGetAll(SB);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  document.getElementById("mp-name").value = `${now.getFullYear()}年${now.getMonth()+1}月巡检计划`;
  document.getElementById("mp-month").value = currentMonth;
  document.getElementById("mp-assignee").value = "";
  document.getElementById("mp-remark").value = "";

  const bCheckboxes = document.getElementById("mp-building-checkboxes");
  bCheckboxes.innerHTML = buildings.map(b => `
    <label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" class="mp-building-check" value="${b.id}"/>
      <span>${b.name}</span>
    </label>
  `).join("");

  openModal('modal-create-monthly-plan');
}

// 切换抽样选项显示
function toggleSampleOptions() {
  const mode = document.getElementById("mp-sample-mode").value;
  const box = document.getElementById("mp-sample-options");
  if (box) box.style.display = mode === "sample" ? "block" : "none";
}

// 提交创建月计划
async function submitMonthlyPlan() {
  const name = document.getElementById("mp-name").value.trim();
  const month = document.getElementById("mp-month").value;
  if (!name) { showToast("请输入计划名称"); return; }
  if (!month) { showToast("请选择月份"); return; }

  const buildingIds = Array.from(document.querySelectorAll(".mp-building-check:checked")).map(cb => cb.value);
  if (!buildingIds.length) { showToast("请至少选择一个建筑"); return; }

  // 计划周期：创建日起30天
  const today = new Date();
  const endDate = new Date(today.getTime() + 30 * 24 * 3600 * 1000);
  const fmt = d => d.toISOString().split('T')[0];
  const sampleMode = document.getElementById("mp-sample-mode").value;
  const plan = await createMonthlyPlan({
    name: name,
    month: month,
    buildingIds: buildingIds,
    assignee: document.getElementById("mp-assignee").value.trim(),
    startDate: fmt(today),
    endDate: fmt(endDate),
    frequency: parseInt(document.getElementById("mp-frequency").value) || 1,
    sampleMode: sampleMode,
    samplePerFloor: parseInt(document.getElementById("mp-sample-per-floor").value) || 5,
    sampleTotal: parseInt(document.getElementById("mp-sample-total").value) || 0,
    remark: document.getElementById("mp-remark").value
  });

  closeModal('modal-create-monthly-plan');
  openModal('modal-inspect-plan-v2');
  await renderMonthlyPlanList();

  // 询问是否立即生成日计划
  const modeText = sampleMode === "sample" ? `抽样${plan.totalDevices}台` : `全检${plan.totalDevices}台`;
  if (await confirmDialog(`月计划已创建，频次${plan.frequency}次，${modeText}。是否立即按楼层生成日计划？`)) {
    await generateDailyPlans(plan.id);
  }
  // 刷新工作台数据
  const wb = document.getElementById('maintain-workbench');
  if (wb && wb.style.display !== 'none' && typeof loadWorkbenchData === 'function') loadWorkbenchData();
}

// 编辑月计划弹窗
async function editMonthlyPlanModal(planId) {
  const plans = await dbGetAll(S_PLAN);
  const plan = plans.find(p => p.id === planId);
  if (!plan) return;
  const buildings = await dbGetAll(SB);

  document.getElementById("emp-id").value = plan.id;
  document.getElementById("emp-name").value = plan.name;
  document.getElementById("emp-month").value = plan.month;
  document.getElementById("emp-assignee").value = plan.assignee || "";
  document.getElementById("emp-remark").value = plan.remark || "";

  const bCheckboxes = document.getElementById("emp-building-checkboxes");
  bCheckboxes.innerHTML = buildings.map(b => `
    <label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" class="emp-building-check" value="${b.id}" ${plan.buildingIds?.includes(b.id) ? 'checked' : ''}/>
      <span>${b.name}</span>
    </label>
  `).join("");

  openModal('modal-edit-monthly-plan');
}

// 提交编辑月计划
async function submitEditMonthlyPlan() {
  const planId = document.getElementById("emp-id").value;
  const buildingIds = Array.from(document.querySelectorAll(".emp-building-check:checked")).map(cb => cb.value);
  await editMonthlyPlan(planId, {
    name: document.getElementById("emp-name").value,
    month: document.getElementById("emp-month").value,
    assignee: document.getElementById("emp-assignee").value.trim(),
    buildingIds: buildingIds,
    remark: document.getElementById("emp-remark").value
  });
  closeModal('modal-edit-monthly-plan');
}

// 编辑日计划弹窗
async function editDailyPlanModal(planId) {
  const plans = await dbGetAll(S_PLAN);
  const plan = plans.find(p => p.id === planId);
  if (!plan) return;

  document.getElementById("edp-id").value = plan.id;
  document.getElementById("edp-date").value = plan.date;
  document.getElementById("edp-assignee").value = plan.assignee || "";
  document.getElementById("edp-status").value = plan.status;

  openModal('modal-edit-daily-plan');
}

// 提交编辑日计划
async function submitEditDailyPlan() {
  const planId = document.getElementById("edp-id").value;
  await editDailyPlan(planId, {
    date: document.getElementById("edp-date").value,
    assignee: document.getElementById("edp-assignee").value.trim(),
    status: document.getElementById("edp-status").value
  });
  closeModal('modal-edit-daily-plan');
  // 刷新日计划列表
  const dailyContent = document.getElementById("daily-plans-content");
  if (dailyContent && dailyContent.innerHTML) {
    // 找到parentId重新渲染
    const allPlans = await dbGetAll(S_PLAN);
    const dp = allPlans.find(p => p.id === planId);
    if (dp) viewDailyPlans(dp.parentId);
  }
}

// 打开巡检计划2.0管理
function openInspectPlanV2Manager() {
  renderMonthlyPlanList();
  openModal('modal-inspect-plan-v2');
}


/* ============================================================
 * 维保巡检工作台
 * ============================================================ */
async function openMaintainWorkbench() {
  document.getElementById("wb-date").innerText = new Date().toLocaleDateString("zh-CN", {year:"numeric",month:"long",day:"numeric",weekday:"long"});
  // 先显示工作台，避免等待数据加载
  document.getElementById("maintain-workbench").style.display = "block";
  const mapEl = document.getElementById("map-container");
  if (mapEl) mapEl.style.visibility = "hidden";
  // 显示加载提示
  document.getElementById("wb-cards-area").innerHTML = '<div style="text-align:center;padding:60px;color:#999;font-size:14px">⏳ 数据加载中...</div>';
  // 异步加载数据
  setTimeout(() => { loadWorkbenchData(); }, 50);
}
function closeMaintainWorkbench() {
  document.getElementById("maintain-workbench").style.display = "none";
  const mapEl = document.getElementById("map-container");
  if (mapEl) mapEl.style.visibility = "visible";
}

async function loadWorkbenchData() {
  // 先同步设备状态（根据巡检记录更新故障/待维保状态）
  await syncDeviceStatusFromInspectRecords();
  const devices = await dbGetAll(SD);
  const localLogs = await dbGetAll(S_LOG);
  // 巡检记录优先从云端加载
  let logs = localLogs;
  try {
    if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
      const { data, error } = await Cloud.supabase.from('inspect_logs').select('*');
      if (!error && data) logs = data;
    }
  } catch(e) { console.warn('工作台加载云端巡检记录失败:', e); }
  const plans = await dbGetAll(S_PLAN);
  const dangers = await dbGetAll(S_HIDDEN);
  const workOrders = await dbGetAll(S_WORKORDER);
  const parts = await dbGetAll(S_PARTS);
  const emergencies = await dbGetAll(S_EMERGENCY);
  const iotDevices = await dbGetAll(S_IOT);
  const aiRecords = await dbGetAll(S_AI);
  const routes = await dbGetAll(S_ROUTE);
  // 直接用已加载的 devices 计算维保到期，避免重复查询数据库
  const dueToday = new Date();
  const dueDate = new Date(dueToday.getTime() + 30 * 24 * 3600 * 1000);
  const fmt = d => d.toISOString().split('T')[0];
  const todayStr = fmt(dueToday), dueStr = fmt(dueDate);
  const due = { overdue: [], dueSoon: [], normal: [] };
  devices.forEach(d => {
    if (!d.nextMaintain) { due.normal.push(d); return; }
    if (d.nextMaintain < todayStr) {
      due.overdue.push({ ...d, daysOverdue: Math.floor((dueToday - new Date(d.nextMaintain)) / 86400000) });
    } else if (d.nextMaintain <= dueStr) {
      due.dueSoon.push({ ...d, daysLeft: Math.floor((new Date(d.nextMaintain) - dueToday) / 86400000) });
    } else {
      due.normal.push(d);
    }
  });

  const today = new Date().toISOString().split("T")[0];
  const todayInspect = logs.filter(l => (l.inspectDate || l.inspect_date || "") === today).length;
  const pendingTasks = plans.filter(p => p.type === "daily" && !p.parentId && p.status === "pending").length;
  const inProgressTasks = plans.filter(p => p.type === "daily" && !p.parentId && p.status === "in-progress").length;
  
  // 故障数：只统计当前存在的设备中状态为"故障"的数量
  // （被删除设备的历史故障记录不计数，巡检记录里仍保留完整历史）
  const faultDevices = devices.filter(d => d.status === "故障").length;
  
  const overdueMaintain = due.overdue.length;
  const dueSoonMaintain = due.dueSoon.length;
  const pendingDangers = dangers.filter(d => d.status === "pending" || d.status === "processing").length;
  const pendingOrders = workOrders.filter(w => w.status !== "completed" && w.status !== "closed").length;
  const lowParts = parts.filter(p => (p.stock || 0) <= (p.minStock || 5)).length;
  const onlineIot = iotDevices.filter(i => i.status === "online").length;

  // 顶部指标
  document.getElementById("wb-today-inspect").innerText = todayInspect;
  document.getElementById("wb-fault").innerText = faultDevices;
  document.getElementById("wb-overdue").innerText = overdueMaintain;

  // 待办任务细分（4类，有任务才显示）— 先算细分，再用细分总数更新顶部大数字，确保一致
  const woPendingCnt = workOrders.filter(w => w.status === "pending" || w.status === "processing" || w.status === "completed").length;
  const dangerPendingCnt = dangers.filter(d => d.status === "pending" || d.status === "processing").length;
  const inspectPendingCnt = pendingTasks + inProgressTasks;
  const maintainPendingCnt = overdueMaintain + dueSoonMaintain;

  const pendingItems = [];
  if (inspectPendingCnt > 0) {
    pendingItems.push({ icon: "📌", title: "巡检任务", count: inspectPendingCnt, action: "openInspectTaskManager()" });
  }
  if (woPendingCnt > 0) {
    pendingItems.push({ icon: "🔧", title: "维修工单", count: woPendingCnt, action: "openWorkOrderManager()" });
  }
  if (dangerPendingCnt > 0) {
    pendingItems.push({ icon: "⚠️", title: "隐患整改", count: dangerPendingCnt, action: "openHiddenDangerManager()" });
  }
  if (maintainPendingCnt > 0) {
    pendingItems.push({ icon: "⏰", title: "维保到期", count: maintainPendingCnt, action: "openMaintainReminder()" });
  }

  // 顶部待办总数 = 细分标签之和
  const totalPending = pendingItems.reduce((sum, item) => sum + item.count, 0);
  document.getElementById("wb-pending-task").innerText = totalPending;

  const detailEl = document.getElementById("wb-pending-detail");
  if (detailEl) {
    if (pendingItems.length === 0) {
      detailEl.innerHTML = '<span style="color:rgba(255,255,255,.8)">✅ 暂无待办任务</span>';
    } else {
      detailEl.innerHTML = pendingItems.map(item => `
        <span onclick="${item.action}" style="cursor:pointer;background:rgba(255,255,255,.2);padding:3px 10px;border-radius:12px;white-space:nowrap;transition:background .2s" onmouseover="this.style.background='rgba(255,255,255,.35)'" onmouseout="this.style.background='rgba(255,255,255,.2)'">${item.icon} ${item.title} <b>${item.count}</b></span>
      `).join("");
    }
  }

  // 功能卡片配置
  const sections = [
    {
      title: "📋 巡检管理", color: "#3b82f6",
      cards: [
        { icon:"📋", title:"巡检记录", desc:"查看所有巡检打卡记录", data: logs.length + " 条", dataColor:"#3b82f6", btn:"查看记录", action:"openInspectRecords()", badge: todayInspect > 0 ? "今日+" + todayInspect : "" },
        { icon:"📌", title:"巡检任务", desc:"快速创建单日巡检任务", data: (pendingTasks + inProgressTasks) + " 待办", dataColor:"#f59e0b", btn:"管理任务", action:"openInspectTaskManager()", badge: pendingTasks > 0 ? pendingTasks + "待办" : "" },
        { icon:"📅", title:"月巡检计划", desc:"月度计划+频次+抽样巡检", data: plans.filter(p=>p.type==="monthly"&&p.status!=="completed").length + " 进行中", dataColor:"#8b5cf6", btn:"管理计划", action:"openInspectPlanV2Manager()", badge:"" },
        { icon:"🗺️", title:"巡检路线", desc:"规划最优巡检路线", data: routes.length + " 条路线", dataColor:"#10b981", btn:"规划路线", action:"openRouteManager()", badge:"" }
      ]
    },
    {
      title: "🔧 维保管理", color: "#f59e0b",
      cards: [
        { icon:"🔧", title:"维保工单", desc:"工单派发与处理跟踪", data: pendingOrders + " 进行中", dataColor:"#ef4444", btn:"管理工单", action:"openWorkOrderManager()", badge: pendingOrders > 0 ? pendingOrders + "待处理" : "" },
        { icon:"⏰", title:"维保到期提醒", desc:"30天内到期设备预警", data: overdueMaintain + "逾期/" + dueSoonMaintain + "即将", dataColor:"#f59e0b", btn:"查看提醒", action:"openMaintainReminder()", badge: overdueMaintain > 0 ? overdueMaintain + "逾期" : "" },
        { icon:"📦", title:"备件库存", desc:"备件入库出库与预警", data: lowParts + " 库存预警", dataColor:"#ec4899", btn:"管理库存", action:"openPartsManager()", badge: lowParts > 0 ? lowParts + "预警" : "" },
        { icon:"📊", title:"导出维保Excel", desc:"导出维保记录报表", data: "Excel", dataColor:"#10b981", btn:"立即导出", action:"exportMaintainExcel()", badge:"" }
      ]
    },
    {
      title: "🛡️ 安全管理", color: "#ef4444",
      cards: [
        { icon:"⚠️", title:"隐患整改", desc:"隐患上报与整改闭环", data: pendingDangers + " 待整改", dataColor:"#ef4444", btn:"管理隐患", action:"openHiddenDangerManager()", badge: pendingDangers > 0 ? pendingDangers + "待整改" : "" },
        { icon:"🚨", title:"应急预案", desc:"预案文档与演练记录", data: emergencies.length + " 份预案", dataColor:"#dc2626", btn:"查看预案", action:"openEmergencyManager()", badge:"" },
        { icon:"📄", title:"检测报告", desc:"自动生成月/季/年报告", data: "一键生成", dataColor:"#7c3aed", btn:"生成报告", action:"openReportGenerator()", badge:"" }
      ]
    },
    {
      title: "🤖 智能监控", color: "#8b5cf6",
      cards: [
        { icon:"🖥️", title:"数据大屏", desc:"全屏数据可视化大屏", data: "实时监控", dataColor:"#2563eb", btn:"打开大屏", action:"openDataScreen()", badge:"" },
        { icon:"📡", title:"物联网", desc:"设备物联网数据对接", data: onlineIot + "/" + iotDevices.length + " 在线", dataColor:"#06b6d4", btn:"管理设备", action:"openIotManager()", badge: onlineIot > 0 ? onlineIot + "在线" : "" },
        { icon:"🤖", title:"AI识别", desc:"AI图像识别检测记录", data: aiRecords.length + " 条记录", dataColor:"#8b5cf6", btn:"查看记录", action:"openAiRecordManager()", badge:"" }
      ]
    }
  ];

  let html = "";
  for (const sec of sections) {
    html += `<div class="wb-section">`;
    html += `<div class="wb-section-title" style="border-left-color:${sec.color}">${sec.title}</div>`;
    html += `<div class="wb-card-grid">`;
    for (const card of sec.cards) {
      const badgeHtml = card.badge ? `<span class="wb-card-badge" style="background:${sec.color}15;color:${sec.color}">${card.badge}</span>` : "";
      html += `<div class="wb-card" style="border-top-color:${sec.color}" onclick="${card.action}">
        <div class="wb-card-header">
          <span class="wb-card-icon">${card.icon}</span>
          ${badgeHtml}
        </div>
        <div class="wb-card-title">${card.title}</div>
        <div class="wb-card-desc">${card.desc}</div>
        <div class="wb-card-data" style="color:${card.dataColor}">${card.data}</div>
        <button class="wb-card-btn" style="background:${sec.color}" onclick="event.stopPropagation();${card.action}">${card.btn}</button>
      </div>`;
    }
    html += `</div></div>`;
  }
  document.getElementById("wb-cards-area").innerHTML = html;
}