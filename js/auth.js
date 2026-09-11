/* ============================================================
 * auth.js - 注册与登录（多租户架构 + 角色权限）
 * 角色：super_admin=超级管理员（创建项目、管理所有项目）
 *       admin=项目管理员（管理单个项目）
 *       operator=操作员（仅使用单个项目）
 * ============================================================ */

const AUTH_USERS_KEY = "firemap_users";
const AUTH_CURRENT_KEY = "firemap_current_user";
const AUTH_CURRENT_ROLE_KEY = "firemap_current_role";
const AUTH_INVITE_KEY = "firemap_admin_invite";

// 默认管理员邀请码（可在控制台修改）
const DEFAULT_INVITE_CODE = "firemap-admin-2024";
let loginRole = "operator";

function getInviteCode() {
  try { return localStorage.getItem(AUTH_INVITE_KEY) || DEFAULT_INVITE_CODE; }
  catch (e) { return DEFAULT_INVITE_CODE; }
}

function getUsers() {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTH_USERS_KEY) || "{}");
    const users = {};
    for (const k in raw) {
      if (typeof raw[k] === 'string') users[k] = { password: raw[k], role: 'admin', projectId: null };
      else users[k] = raw[k];
    }
    return users;
  } catch (e) { return {}; }
}
function saveUsers(users) {
  try { localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users)); } catch (e) {}
}
function getCurrentUser() {
  try { return localStorage.getItem(AUTH_CURRENT_KEY); } catch (e) { return null; }
}
function getCurrentRole() {
  try { return localStorage.getItem(AUTH_CURRENT_ROLE_KEY) || 'operator'; } catch (e) { return 'operator'; }
}
function setCurrentUser(user, role) {
  try {
    if (user) {
      localStorage.setItem(AUTH_CURRENT_KEY, user);
      localStorage.setItem(AUTH_CURRENT_ROLE_KEY, role || 'operator');
    } else {
      localStorage.removeItem(AUTH_CURRENT_KEY);
      localStorage.removeItem(AUTH_CURRENT_ROLE_KEY);
    }
  } catch (e) {}
}

// 判断是否为超级管理员
function isSuperAdmin() {
  const user = getCurrentUser();
  if (!user) return false;
  const users = getUsers();
  return users[user] && users[user].role === 'super_admin';
}

// 判断是否为项目管理员（含超级管理员）
function isAdmin() {
  const role = getCurrentRole();
  return role === 'admin' || role === 'super_admin';
}

function showAuthLogin() {
  $("auth-login-form").style.display = "block";
  $("auth-register-form").style.display = "none";
}
function showAuthRegister() {
  $("auth-login-form").style.display = "none";
  $("auth-register-form").style.display = "block";
}
function checkAuth() {
  const user = getCurrentUser();
  if (!user) {
    $("auth-screen").classList.remove("hidden");
    showAuthLogin();
  } else {
    $("auth-screen").classList.add("hidden");
  }
}
function checkInviteCode() {
  const code = $("reg-invite").value.trim();
  const hint = $("reg-invite-hint");
  if (code === getInviteCode()) {
    hint.innerHTML = "✅ 邀请码正确，将注册为项目管理员";
    hint.style.color = "#10b981";
  } else if (code) {
    hint.innerHTML = "❌ 邀请码错误，将注册为操作员";
    hint.style.color = "#ef4444";
  } else {
    hint.innerHTML = "💡 不填邀请码默认为操作员；填写正确邀请码将注册为项目管理员";
    hint.style.color = "#666";
  }
}

