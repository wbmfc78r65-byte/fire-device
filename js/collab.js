/* ============================================================
 * collab.js - 协同与权限细化模块
 * 功能：操作日志、多项目管理、权限细化
 * ============================================================ */

/* ---------- 操作日志查看 ---------- */
async function openOperationLog() {
  try {
    const logs = await getOperationLogs(200);
    const box = $("oplog-content");
    if (!box) return;

    if (!logs.length) {
      box.innerHTML = '<div style="padding:20px;text-align:center;color:#999">暂无操作记录</div>';
    } else {
      let html = '<div style="max-height:400px;overflow-y:auto">';
      logs.forEach(log => {
        const time = new Date(log.time).toLocaleString();
        const actionText = {
          create_task: "创建任务",
          update_task: "更新任务",
          delete_task: "删除任务",
          inspect: "巡检打卡",
          photo: "现场拍照",
          login: "登录",
          logout: "退出",
          add_device: "添加设备",
          edit_device: "编辑设备",
          delete_device: "删除设备",
          add_building: "添加建筑",
          add_floor: "添加楼层",
          import: "导入数据",
          export: "导出数据",
          create_project: "创建项目",
          switch_project: "切换项目",
          delete_project: "删除项目",
          other: "其他操作"
        }[log.action] || log.action;

        html += `<div style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:12px">
          <div style="display:flex;justify-content:space-between">
            <span style="color:#3b82f6;font-weight:bold">${actionText}</span>
            <span style="color:#999">${time}</span>
          </div>
          <div style="color:#666;margin-top:2px">${log.username || "未知"}：${log.detail || ""}</div>
        </div>`;
      });
      html += '</div>';
      box.innerHTML = html;
    }
    openModal("modal-oplog");
  } catch(e) {
    console.error("操作日志错误:", e);
    showToast("加载失败: " + e.message);
  }
}

/* ---------- 多项目管理（使用Meta数据库） ---------- */
// 生成6位随机项目编码（大写字母+数字，排除易混淆字符）
function generateProjectCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 根据编码查找项目
async function findProjectByCode(code) {
  if (!code) return null;
  const projects = await metaGetAll();
  return projects.find(p => p.code && p.code.toUpperCase() === code.toUpperCase().trim());
}

// 确保所有项目都有编码
async function ensureAllProjectsHaveCode() {
  const projects = await metaGetAll();
  for (const p of projects) {
    if (!p.code) {
      // 默认项目使用固定编码，方便首次登录
      p.code = p.id === "default" ? "DEFAULT" : generateProjectCode();
      await metaPut(p);
    }
  }
}

async function createProject(name, remark) {
  const projectId = "proj_" + genId();
  const project = {
    id: projectId,
    name: name || "新项目",
    remark: remark || "",
    code: generateProjectCode(),
    createdAt: new Date().toISOString(),
    isActive: false
  };
  await metaPut(project);
  // 创建新项目的业务数据库（打开一次会自动创建表结构）
  await openDB(projectId);
  addOperationLog("create_project", `创建项目：${project.name}，编码：${project.code}`);
  showToast("项目已创建，编码：" + project.code);
  renderProjectList();
  if (typeof renderProjectSidebarList === 'function') renderProjectSidebarList();
  return project;
}

async function switchProject(projectId) {
  if (!await confirmDialog("切换项目将刷新页面，确定继续？")) return;
  const projects = await metaGetAll();
  for (const p of projects) {
    p.isActive = (p.id === projectId);
    await metaPut(p);
  }
  setCurrentProjectId(projectId);
  addOperationLog("switch_project", "切换项目");
  showToast("项目已切换，正在刷新...");
  setTimeout(() => location.reload(), 800);
}