async function checkLoginProjectCode() {
  const code = $("login-project-code").value.trim();
  const hint = $("login-code-hint");
  if (!hint) return;
  if (!code) {
    hint.style.display = "none";
    return;
  }
  hint.style.display = "block";
  if (code.length < 4) {
    hint.innerHTML = "⚠️ 请输入完整的项目编码";
    hint.style.color = "#f59e0b";
    return;
  }
  // 验证项目编码
  const project = await findProjectByCode(code);
  if (project) {
    hint.innerHTML = "✅ 项目：" + project.name;
    hint.style.color = "#10b981";
    // 正确后2秒自动消失
    setTimeout(() => {
      if ($("login-project-code").value.trim() === code) {
        hint.style.display = "none";
      }
    }, 2000);
  } else {
    hint.innerHTML = "❌ 项目编码错误";
    hint.style.color = "#ef4444";
  }
}

function checkUsername() {
  const user = $("reg-user").value.trim();
  const hint = $("reg-user-hint");
  if (!hint) return;
  if (!user) {
    hint.style.display = "none";
    return;
  }
  hint.style.display = "block";
  if (user.length < 3 || user.length > 20) {
    hint.innerHTML = "⚠️ 用户名需要3-20个字符";
    hint.style.color = "#f59e0b";
    return;
  }
  const users = getUsers();
  if (users[user]) {
    hint.innerHTML = "❌ 用户名已存在，请更换";
    hint.style.color = "#ef4444";
  } else {
    hint.innerHTML = "✅ 用户名可用";
    hint.style.color = "#10b981";
  }
}

function checkPassword() {
  const pass = $("reg-pass").value;
  const hint = $("reg-pass-hint");
  if (!hint) return;
  if (!pass) {
    hint.style.display = "none";
    return;
  }
  hint.style.display = "block";
  if (pass.length < 6) {
    hint.innerHTML = "⚠️ 密码至少6位";
    hint.style.color = "#f59e0b";
  } else if (pass.length < 10) {
    hint.innerHTML = "✅ 密码可用（建议增加字母和数字提高强度）";
    hint.style.color = "#10b981";
  } else {
    hint.innerHTML = "✅ 密码强度良好";
    hint.style.color = "#10b981";
  }
  // 密码改变时，重新检查确认密码
  if ($("reg-pass2").value) checkConfirmPassword();
}

function checkConfirmPassword() {
  const pass = $("reg-pass").value;
  const pass2 = $("reg-pass2").value;
  const hint = $("reg-pass2-hint");
  if (!hint) return;
  if (!pass2) {
    hint.style.display = "none";
    return;
  }
  hint.style.display = "block";
  if (pass !== pass2) {
    hint.innerHTML = "❌ 两次密码不一致";
    hint.style.color = "#ef4444";
  } else {
    hint.innerHTML = "✅ 密码一致";
    hint.style.color = "#10b981";
  }
}

async function doRegister() {
  try {
    const user = $("reg-user").value.trim();
    const pass = $("reg-pass").value;
    const pass2 = $("reg-pass2").value;
    const invite = $("reg-invite").value.trim();
    const projectCode = $("reg-project-code") ? $("reg-project-code").value.trim() : "";

    if (!user || !pass || !pass2) { showToast("请填写完整信息"); return; }
    if (user.length < 3 || user.length > 20) { showToast("用户名3-20个字符"); return; }
    if (pass.length < 6) { showToast("密码至少6位"); return; }
    if (pass !== pass2) { showToast("两次密码不一致"); return; }
    if (!projectCode) { showToast("请输入项目编码"); return; }

    // 验证项目编码
    const project = await findProjectByCode(projectCode);
    if (!project) { showToast("项目编码错误"); return; }

  const users = getUsers();
  if (users[user]) { showToast("用户名已存在，请更换"); return; }

  // 第一个用户自动成为超级管理员
  const isFirstUser = Object.keys(users).length === 0;
  const role = isFirstUser ? 'super_admin' : (invite === getInviteCode() ? 'admin' : 'operator');

  users[user] = {
    password: pass,
    role: role,
    projectId: isFirstUser ? null : project.id, // 超级管理员不绑定项目，可以访问所有项目
    createdAt: new Date().toISOString()
  };
  saveUsers(users);

  if (isFirstUser) {
    showToast("注册成功！您已成为超级管理员，可以创建和管理所有项目");
  } else {
    showToast("注册成功！已加入项目：" + project.name);
  }

  $("reg-user").value = ""; $("reg-pass").value = ""; $("reg-pass2").value = ""; $("reg-invite").value = "";
  showAuthLogin();
  $("login-user").value = user;
  $("login-project-code").value = projectCode;
  } catch(e) {
    console.error("注册错误:", e);
    showToast("注册失败: " + e.message);
  }
}

async function doLogin() {
  const projectCode = $("login-project-code") ? $("login-project-code").value.trim() : "";
  const user = $("login-user").value.trim();
  const pass = $("login-pass").value;
  const roleRadio = document.querySelector('input[name="login-role"]:checked');
  const wantRole = roleRadio ? roleRadio.value : 'operator';

  if (!projectCode) { showToast("请输入项目编码"); return; }
  if (!user || !pass) { showToast("请输入用户名和密码"); return; }

  // 验证项目编码
  const project = await findProjectByCode(projectCode);
  if (!project) { showToast("项目编码错误，请检查后重试"); return; }

  const users = getUsers();
  if (!users[user]) { showToast("用户不存在"); return; }
  const info = users[user];
  if (info.password !== pass) { showToast("密码错误"); return; }

  // 权限验证：超级管理员可以访问任何项目，其他用户必须绑定到该项目
  if (info.role !== 'super_admin' && info.projectId !== project.id) {
    showToast("您无权访问该项目");
    return;
  }

  // 如果选择管理员登录，需要验证用户角色是管理员或超级管理员
  if (wantRole === 'admin' && info.role === 'operator') {
    showToast("该账号无管理员权限，请以操作员身份登录");
    return;
  }

  // 登录身份：选择管理员且用户是管理员/超级管理员 -> admin；否则 operator
  // 超级管理员登录后角色为 super_admin
  const loginAs = info.role === 'super_admin' ? 'super_admin' : ((wantRole === 'admin' && (info.role === 'admin' || info.role === 'super_admin')) ? 'admin' : 'operator');

  // 如果项目变了，先切换项目
  const oldProjectId = getCurrentProjectId();
  if (project.id !== oldProjectId) {
    const projects = await metaGetAll();
    for (const p of projects) {
      p.isActive = (p.id === project.id);
      await metaPut(p);
    }
    setCurrentProjectId(project.id);
  }

  setCurrentUser(user, loginAs);
  $("auth-screen").classList.add("hidden");

  const roleText = loginAs === 'super_admin' ? '超级管理员' : (loginAs === 'admin' ? '管理员' : '操作员');
  showToast("欢迎回来，" + user + "（" + roleText + "）");
  updateAuthUserDisplay();
  updateRoleUI();

  // 操作员自动退出管理模式
  if (loginAs === 'operator' && typeof manageMode !== 'undefined' && manageMode) {
    manageMode = false;
    if ($("btn-mode")) $("btn-mode").innerText = "🔧管理模式";
    document.body.classList.remove("manage-mode");
    if (typeof renderDeviceMarkers === 'function') renderDeviceMarkers();
  }

  // 如果项目变了，刷新页面加载新项目数据
  if (project.id !== oldProjectId) {
    showToast("已切换到项目：" + project.name + "，正在刷新...");
    setTimeout(() => location.reload(), 800);
  }
  setTimeout(() => { if (typeof map !== 'undefined' && map) map.invalidateSize(); }, 100);
}

async function doLogout() {
  if (!await confirmDialog("确定退出登录吗？")) return;
  setCurrentUser(null);
  $("login-user").value = "";
  $("login-pass").value = "";
  $("login-project-code").value = "";
  const opRadio = document.querySelector('input[name="login-role"][value="operator"]');
  if (opRadio) opRadio.checked = true;
  loginRole = "operator";
  showAuthLogin();
  $("auth-screen").classList.remove("hidden");
  if (typeof logLogout === 'function') logLogout();
}