async function deleteProject(projectId) {
  if (projectId === "default") {
    showToast("默认项目不能删除");
    return;
  }
  if (!await confirmDialog("确认删除该项目？项目下的所有数据（建筑、楼层、设备等）将被删除，无法恢复！")) return;
  await metaDel(projectId);
  // 删除对应的业务数据库
  try {
    const dbName = getBusinessDBName(projectId);
    indexedDB.deleteDatabase(dbName);
  } catch(e) { console.warn("删除业务数据库失败:", e); }
  addOperationLog("delete_project", "删除项目");
  renderProjectList();
  if (typeof renderProjectSidebarList === 'function') renderProjectSidebarList();
  showToast("项目已删除");
}

async function copyProject(sourceProjectId) {
  const newName = prompt("请输入新项目名称：", "");
  if (!newName || !newName.trim()) { showToast("已取消"); return; }
  showToast("正在复制项目数据，请稍候...");
  // 复制项目：把源项目的所有数据复制到新项目
  const sourceDBName = getBusinessDBName(sourceProjectId);
  const newProjectId = "proj_" + genId();

  // 创建新项目记录
  const sourceProjects = await metaGetAll();
  const source = sourceProjects.find(p => p.id === sourceProjectId);
  const newProject = {
    id: newProjectId,
    name: newName.trim(),
    remark: source?.remark ? source.remark + "（副本）" : "",
    code: generateProjectCode(),
    createdAt: new Date().toISOString(),
    isActive: false
  };
  await metaPut(newProject);

  // 打开源数据库和新数据库，复制所有表
  const stores = [SB, SF, SD, SL, SLEG, SIMG, SVEC, S_TASK, S_LOG, S_OPLOG];
  const sourceDB = await new Promise((res, rej) => {
    const r = indexedDB.open(sourceDBName, DB_VER);
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  });
  const newDB = await openDB(newProjectId);

  for (const store of stores) {
    try {
      const data = await new Promise(res => {
        const a = [];
        const r = sourceDB.transaction(store).objectStore(store).openCursor();
        r.onsuccess = e => { const c = e.target.result; if (c) { a.push(c.value); c.continue(); } else res(a); };
      });
      for (const item of data) {
        await new Promise(r => {
          const t = newDB.transaction(store, "readwrite");
          t.objectStore(store).put(item);
          t.oncomplete = r;
        });
      }
    } catch(e) { console.warn(`复制表 ${store} 失败:`, e); }
  }
  sourceDB.close();
  showToast("项目复制完成");
  renderProjectList();
  if (typeof renderProjectSidebarList === 'function') renderProjectSidebarList();
  return newProject;
}

async function renameProject(projectId) {
  const projects = await metaGetAll();
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  const newName = prompt("请输入新的项目名称：", p.name);
  if (!newName || !newName.trim()) { showToast("已取消"); return; }
  p.name = newName.trim();
  await metaPut(p);
  showToast("项目已重命名");
  renderProjectList();
  if (typeof renderProjectSidebarList === 'function') renderProjectSidebarList();
}