function updateAuthUserDisplay() {
  const user = getCurrentUser();
  const role = getCurrentRole();
  const el = $("current-user-display");
  if (el) {
    const roleIcon = role === 'super_admin' ? '👑' : (role === 'admin' ? '🛡️' : '👤');
    el.innerHTML = `${roleIcon} ${user || '未登录'}`;
  }
}

function updateRoleUI() {
  const role = getCurrentRole();
  const isOperator = role === 'operator';

  // 项目管理只对超级管理员可见
  const projectBtn = document.querySelector('[onclick="openProjectManager()"]');
  if (projectBtn) {
    projectBtn.style.display = role === 'super_admin' ? '' : 'none';
  }
  // 管理模式按钮：管理员和超级管理员可见，操作员隐藏
  const modeBtn = $("btn-mode");
  if (modeBtn) {
    modeBtn.style.display = isOperator ? 'none' : '';
  }
  // 批量操作菜单：管理员和超级管理员可见
  const batchBtn = document.querySelector('[onclick="openModal(\'modal-batch\')"]');
  if (batchBtn) {
    batchBtn.style.display = isOperator ? 'none' : '';
  }
  // 建筑楼层新增按钮
  document.querySelectorAll('[onclick="showAddBuilding()"], [onclick="showAddFloor()"]').forEach(btn => {
    btn.style.display = isOperator ? 'none' : '';
  });
  // 图例配置新增按钮
  document.querySelectorAll('[onclick="showAddLegendItem()"], [onclick="toggleLegendOnMap()"]').forEach(btn => {
    btn.style.display = isOperator ? 'none' : '';
  });
  // 数据备份中的编辑操作（导入、清空、撤销）
  document.querySelectorAll('[onclick="importJSONBackup()"], [onclick="clearAllData()"], [onclick="undoLast()"]').forEach(btn => {
    btn.style.display = isOperator ? 'none' : '';
  });
  // 维保巡检管理按钮
  document.querySelectorAll('[onclick="openModal(\'modal-inspect-task\')"], [onclick="openModal(\'modal-create-task\')"], [onclick="openModal(\'modal-maintain-reminder\')"]').forEach(btn => {
    btn.style.display = isOperator ? 'none' : '';
  });
  // 矢量图编辑工具栏
  const vecToolbar = $("vector-toolbar");
  if (vecToolbar) {
    vecToolbar.style.display = isOperator ? 'none' : '';
  }
  // 比例尺编辑
  const scaleBtn = document.querySelector('[onclick="toggleScaleIndicator()"]');
  if (scaleBtn) {
    scaleBtn.style.display = isOperator ? 'none' : '';
  }
  // 拖拽图例提示
  const dragTip = $("legend-drag-tip");
  if (dragTip) {
    dragTip.style.display = isOperator ? 'none' : '';
  }
}

/* ---------- 账号管理 ---------- */
function openAccountManager() {
  const user = getCurrentUser();
  const role = getCurrentRole();
  const users = getUsers();
  const info = users[user] || {};

  // 显示当前用户信息
  const roleText = role === 'super_admin' ? '👑 超级管理员' : (role === 'admin' ? '🛡️ 项目管理员' : '👤 操作员');
  const projectText = info.projectId ? info.projectId : '全部项目（超级管理员）';
  $("account-current-info").innerHTML = `
    <div>用户名：<b>${user}</b></div>
    <div>角色：<b>${roleText}</b></div>
    <div>所属项目：<b>${projectText}</b></div>
  `;

  // 清空密码输入框
  $("account-old-pass").value = "";
  $("account-new-pass").value = "";

  // 管理员显示用户列表
  const isAdmin = role === 'super_admin' || role === 'admin';
  $("account-user-list-section").style.display = isAdmin ? 'block' : 'none';
  if (isAdmin) renderAccountUserList();

  openModal('modal-account');
}