async function renderProjectList() {
  const box = $("project-list");
  if (!box) return;
  const projects = await metaGetAll();

  if (!projects.length) {
    box.innerHTML = '<div style="padding:16px;text-align:center;color:#999">暂无项目，点击上方按钮创建</div>';
    return;
  }

  let html = "";
  projects.forEach(p => {
    const activeBadge = p.isActive ? '<span style="background:#10b981;color:#fff;padding:2px 6px;border-radius:8px;font-size:10px">当前</span>' : '';
    const codeDisplay = p.code ? `<span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:4px;font-size:11px;font-family:monospace;letter-spacing:1px">${p.code}</span>` : '';
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:8px">
      <div style="flex:1">
        <div style="font-weight:bold;display:flex;align-items:center;gap:8px">${p.name} ${activeBadge} ${codeDisplay} <button class="btn small" style="padding:1px 6px;font-size:10px" onclick="copyProjectCode('${p.code}')" title="复制编码">📋</button></div>
        <div style="font-size:11px;color:#999">${p.remark || "无备注"}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn small" onclick="renameProject('${p.id}')" title="重命名">✏️</button>
        <button class="btn small" onclick="copyProject('${p.id}')" title="复制">📋</button>
        ${!p.isActive ? `<button class="btn small" onclick="switchProject('${p.id}')">切换</button>` : ''}
        ${p.id !== "default" ? `<button class="btn small del" onclick="deleteProject('${p.id}')">删除</button>` : ''}
      </div>
    </div>`;
  });
  box.innerHTML = html;
}

function copyProjectCode(code) {
  if (!code) { showToast("无编码"); return; }
  navigator.clipboard.writeText(code).then(() => {
    showToast("编码已复制：" + code);
  }).catch(() => {
    // 降级方案
    const ta = document.createElement('textarea');
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast("编码已复制：" + code);
  });
}

function openProjectManager() {
  renderProjectList();
  openModal("modal-project");
}

/* ---------- 侧边栏项目列表 ---------- */
async function renderProjectSidebarList() {
  const box = $("project-tree-container");
  if (!box) return;
  const projects = await metaGetAll();
  const currentId = getCurrentProjectId();

  // 更新项目数量
  const countEl = $("cat-project-count");
  if (countEl) countEl.innerText = projects.length;

  if (!projects.length) {
    box.innerHTML = '<div style="padding:12px;text-align:center;color:#64748b;font-size:12px">暂无项目</div>';
    return;
  }

  let html = "";
  projects.forEach(p => {
    const isActive = p.id === currentId;
    html += `<div class="tree-item ${isActive ? 'active' : ''}" style="padding:6px 8px;margin:2px 0;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;${isActive ? 'background:#334155' : ''}" 
      onclick="switchProjectFromSidebar('${p.id}')"
      ondblclick="editProjectNameInline('${p.id}', this)"
      title="单击切换，双击重命名">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">
        ${isActive ? '📂' : '📁'} <span class="project-name">${p.name}</span>
      </span>
      <span style="font-size:10px;color:#94a3b8;margin-left:4px;font-family:monospace">${p.code || ''}</span>
    </div>`;
  });
  box.innerHTML = html;
}

async function switchProjectFromSidebar(projectId) {
  const currentId = getCurrentProjectId();
  if (projectId === currentId) return;
  if (!await confirmDialog("切换项目将刷新页面，确定继续？")) return;
  switchProject(projectId);
}

function editProjectNameInline(projectId, element) {
  const nameSpan = element.querySelector('.project-name');
  if (!nameSpan) return;
  const oldName = nameSpan.innerText;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.style.cssText = 'width:100%;padding:2px 4px;font-size:13px;border:1px solid #3b82f6;border-radius:3px;background:#1e293b;color:#fff';
  nameSpan.style.display = 'none';
  nameSpan.parentNode.insertBefore(input, nameSpan);
  input.focus();
  input.select();

  async function save() {
    const newName = input.value.trim();
    if (newName && newName !== oldName) {
      const projects = await metaGetAll();
      const p = projects.find(x => x.id === projectId);
      if (p) {
        p.name = newName;
        await metaPut(p);
        showToast("项目已重命名");
      }
    }
    renderProjectSidebarList();
  }

  input.onblur = save;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = oldName; input.blur(); }
  };
  input.onclick = (e) => e.stopPropagation();
}

async function submitCreateProject() {
  const name = $("project-name-input").value.trim();
  if (!name) { showToast("请输入项目名称"); return; }
  const remark = $("project-remark-input").value.trim();
  await createProject(name, remark);
  $("project-name-input").value = "";
  $("project-remark-input").value = "";
}

/* ---------- 权限检查辅助 ---------- */
function requireAdmin(callback) {
  if (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin') {
    callback();
  } else {
    showToast("该功能仅管理员可用");
  }
}

function canEdit() {
  return typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin';
}

/* ---------- 记录登录/退出日志 ---------- */
function logLogin(user) {
  currentUser = user;
  addOperationLog("login", `用户登录：${user.username}`);
}

function logLogout() {
  addOperationLog("logout", "用户退出");
  currentUser = null;
}