function changePassword() {
  const user = getCurrentUser();
  const oldPass = $("account-old-pass").value;
  const newPass = $("account-new-pass").value;
  const users = getUsers();

  if (!oldPass || !newPass) { showToast("请填写原密码和新密码"); return; }
  if (newPass.length < 6) { showToast("新密码至少6位"); return; }
  if (users[user].password !== oldPass) { showToast("原密码错误"); return; }

  users[user].password = newPass;
  saveUsers(users);
  $("account-old-pass").value = "";
  $("account-new-pass").value = "";
  showToast("密码修改成功");
}

function renderAccountUserList() {
  const users = getUsers();
  const currentUser = getCurrentUser();
  const currentRole = getCurrentRole();
  const box = $("account-user-list");
  if (!box) return;

  // 把当前用户放到第一排
  const userNames = Object.keys(users).sort((a, b) => {
    if (a === currentUser) return -1;
    if (b === currentUser) return 1;
    return 0;
  });

  // 获取所有项目（超级管理员才能修改项目分配）
  let projects = [];
  if (currentRole === 'super_admin' && typeof metaGetAll === 'function') {
    metaGetAll().then(projs => {
      projects = projs;
      doRender();
    });
  } else {
    doRender();
  }

  function doRender() {
    let html = "";
    userNames.forEach(name => {
      const u = users[name];
      const roleIcon = u.role === 'super_admin' ? '👑' : (u.role === 'admin' ? '🛡️' : '👤');
      const roleText = u.role === 'super_admin' ? '超级管理员' : (u.role === 'admin' ? '管理员' : '操作员');
      const isCurrent = name === currentUser;
      const canDelete = !isCurrent && currentRole === 'super_admin';
      const canChangeRole = currentRole === 'super_admin' && u.role !== 'super_admin';
      const canChangeProject = currentRole === 'super_admin' && u.role !== 'super_admin';

      // 项目选择下拉框
      let projectSelect = '';
      if (canChangeProject && projects.length > 0) {
        projectSelect = `<select onchange="changeAccountUserProject('${name}', this.value)" style="font-size:11px;padding:3px;width:120px">
          ${projects.map(p => `<option value="${p.id}" ${u.projectId === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>`;
      } else {
        const projName = projects.find(p => p.id === u.projectId)?.name || (u.projectId ? u.projectId : '全部项目');
        projectSelect = `<span style="font-size:11px;color:#666;display:inline-block;width:120px">${projName}</span>`;
      }

      // 角色选择下拉框
      let roleSelect = '';
      if (canChangeRole) {
        roleSelect = `<select onchange="changeAccountUserRole('${name}', this.value)" style="font-size:11px;padding:3px;width:80px">
          <option value="operator" ${u.role === 'operator' ? 'selected' : ''}>操作员</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option>
        </select>`;
      } else {
        roleSelect = `<span style="font-size:11px;color:#666;display:inline-block;width:80px">${roleText}</span>`;
      }

      html += `<div style="display:flex;align-items:center;padding:10px 14px;border:1px solid ${isCurrent ? '#3b82f6' : '#e5e7eb'};border-radius:6px;margin-bottom:8px;background:${isCurrent ? '#eff6ff' : 'transparent'}">
        <div style="flex:0 0 150px;min-width:0">
          <div style="font-size:13px;font-weight:bold;white-space:nowrap">${roleIcon} ${name}</div>
          ${isCurrent ? '<div style="color:#3b82f6;font-size:11px;white-space:nowrap;margin-top:2px">（当前登录）</div>' : ''}
        </div>
        <div style="flex:1;display:flex;align-items:center;gap:4px;justify-content:center">
          <span style="font-size:12px;color:#999;white-space:nowrap">项目:</span>
          ${projectSelect}
        </div>
        <div style="flex:1;display:flex;align-items:center;gap:6px;justify-content:flex-end">
          <span style="font-size:12px;color:#999;white-space:nowrap">角色:</span>
          ${roleSelect}
          ${canDelete ? `<button class="btn small del" onclick="deleteAccountUser('${name}')" style="flex-shrink:0">删除</button>` : ''}
        </div>
      </div>`;
    });
    box.innerHTML = html || '<div style="text-align:center;color:#999;padding:16px">暂无用户</div>';
  }
}

function addAccountUser() {
  const name = $("account-new-user").value.trim();
  const pass = $("account-new-pass2").value;
  const role = $("account-new-role").value;
  const currentUser = getCurrentUser();
  const users = getUsers();
  const currentInfo = users[currentUser] || {};

  if (!name || !pass) { showToast("请填写用户名和密码"); return; }
  if (name.length < 3 || name.length > 20) { showToast("用户名3-20个字符"); return; }
  if (pass.length < 6) { showToast("密码至少6位"); return; }
  if (users[name]) { showToast("用户名已存在"); return; }

  users[name] = {
    password: pass,
    role: role,
    projectId: currentInfo.projectId || null, // 新用户绑定到当前管理员的项目
    createdAt: new Date().toISOString()
  };
  saveUsers(users);

  $("account-new-user").value = "";
  $("account-new-pass2").value = "";
  showToast("用户添加成功");
  renderAccountUserList();
}

async function deleteAccountUser(name) {
  if (!await confirmDialog(`确认删除用户「${name}」？`)) return;
  const users = getUsers();
  delete users[name];
  saveUsers(users);
  showToast("用户已删除");
  renderAccountUserList();
}

function changeAccountUserRole(name, newRole) {
  const users = getUsers();
  if (!users[name]) return;
  users[name].role = newRole;
  saveUsers(users);
  showToast(`已将「${name}」改为${newRole === 'admin' ? '管理员' : '操作员'}`);
  renderAccountUserList();
}

function changeAccountUserProject(name, projectId) {
  const users = getUsers();
  if (!users[name]) return;
  users[name].projectId = projectId;
  saveUsers(users);
  showToast(`已将「${name}」分配到新项目`);
  renderAccountUserList();
}

/* ---------- 侧边栏分类名称自定义（仅超级管理员） ---------- */
const CAT_TITLE_KEY = "firemap_cat_titles";

function getCategoryTitles() {
  try { return JSON.parse(localStorage.getItem(CAT_TITLE_KEY) || "{}"); }
  catch (e) { return {}; }
}
function saveCategoryTitles(titles) {
  try { localStorage.setItem(CAT_TITLE_KEY, JSON.stringify(titles)); } catch (e) {}
}

function applyCategoryTitles() {
  const titles = getCategoryTitles();
  document.querySelectorAll('.cat-title').forEach(el => {
    const cat = el.dataset.cat;
    if (titles[cat]) el.innerText = titles[cat];
  });
}

function initCategoryTitleEdit() {
  // 只有超级管理员可以编辑
  if (!isSuperAdmin()) return;

  document.querySelectorAll('.cat-title').forEach(el => {
    el.style.cursor = 'text';
    el.title = '双击编辑名称';
    // 阻止mousedown冒泡，避免触发父元素的click
    el.addEventListener('mousedown', function(e) {
      e.stopPropagation();
    });
    el.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      e.preventDefault();
      const cat = this.dataset.cat;
      const oldName = this.innerText;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = oldName;
      input.style.cssText = 'width:100px;padding:2px 6px;font-size:14px;border:1px solid #3b82f6;border-radius:4px;background:#1e293b;color:#fff';
      this.style.display = 'none';
      this.parentNode.insertBefore(input, this);
      input.focus();
      input.select();

      function save() {
        const newName = input.value.trim();
        if (newName && newName !== oldName) {
          const titles = getCategoryTitles();
          titles[cat] = newName;
          saveCategoryTitles(titles);
          this.innerText = newName;
          showToast("分类名称已更新");
        }
        this.style.display = '';
        input.remove();
      }

      input.onblur = save.bind(this);
      input.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = oldName; input.blur(); }
      };
      input.onclick = (e) => e.stopPropagation();
      input.onmousedown = (e) => e.stopPropagation();
    });
  });
}
