/* ============================================================
 * form.js - 自定义表单引擎（参考凡尔赛表单编辑器设计）
 * 功能：表单管理、分组管理、字段设计器、表单渲染器、表单数据存储
 * ============================================================ */

// 字段类型按业务语义分类（参考专业巡检表单设计器）
const FIELD_CATEGORIES = [
  {
    key: "filler", label: "填表人信息", icon: "👤",
    types: [
      { type: "name", label: "姓名", icon: "👤" },
      { type: "phone", label: "电话", icon: "📞" },
      { type: "idcard", label: "身份证号", icon: "🪪" },
      { type: "employeeId", label: "工号", icon: "🎫" },
      { type: "licensePlate", label: "车牌", icon: "🚗" },
      { type: "gender", label: "性别", icon: "⚧" }
    ]
  },
  {
    key: "basic", label: "基本类", icon: "📋",
    types: [
      { type: "text", label: "文本框", icon: "📝" },
      { type: "autoNumber", label: "自动编号", icon: "🔢" },
      { type: "image", label: "图片", icon: "🖼️" },
      { type: "video", label: "视频", icon: "🎬" },
      { type: "audio", label: "录音", icon: "🎙️" },
      { type: "file", label: "文件", icon: "📎" },
      { type: "location", label: "定位", icon: "📍" },
      { type: "signature", label: "手写签名", icon: "✍️" },
      { type: "hazard", label: "隐患", icon: "⚠️" },
      { type: "weather", label: "天气", icon: "🌤️" },
      { type: "temperature", label: "温度", icon: "🌡️" },
      { type: "humidity", label: "湿度", icon: "💧" },
      { type: "wind", label: "风向风力", icon: "🌬️" },
      { type: "weekday", label: "星期", icon: "📅" },
      { type: "rectification", label: "整改建议", icon: "🛠️" },
      { type: "richText", label: "富文本", icon: "📰" },
      { type: "department", label: "部门", icon: "🏢" },
      { type: "rating", label: "评分", icon: "⭐" },
      { type: "textarea", label: "多行文本框", icon: "📄" },
      { type: "radio", label: "单选", icon: "🔘" },
      { type: "checkbox", label: "多选", icon: "☑️" }
    ]
  },
  {
    key: "datetime", label: "日期时间", icon: "⏰",
    types: [
      { type: "timeRange", label: "时间区间", icon: "⏱️" },
      { type: "dateCalc", label: "日期计算", icon: "🧮" },
      { type: "date", label: "日期", icon: "📆" },
      { type: "dateRange", label: "日期区间", icon: "📅" },
      { type: "time", label: "时间", icon: "⏰" }
    ]
  },
  {
    key: "formula", label: "公式计算", icon: "ƒ",
    types: [
      { type: "fixedValue", label: "固定数值", icon: "🔒" },
      { type: "globalFormula", label: "全局公式", icon: "🌐" },
      { type: "number", label: "数值输入框", icon: "🔢" },
      { type: "formula", label: "公式", icon: "ƒ" }
    ]
  },
  {
    key: "data", label: "数据控制", icon: "📊",
    types: [
      { type: "progress", label: "进度条", icon: "📶" },
      { type: "pastRecords", label: "往期记录", icon: "📜" }
    ]
  },
  {
    key: "inventory", label: "库存管理", icon: "📦",
    types: [
      { type: "relatedData", label: "关联基础数据", icon: "🔗" },
      { type: "stockIn", label: "入库", icon: "📥" },
      { type: "stockOut", label: "出库", icon: "📤" },
      { type: "inventoryCheck", label: "盘点", icon: "✅" },
      { type: "warehouse", label: "仓库", icon: "🏭" },
      { type: "warehouseTransfer", label: "仓库转移", icon: "🔄" }
    ]
  },
  {
    key: "area", label: "管理区域", icon: "🗺️",
    types: [
      { type: "area", label: "区域", icon: "📍" },
      { type: "areaTree", label: "区域树", icon: "🌳" }
    ]
  },
  {
    key: "attachment", label: "附件", icon: "📎",
    types: [
      { type: "attachment", label: "附件", icon: "📎" }
    ]
  }
];

// 兼容旧代码：扁平化字段类型列表（含已废弃但保留的类型）
const FIELD_TYPES = (function() {
  const list = [];
  FIELD_CATEGORIES.forEach(cat => cat.types.forEach(t => list.push(t)));
  // 保留旧版兼容类型
  list.push({ type: "datetime", label: "日期时间", icon: "📆" });
  list.push({ type: "select", label: "下拉单选", icon: "📋" });
  list.push({ type: "switch", label: "开关(是/否)", icon: "🔀" });
  return list;
})();

// 分类折叠状态
let fieldCategoryCollapsed = {};

// 分组颜色选项
const GROUP_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#a16207",
  "#22c55e", "#a855f7", "#8b5cf6", "#06b6d4",
  "#3b82f6", "#1f2937", "#6b7280", "#ffffff"
];

// 表单分类
const FORM_CATEGORIES = [
  { value: "inspect", label: "巡检表", icon: "🔍" },
  { value: "workorder", label: "维保记录表", icon: "🔧" },
  { value: "accept", label: "验收记录表", icon: "✅" },
  { value: "check", label: "设备检查表", icon: "📋" },
  { value: "other", label: "其他", icon: "📄" }
];

// 当前编辑的表单和撤销快照
let currentEditingForm = null;
let currentEditingGroupIndex = -1;
let currentEditingFieldIndex = -1;
let formEditSnapshot = null; // 用于撤销本次编辑

/* ---------- 数据迁移：旧版 fields -> 新版 groups ---------- */
function migrateFormData(form) {
  if (!form) return form;
  // 如果已经有 groups，直接返回
  if (form.groups && Array.isArray(form.groups)) return form;
  // 旧版有 fields，迁移到默认分组
  if (form.fields && Array.isArray(form.fields)) {
    form.groups = [{
      id: "group_" + genId(),
      name: "默认分组",
      color: "#3b82f6",
      description: "",
      visible: true,
      fields: form.fields
    }];
    delete form.fields;
  } else {
    form.groups = [];
  }
  return form;
}

/* ---------- 表单管理 ---------- */

// 打开表单管理弹窗
async function openFormManager() {
  await renderFormList();
  openModal("modal-form-manager");
}

// 渲染表单列表
async function renderFormList() {
  let forms = await dbGetAll(S_FORM);
  forms = forms.map(migrateFormData);
  const container = document.getElementById("form-list-container");
  if (!container) return;
  
  if (forms.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#999">暂无表单，点击右上角"新建表单"创建</div>';
    return;
  }
  
  let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">';
  forms.forEach(form => {
    const cat = FORM_CATEGORIES.find(c => c.value === form.category) || FORM_CATEGORIES[4];
    const fieldCount = (form.groups || []).reduce((sum, g) => sum + (g.fields || []).length, 0);
    const groupCount = (form.groups || []).length;
    const statusText = form.status === "active" ? "启用中" : "已停用";
    const statusColor = form.status === "active" ? "#10b981" : "#9ca3af";
    html += `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;transition:all .2s;cursor:pointer;position:relative" 
           onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,.1)'" 
           onmouseout="this.style.boxShadow='none'"
           onclick="editForm('${form.id}')">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div style="font-size:16px;font-weight:600;color:#1f2937">${cat.icon} ${form.name}</div>
          <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${statusColor}22;color:${statusColor}">${statusText}</span>
        </div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:8px">${form.description || '暂无描述'}</div>
        <div style="display:flex;gap:12px;font-size:12px;color:#9ca3af">
          <span>📁 ${groupCount} 个分组</span>
          <span>📝 ${fieldCount} 个字段</span>
        </div>
        <button style="position:absolute;bottom:12px;right:12px;width:28px;height:28px;border-radius:50%;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;font-size:14px;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;line-height:1"
                onmouseover="this.style.background='#fee2e2';this.style.borderColor='#fca5a5';this.style.transform='scale(1.1)'"
                onmouseout="this.style.background='#fef2f2';this.style.borderColor='#fecaca';this.style.transform='scale(1)'"
                onclick="event.stopPropagation();deleteForm('${form.id}')" title="删除表单">✕</button>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

// 新建表单
async function createNewForm() {
  currentEditingForm = {
    id: "form_" + genId(),
    name: "",
    description: "",
    projectId: "",
    category: "inspect",
    status: "active",
    tags: [],
    resultHidden: false,
    resultDesc: "结果",
    resultType: "statusGroup",
    resultStatusGroup: "",
    groups: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  currentEditingGroupIndex = -1;
  currentEditingFieldIndex = -1;
  formEditSnapshot = JSON.stringify(currentEditingForm);
  initFieldTypePicker();
  await renderFormEditor();
  document.getElementById("form-editor-title").innerText = "新建表单";
  openModal("modal-form-editor");
}

// 编辑表单
async function editForm(formId) {
  let forms = await dbGetAll(S_FORM);
  let form = forms.find(f => f.id === formId);
  if (!form) { showToast("表单不存在"); return; }
  form = migrateFormData(JSON.parse(JSON.stringify(form)));
  currentEditingForm = form;
  currentEditingGroupIndex = -1;
  currentEditingFieldIndex = -1;
  formEditSnapshot = JSON.stringify(currentEditingForm);
  initFieldTypePicker();
  await renderFormEditor();
  document.getElementById("form-editor-title").innerText = "编辑表单";
  openModal("modal-form-editor");
}

// 撤销本次编辑
async function undoFormEdit() {
  if (!formEditSnapshot) { showToast("没有可撤销的修改"); return; }
  const ok = await confirmDialog("确定撤销本次编辑？所有未保存的修改将丢失。");
  if (!ok) return;
  currentEditingForm = JSON.parse(formEditSnapshot);
  currentEditingGroupIndex = -1;
  currentEditingFieldIndex = -1;
  await renderFormEditor();
  showToast("已撤销本次编辑");
}

// 渲染表单编辑器
async function renderFormEditor() {
  const form = currentEditingForm;
  if (!form) return;
  
  document.getElementById("form-name-input").value = form.name || "";
  
  // 加载富文本说明
  const richEditor = document.getElementById("form-desc-richtext");
  if (richEditor) richEditor.innerHTML = form.description || "";
  
  document.getElementById("form-category-select").value = form.category || "inspect";
  document.getElementById("form-status-select").value = form.status || "active";
  
  // 加载所属项目选项（从建筑表加载）
  const projectSelect = document.getElementById("form-project-select");
  if (projectSelect) {
    try {
      const buildings = await dbGetAll(SB);
      let opts = '<option value="">请选择项目</option>';
      buildings.forEach(b => {
        opts += `<option value="${b.id}" ${form.projectId === b.id ? 'selected' : ''}>${b.name}</option>`;
      });
      projectSelect.innerHTML = opts;
    } catch(e) {
      projectSelect.innerHTML = '<option value="">请选择项目</option>';
    }
  }
  
  // 渲染标签
  renderFormTags();
  
  // 加载表单结果设置
  const resultHidden = document.getElementById("form-result-hidden");
  if (resultHidden) {
    resultHidden.checked = form.resultHidden === true;
    toggleResultHiddenSwitch(resultHidden);
  }
  const resultDesc = document.getElementById("form-result-desc");
  if (resultDesc) resultDesc.value = form.resultDesc || "结果";
  const resultType = document.getElementById("form-result-type");
  if (resultType) resultType.value = form.resultType || "statusGroup";
  const resultStatusGroup = document.getElementById("form-result-status-group");
  if (resultStatusGroup) resultStatusGroup.value = form.resultStatusGroup || "";
  onResultTypeChange(form.resultType || "statusGroup");
  
  renderGroupList();
  renderFieldEditor();
}

/* ---------- 表单结果设置 ---------- */

// 折叠/展开结果设置
function toggleResultSettings() {
  const body = document.getElementById("result-settings-body");
  const arrow = document.getElementById("result-settings-arrow");
  if (!body || !arrow) return;
  if (body.style.display === "none") {
    body.style.display = "block";
    arrow.style.transform = "rotate(90deg)";
  } else {
    body.style.display = "none";
    arrow.style.transform = "rotate(0deg)";
  }
}

// 结果隐藏开关视觉切换
function toggleResultHiddenSwitch(checkbox) {
  const slider = document.getElementById("result-hidden-slider");
  const label = document.getElementById("result-hidden-label");
  if (!slider) return;
  if (checkbox.checked) {
    slider.style.background = "#10b981";
    slider.querySelector("span").style.transform = "translateX(22px)";
    if (label) { label.textContent = "是"; label.style.color = "#10b981"; }
  } else {
    slider.style.background = "#ccc";
    slider.querySelector("span").style.transform = "translateX(0)";
    if (label) { label.textContent = "否"; label.style.color = "#9ca3af"; }
  }
}

// 结果类型变化时显示/隐藏状态组输入
function onResultTypeChange(type) {
  const statusGroupInput = document.getElementById("form-result-status-group");
  if (!statusGroupInput) return;
  if (type === "statusGroup") {
    statusGroupInput.style.display = "";
  } else {
    statusGroupInput.style.display = "none";
  }
}

/* ---------- 富文本编辑器 ---------- */

function richTextExec(command, value) {
  const editor = document.getElementById("form-desc-richtext");
  if (!editor) return;
  editor.focus();
  if (command === "fontSize") {
    // fontSize 用 1-7，转换为像素
    document.execCommand("fontSize", false, value);
  } else if (command === "formatBlock") {
    document.execCommand("formatBlock", false, value);
  } else {
    document.execCommand(command, false, value || null);
  }
}

function richTextInsertEmoji() {
  const emojis = ["😊","😂","😍","🤔","👍","👎","🔥","⭐","✅","❌","⚠️","📌","💡","🎉","🏆"];
  const picker = document.createElement("div");
  picker.style.cssText = "position:fixed;z-index:99999;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);display:flex;flex-wrap:wrap;gap:4px;max-width:200px";
  emojis.forEach(e => {
    const btn = document.createElement("span");
    btn.textContent = e;
    btn.style.cssText = "font-size:18px;cursor:pointer;padding:4px;border-radius:4px";
    btn.onmouseover = () => btn.style.background = "#f0f0f0";
    btn.onmouseout = () => btn.style.background = "transparent";
    btn.onclick = () => {
      document.execCommand("insertText", false, e);
      picker.remove();
    };
    picker.appendChild(btn);
  });
  document.body.appendChild(picker);
  // 定位到编辑器附近
  const editor = document.getElementById("form-desc-richtext");
  if (editor) {
    const rect = editor.getBoundingClientRect();
    picker.style.top = (rect.top - 50) + "px";
    picker.style.left = rect.left + "px";
  }
  // 点击其他地方关闭
  setTimeout(() => {
    document.addEventListener("click", function closePicker(e) {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener("click", closePicker);
      }
    });
  }, 10);
}

function richTextInsertImage() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      document.execCommand("insertImage", false, e.target.result);
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

/* ---------- 表单标签 ---------- */

function addFormTag() {
  const tagName = prompt("请输入标签名称：");
  if (!tagName || !tagName.trim()) return;
  if (!currentEditingForm.tags) currentEditingForm.tags = [];
  currentEditingForm.tags.push(tagName.trim());
  currentEditingForm.updatedAt = new Date().toISOString();
  renderFormTags();
}

function removeFormTag(idx) {
  if (!currentEditingForm.tags) return;
  currentEditingForm.tags.splice(idx, 1);
  currentEditingForm.updatedAt = new Date().toISOString();
  renderFormTags();
}

function renderFormTags() {
  const container = document.getElementById("form-tags-container");
  if (!container) return;
  let html = "";
  (currentEditingForm.tags || []).forEach((tag, idx) => {
    html += `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;font-size:12px;color:#0d9488">
      ${tag}
      <span onclick="removeFormTag(${idx})" style="cursor:pointer;font-weight:bold;margin-left:2px" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#0d9488'">×</span>
    </span>`;
  });
  html += `<button onclick="addFormTag()" style="padding:3px 10px;background:#fff;border:1px solid #d9d9d9;border-radius:12px;font-size:12px;cursor:pointer;color:#666" onmouseover="this.style.borderColor='#14b8a6';this.style.color='#14b8a6'" onmouseout="this.style.borderColor='#d9d9d9';this.style.color='#666'">+ 新标签</button>`;
  container.innerHTML = html;
}

/* ---------- 分组管理 ---------- */

// 添加分组
function addGroup(groupType) {
  if (!currentEditingForm.groups) currentEditingForm.groups = [];
  const typeLabels = { default: "默认分组", subform: "子表单分组", inspection: "检查项分组" };
  const typeColors = { default: "#3b82f6", subform: "#8b5cf6", inspection: "#10b981" };
  const gType = groupType || "default";
  const newGroup = {
    id: "group_" + genId(),
    name: (typeLabels[gType] || "分组") + (currentEditingForm.groups.length + 1),
    groupType: gType,
    color: typeColors[gType] || GROUP_COLORS[currentEditingForm.groups.length % GROUP_COLORS.length],
    description: "",
    visible: true,
    fields: []
  };
  currentEditingForm.groups.push(newGroup);
  currentEditingGroupIndex = currentEditingForm.groups.length - 1;
  currentEditingFieldIndex = -1;
  currentEditingForm.updatedAt = new Date().toISOString();
  renderGroupList();
  renderFieldEditor();
}

// 渲染分组列表（含字段）
function renderGroupList() {
  const form = currentEditingForm;
  const container = document.getElementById("form-fields-list");
  if (!container) return;
  
  if (!form.groups || form.groups.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px 20px;color:#9ca3af;font-size:13px">
        <div style="font-size:40px;margin-bottom:12px">📋</div>
        <div style="margin-bottom:4px">暂无分组</div>
        <div style="font-size:12px;color:#d1d5db">点击下方按钮新增分组，从左侧控件库添加字段</div>
      </div>`;
    return;
  }
  
  let html = "";
  form.groups.forEach((group, gIdx) => {
    const isGroupActive = gIdx === currentEditingGroupIndex;
    
    // 分组标题栏：分组名称输入 + 操作图标
    html += `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;margin-top:${gIdx > 0 ? '20px' : '0'};background:${isGroupActive ? '#f0f9ff' : '#fafafa'};border:1px solid ${isGroupActive ? '#7dd3fc' : '#e5e7eb'};border-radius:8px 8px 0 0">
        <span style="width:10px;height:10px;border-radius:2px;background:${group.color || '#3b82f6'};flex-shrink:0"></span>
        <label style="font-size:13px;color:#374151;white-space:nowrap;flex-shrink:0">分组名称：</label>
        <input type="text" value="${group.name || ''}" 
               style="flex:1;min-width:0;padding:5px 10px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;box-sizing:border-box"
               onchange="updateGroupName(this.value)"
               placeholder="分组名称"/>
        ${group.groupType && group.groupType !== 'default' ? `<span style="font-size:10px;padding:1px 8px;border-radius:10px;background:${group.groupType === 'subform' ? '#ede9fe' : '#d1fae5'};color:${group.groupType === 'subform' ? '#7c3aed' : '#059669'};white-space:nowrap;flex-shrink:0">${group.groupType === 'subform' ? '子表单' : '检查项'}</span>` : ''}
        <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;margin-left:4px">
          <button onclick="event.stopPropagation();moveGroup(${gIdx},-1)" style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;font-size:13px;color:#6b7280;border-radius:4px;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='transparent'" title="上移">▲</button>
          <button onclick="event.stopPropagation();moveGroup(${gIdx},1)" style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;font-size:13px;color:#6b7280;border-radius:4px;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='transparent'" title="下移">▼</button>
          <button onclick="event.stopPropagation();toggleGroupVisible(${gIdx})" style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;font-size:13px;color:${group.visible === false ? '#d1d5db' : '#6b7280'};border-radius:4px;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='transparent'" title="${group.visible === false ? '显示' : '隐藏'}">${group.visible === false ? '🚫' : '👁'}</button>
          <button onclick="event.stopPropagation();copyGroup(${gIdx})" style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;font-size:13px;color:#6b7280;border-radius:4px;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='transparent'" title="复制分组">🧬</button>
          <button onclick="event.stopPropagation();deleteGroup(${gIdx})" style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;font-size:13px;color:#ef4444;border-radius:4px;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='#fee2e2'" onmouseout="this.style.background='transparent'" title="删除分组">🗑</button>
        </div>
      </div>`;
    
    // 分组内字段列表
    html += `<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#fff;overflow:hidden">`;
    
    if (!group.fields || group.fields.length === 0) {
      html += `<div style="text-align:center;padding:20px;color:#d1d5db;font-size:12px">从左侧控件库点击添加字段</div>`;
    } else {
      group.fields.forEach((field, fIdx) => {
        const isFieldActive = (gIdx === currentEditingGroupIndex && fIdx === currentEditingFieldIndex);
        const requiredMark = field.required ? '<span style="color:#ef4444;font-weight:bold">*</span>' : '';
        const hasOptions = ["select", "radio", "checkbox", "hazard", "department", "area", "areaTree", "warehouse", "gender", "weather", "wind", "relatedData"].includes(field.type);
        const showOptions = isFieldActive && hasOptions;
        
        html += `
          <div style="background:${isFieldActive ? '#e8f4fd' : '#fff'};padding:8px 14px;display:flex;align-items:center;gap:8px;cursor:pointer;transition:background .15s;border-bottom:1px solid #f3f4f6"
               onclick="selectField(${gIdx},${fIdx})"
               onmouseover="if(!${isFieldActive})this.style.background='#f9fafb'"
               onmouseout="if(!${isFieldActive})this.style.background='#fff'">
            <span style="font-size:13px;color:#9ca3af;width:28px;text-align:right;flex-shrink:0">${fIdx + 1}.${requiredMark}</span>
            <input type="text" value="${field.label || ''}" 
                   style="flex:1;min-width:0;padding:6px 10px;border:1px solid ${isFieldActive ? '#7dd3fc' : '#d1d5db'};border-radius:4px;font-size:13px;box-sizing:border-box;background:#fff"
                   onclick="event.stopPropagation()" 
                   onchange="updateFieldLabel(${gIdx},${fIdx},this.value)"
                   placeholder="字段名称"/>
            <select style="width:120px;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;flex-shrink:0;background:#fff"
                    onclick="event.stopPropagation()"
                    onchange="updateFieldType(${gIdx},${fIdx},this.value)">
              ${FIELD_CATEGORIES.map(cat => `<optgroup label="${cat.label}">${cat.types.map(t => `<option value="${t.type}" ${t.type === field.type ? 'selected' : ''}>${t.label}</option>`).join('')}</optgroup>`).join('')}
              <optgroup label="其他(兼容)">
                <option value="datetime" ${field.type === 'datetime' ? 'selected' : ''}>日期时间</option>
                <option value="select" ${field.type === 'select' ? 'selected' : ''}>下拉单选</option>
                <option value="switch" ${field.type === 'switch' ? 'selected' : ''}>开关(是/否)</option>
              </optgroup>
            </select>
            <div style="display:flex;align-items:center;gap:1px;flex-shrink:0">
              <button onclick="event.stopPropagation();moveField(${gIdx},${fIdx},-1)" style="width:24px;height:24px;border:none;background:transparent;cursor:pointer;font-size:11px;color:#9ca3af;border-radius:3px;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='#e5e7eb';this.style.color='#374151'" onmouseout="this.style.background='transparent';this.style.color='#9ca3af'" title="上移">▲</button>
              <button onclick="event.stopPropagation();moveField(${gIdx},${fIdx},1)" style="width:24px;height:24px;border:none;background:transparent;cursor:pointer;font-size:11px;color:#9ca3af;border-radius:3px;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='#e5e7eb';this.style.color='#374151'" onmouseout="this.style.background='transparent';this.style.color='#9ca3af'" title="下移">▼</button>
              <button onclick="event.stopPropagation();deleteField(${gIdx},${fIdx})" style="width:24px;height:24px;border:none;background:transparent;cursor:pointer;font-size:12px;color:#d1d5db;border-radius:3px;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='#fee2e2';this.style.color='#ef4444'" onmouseout="this.style.background='transparent';this.style.color='#d1d5db'" title="删除">🗑</button>
            </div>
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#6b7280;cursor:pointer;flex-shrink:0;margin-left:4px" onclick="event.stopPropagation()">
              <input type="checkbox" ${field.isSummary ? 'checked' : ''} onchange="toggleFieldSummary(${gIdx},${fIdx})" style="width:14px;height:14px"/> 摘要
            </label>
          </div>`;
        
        // 行内选项编辑（选中且有选项时展开）
        if (showOptions) {
          const optionsText = (field.options || []).join("\n");
          html += `
            <div style="background:#f0f9ff;padding:10px 14px 10px 50px;border-bottom:1px solid #f3f4f6" onclick="event.stopPropagation()">
              <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:4px">选项（每行一个，修改后点击其他区域自动保存）</label>
              <textarea rows="3" style="width:100%;padding:6px 10px;border:1px solid #bae6fd;border-radius:4px;font-size:12px;box-sizing:border-box;resize:vertical;background:#fff"
                        onchange="updateFieldOptions(${gIdx},${fIdx},this.value)"
                        placeholder="选项1&#10;选项2&#10;选项3">${optionsText}</textarea>
            </div>`;
        }
      });
    }
    
    // 添加字段按钮
    html += `
      <div style="padding:10px 14px">
        <button onclick="event.stopPropagation();currentEditingGroupIndex=${gIdx};document.getElementById('field-type-panel').scrollIntoView({behavior:'smooth'});showToast('请从左侧控件库选择字段类型')" 
                style="padding:6px 16px;background:#fff;border:1px solid #d1d5db;border-radius:4px;font-size:12px;cursor:pointer;color:#6b7280"
                onmouseover="this.style.borderColor='#14b8a6';this.style.color='#14b8a6'" 
                onmouseout="this.style.borderColor='#d1d5db';this.style.color='#6b7280'">+ 添加字段</button>
      </div>
    </div>`;
  });
  
  container.innerHTML = html;
}

// 选择分组
function selectGroup(gIdx) {
  currentEditingGroupIndex = gIdx;
  currentEditingFieldIndex = -1;
  renderGroupList();
  renderFieldEditor();
}

// 移动分组
function moveGroup(gIdx, direction) {
  const groups = currentEditingForm.groups;
  const newIdx = gIdx + direction;
  if (newIdx < 0 || newIdx >= groups.length) return;
  [groups[gIdx], groups[newIdx]] = [groups[newIdx], groups[gIdx]];
  if (currentEditingGroupIndex === gIdx) currentEditingGroupIndex = newIdx;
  else if (currentEditingGroupIndex === newIdx) currentEditingGroupIndex = gIdx;
  currentEditingForm.updatedAt = new Date().toISOString();
  renderGroupList();
}

// 复制分组
function copyGroup(gIdx) {
  const group = currentEditingForm.groups[gIdx];
  const newGroup = JSON.parse(JSON.stringify(group));
  newGroup.id = "group_" + genId();
  newGroup.name = group.name + " 副本";
  newGroup.fields = (group.fields || []).map(f => ({ ...f, id: "field_" + genId() }));
  currentEditingForm.groups.splice(gIdx + 1, 0, newGroup);
  currentEditingForm.updatedAt = new Date().toISOString();
  renderGroupList();
  showToast("分组已复制");
}

// 删除分组
async function deleteGroup(gIdx) {
  const ok = await confirmDialog("确定删除这个分组吗？分组内的所有字段也会被删除。");
  if (!ok) return;
  currentEditingForm.groups.splice(gIdx, 1);
  if (currentEditingGroupIndex >= currentEditingForm.groups.length) {
    currentEditingGroupIndex = currentEditingForm.groups.length - 1;
  }
  currentEditingFieldIndex = -1;
  currentEditingForm.updatedAt = new Date().toISOString();
  renderGroupList();
  renderFieldEditor();
  showToast("分组已删除");
}

/* ---------- 字段管理 ---------- */

// 初始化字段类型选择器
function initFieldTypePicker() {
  const container = document.getElementById("field-type-picker");
  if (!container) return;
  
  let html = "";
  FIELD_CATEGORIES.forEach(cat => {
    const collapsed = fieldCategoryCollapsed[cat.key];
    html += `<div style="margin-bottom:6px">
      <div onclick="toggleFieldCategory('${cat.key}')" style="display:flex;align-items:center;gap:4px;padding:5px 6px;font-size:11px;font-weight:600;color:#6b7280;cursor:pointer;user-select:none;border-radius:4px" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='transparent'">
        <span style="font-size:10px;transition:transform .15s;transform:rotate(${collapsed ? 0 : 90}deg)">▶</span>
        <span>${cat.icon}</span>
        <span>${cat.label}</span>
        <span style="margin-left:auto;font-size:10px;color:#9ca3af">${cat.types.length}</span>
      </div>
      <div style="display:${collapsed ? 'none' : 'flex'};flex-direction:column;gap:3px;padding-left:4px;margin-top:2px">`;
    cat.types.forEach(type => {
      html += `<button onclick="addField('${type.type}')" style="display:flex;align-items:center;gap:5px;padding:5px 8px;background:#fff;border:1px solid #e5e7eb;border-radius:5px;font-size:11px;cursor:pointer;text-align:left;transition:all .15s;width:100%" 
               onmouseover="this.style.background='#eff6ff';this.style.borderColor='#3b82f6';this.style.color='#1d4ed8'" 
               onmouseout="this.style.background='#fff';this.style.borderColor='#e5e7eb';this.style.color=''">
        <span style="font-size:12px;flex-shrink:0">${type.icon}</span>
        <span style="color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${type.label}</span>
      </button>`;
    });
    html += `</div></div>`;
  });
  container.innerHTML = html;
}

// 切换字段分类折叠
function toggleFieldCategory(catKey) {
  fieldCategoryCollapsed[catKey] = !fieldCategoryCollapsed[catKey];
  initFieldTypePicker();
}

// 切换字段类型面板的显示/隐藏
function toggleFieldTypePanel() {
  const panel = document.getElementById("field-type-panel");
  const btn = document.getElementById("toggle-field-type-btn");
  if (!panel || !btn) return;
  if (panel.style.display === "none") {
    panel.style.display = "block";
    btn.innerHTML = "◀️ 隐藏字段类型";
  } else {
    panel.style.display = "none";
    btn.innerHTML = "▶️ 显示字段类型";
  }
}

// 添加字段（添加到当前选中分组，或第一个分组，或新建分组）
function addField(type) {
  if (!currentEditingForm) return;
  if (!currentEditingForm.groups) currentEditingForm.groups = [];
  
  // 确定目标分组
  let targetGroupIdx = currentEditingGroupIndex;
  if (targetGroupIdx < 0 || targetGroupIdx >= currentEditingForm.groups.length) {
    if (currentEditingForm.groups.length === 0) {
      // 没有分组，先新建一个
      addGroup();
      targetGroupIdx = 0;
    } else {
      targetGroupIdx = 0;
      currentEditingGroupIndex = 0;
    }
  }
  
  const typeInfo = FIELD_TYPES.find(t => t.type === type);
  if (!typeInfo) return;
  
  const hasOptions = ["select", "radio", "checkbox", "hazard", "department", "area", "areaTree", "warehouse", "gender", "weather", "wind"].includes(type);
  const defaultOptions = {
    hazard: ["一般隐患", "重大隐患", "无隐患"],
    department: ["部门1", "部门2", "部门3"],
    area: ["区域1", "区域2", "区域3"],
    gender: ["男", "女"],
    weather: ["晴", "阴", "雨", "雪"],
    wind: ["无风", "微风", "和风", "强风"],
    warehouse: ["仓库1", "仓库2", "仓库3"]
  };
  const newField = {
    id: "field_" + genId(),
    type: type,
    label: typeInfo.label,
    placeholder: "",
    required: false,
    isSummary: false,
    options: hasOptions ? (defaultOptions[type] || ["选项1", "选项2", "选项3"]) : []
  };
  
  if (!currentEditingForm.groups[targetGroupIdx].fields) {
    currentEditingForm.groups[targetGroupIdx].fields = [];
  }
  currentEditingForm.groups[targetGroupIdx].fields.push(newField);
  currentEditingFieldIndex = currentEditingForm.groups[targetGroupIdx].fields.length - 1;
  currentEditingForm.updatedAt = new Date().toISOString();
  
  renderGroupList();
  renderFieldEditor();
}

// 选择字段
function selectField(gIdx, fIdx) {
  currentEditingGroupIndex = gIdx;
  currentEditingFieldIndex = fIdx;
  renderGroupList();
  renderFieldEditor();
}

// 更新字段名称（直接在列表中编辑）
function updateFieldLabel(gIdx, fIdx, value) {
  currentEditingForm.groups[gIdx].fields[fIdx].label = value;
  currentEditingForm.updatedAt = new Date().toISOString();
}

// 更新字段类型（直接在列表中切换）
function updateFieldType(gIdx, fIdx, newType) {
  const field = currentEditingForm.groups[gIdx].fields[fIdx];
  const hasOptions = ["select", "radio", "checkbox", "hazard", "department", "area", "areaTree", "warehouse", "gender", "weather", "wind"].includes(newType);
  if (hasOptions && (!field.options || field.options.length === 0)) {
    const defaultOptions = {
      hazard: ["一般隐患", "重大隐患", "无隐患"],
      department: ["部门1", "部门2", "部门3"],
      area: ["区域1", "区域2", "区域3"],
      gender: ["男", "女"],
      weather: ["晴", "阴", "雨", "雪"],
      wind: ["无风", "微风", "和风", "强风"],
      warehouse: ["仓库1", "仓库2", "仓库3"]
    };
    field.options = defaultOptions[newType] || ["选项1", "选项2", "选项3"];
  }
  field.type = newType;
  currentEditingForm.updatedAt = new Date().toISOString();
  renderFieldEditor();
}

// 切换摘要标记
function toggleFieldSummary(gIdx, fIdx) {
  const field = currentEditingForm.groups[gIdx].fields[fIdx];
  field.isSummary = !field.isSummary;
  currentEditingForm.updatedAt = new Date().toISOString();
}

// 切换字段必填
function toggleFieldRequired(gIdx, fIdx) {
  const field = currentEditingForm.groups[gIdx].fields[fIdx];
  field.required = !field.required;
  currentEditingForm.updatedAt = new Date().toISOString();
  renderGroupList();
}

// 行内更新字段选项
function updateFieldOptions(gIdx, fIdx, value) {
  const field = currentEditingForm.groups[gIdx].fields[fIdx];
  field.options = value.split("\n").map(s => s.trim()).filter(s => s);
  currentEditingForm.updatedAt = new Date().toISOString();
  showToast("选项已更新");
}

// 切换分组可见性
function toggleGroupVisible(gIdx) {
  const group = currentEditingForm.groups[gIdx];
  group.visible = group.visible === false ? true : false;
  currentEditingForm.updatedAt = new Date().toISOString();
  renderGroupList();
}

// 移动字段
function moveField(gIdx, fIdx, direction) {
  const fields = currentEditingForm.groups[gIdx].fields;
  const newIdx = fIdx + direction;
  if (newIdx < 0 || newIdx >= fields.length) return;
  [fields[fIdx], fields[newIdx]] = [fields[newIdx], fields[fIdx]];
  if (currentEditingGroupIndex === gIdx) {
    if (currentEditingFieldIndex === fIdx) currentEditingFieldIndex = newIdx;
    else if (currentEditingFieldIndex === newIdx) currentEditingFieldIndex = fIdx;
  }
  currentEditingForm.updatedAt = new Date().toISOString();
  renderGroupList();
}

// 复制字段
function copyField(gIdx, fIdx) {
  const field = currentEditingForm.groups[gIdx].fields[fIdx];
  const newField = { ...JSON.parse(JSON.stringify(field)), id: "field_" + genId(), label: field.label + " 副本" };
  currentEditingForm.groups[gIdx].fields.splice(fIdx + 1, 0, newField);
  currentEditingForm.updatedAt = new Date().toISOString();
  renderGroupList();
  showToast("字段已复制");
}

// 删除字段
async function deleteField(gIdx, fIdx) {
  const ok = await confirmDialog("确定删除这个字段吗？");
  if (!ok) return;
  currentEditingForm.groups[gIdx].fields.splice(fIdx, 1);
  if (currentEditingGroupIndex === gIdx && currentEditingFieldIndex >= currentEditingForm.groups[gIdx].fields.length) {
    currentEditingFieldIndex = currentEditingForm.groups[gIdx].fields.length - 1;
  }
  currentEditingForm.updatedAt = new Date().toISOString();
  renderGroupList();
  renderFieldEditor();
  showToast("字段已删除");
}

// 渲染字段属性编辑器
function renderFieldEditor() {
  const container = document.getElementById("field-editor-container");
  if (!container) return;
  
  // 没有选中字段，显示分组编辑或提示
  if (currentEditingGroupIndex < 0 || currentEditingFieldIndex < 0 || 
      !currentEditingForm.groups[currentEditingGroupIndex] ||
      !currentEditingForm.groups[currentEditingGroupIndex].fields[currentEditingFieldIndex]) {
    if (currentEditingGroupIndex >= 0 && currentEditingForm.groups[currentEditingGroupIndex]) {
      const group = currentEditingForm.groups[currentEditingGroupIndex];
      container.innerHTML = `
        <div style="padding:4px">
          <div style="font-size:14px;font-weight:600;color:#1f2937;margin-bottom:14px">📁 分组设置</div>
          <div style="margin-bottom:14px">
            <label style="display:block;font-size:12px;color:#666;margin-bottom:4px">分组名称</label>
            <input type="text" value="${group.name || ''}" style="width:100%;padding:7px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;box-sizing:border-box" onchange="updateGroupName(this.value)"/>
          </div>
          <div style="margin-bottom:14px">
            <label style="display:block;font-size:12px;color:#666;margin-bottom:4px">分组颜色</label>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              ${GROUP_COLORS.map(c => `<span onclick="setGroupColor('${c}')" style="width:22px;height:22px;border-radius:4px;cursor:pointer;background:${c};border:2px solid ${group.color === c ? '#14b8a6' : '#e5e7eb'}" title="${c}"></span>`).join('')}
            </div>
          </div>
          <div style="margin-bottom:14px">
            <label style="display:block;font-size:12px;color:#666;margin-bottom:4px">分组说明</label>
            <textarea rows="3" style="width:100%;padding:7px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;resize:vertical;box-sizing:border-box" placeholder="选填" onchange="updateGroupDesc(this.value)">${group.description || ''}</textarea>
          </div>
          <div style="font-size:11px;color:#9ca3af;margin-top:16px;padding:10px;background:#f9fafb;border-radius:6px;line-height:1.6">
            💡 从左侧控件库点击添加字段<br>
            💡 点击中间字段行编辑字段属性
          </div>
        </div>`;
      return;
    }
    container.innerHTML = '<div style="text-align:center;padding:48px 20px;color:#d1d5db;font-size:13px"><div style="font-size:36px;margin-bottom:10px">👆</div>请先选择一个字段<br><span style="font-size:11px">点击中间画布中的字段行</span></div>';
    return;
  }
  
  const field = currentEditingForm.groups[currentEditingGroupIndex].fields[currentEditingFieldIndex];
  const typeInfo = FIELD_TYPES.find(t => t.type === field.type) || FIELD_TYPES[0];
  const hasOptions = ["select", "radio", "checkbox", "hazard", "department", "area", "areaTree", "warehouse", "gender", "weather", "wind", "relatedData"].includes(field.type);
  const displayStyle = field.displayStyle || "oneCol";
  
  let optionsHtml = "";
  if (hasOptions) {
    const optionsText = (field.options || []).join("\n");
    optionsHtml = `
      <div style="margin-bottom:14px">
        <label style="display:block;font-size:12px;color:#666;margin-bottom:4px">选项（每行一个）</label>
        <textarea rows="4" style="width:100%;padding:7px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:12px;resize:vertical;box-sizing:border-box" 
                  onchange="saveFieldProp('options',this.value.split('\n').map(s=>s.trim()).filter(s=>s))"
                  placeholder="选项1&#10;选项2&#10;选项3">${optionsText}</textarea>
      </div>`;
  }
  
  container.innerHTML = `
    <div style="padding:2px">
      <!-- 字段名称大标题 -->
      <div style="font-size:16px;font-weight:600;color:#1f2937;margin-bottom:4px">${field.label || '未命名字段'}</div>
      <div style="font-size:11px;color:#9ca3af;margin-bottom:16px">${typeInfo.icon} ${typeInfo.label} · ${field.id ? field.id.substring(0,12) : ''}</div>
      
      <!-- 字段显示样式 -->
      <div style="margin-bottom:14px">
        <label style="display:block;font-size:12px;font-weight:500;color:#374151;margin-bottom:6px">字段显示样式</label>
        <div style="display:flex;gap:16px">
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:#374151">
            <input type="radio" name="field-display-style" value="twoCol" ${displayStyle === 'twoCol' ? 'checked' : ''} onchange="saveFieldProp('displayStyle','twoCol')" style="width:14px;height:14px"/> 一行两列
          </label>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:#374151">
            <input type="radio" name="field-display-style" value="oneCol" ${displayStyle === 'oneCol' ? 'checked' : ''} onchange="saveFieldProp('displayStyle','oneCol')" style="width:14px;height:14px"/> 一行一列
          </label>
        </div>
      </div>
      
      <!-- 字段文本描述 -->
      <div style="margin-bottom:14px">
        <label style="display:block;font-size:12px;font-weight:500;color:#374151;margin-bottom:4px">字段文本描述 <span style="color:#9ca3af;font-weight:normal">ⓘ</span></label>
        <textarea rows="2" style="width:100%;padding:7px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:12px;resize:vertical;box-sizing:border-box" 
                  onchange="saveFieldProp('textDesc',this.value)"
                  placeholder="存在异常情况，则需填写">${field.textDesc || ''}</textarea>
      </div>
      
      <!-- 字段富文本描述 -->
      <div style="margin-bottom:14px">
        <label style="display:block;font-size:12px;font-weight:500;color:#374151;margin-bottom:4px">字段富文本描述 <span style="color:#9ca3af;font-weight:normal">ⓘ</span></label>
        <button onclick="editFieldRichDesc()" style="width:100%;padding:8px;background:#14b8a6;color:#fff;border:none;border-radius:4px;font-size:13px;cursor:pointer;font-weight:500" onmouseover="this.style.background='#0d9488'" onmouseout="this.style.background='#14b8a6'">点击编辑字段描述内容</button>
        ${field.richDesc ? `<div style="margin-top:6px;padding:6px 8px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:4px;font-size:11px;color:#0d9488;max-height:60px;overflow-y:auto">${field.richDesc.substring(0,80)}${field.richDesc.length > 80 ? '...' : ''}</div>` : ''}
      </div>
      
      ${optionsHtml}
      
      <!-- 字段校验 -->
      <div style="margin-bottom:14px">
        <label style="display:block;font-size:12px;font-weight:500;color:#374151;margin-bottom:6px">字段校验</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:#374151;margin-bottom:6px">
          <input type="checkbox" ${field.required ? 'checked' : ''} onchange="saveFieldProp('required',this.checked)" style="width:14px;height:14px"/> 必填
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:#374151">
          <input type="checkbox" ${field.useLastValue ? 'checked' : ''} onchange="saveFieldProp('useLastValue',this.checked)" style="width:14px;height:14px"/> 填入上次填写内容
        </label>
      </div>
      
      <!-- 默认值 -->
      <div style="margin-bottom:14px">
        <label style="display:block;font-size:12px;font-weight:500;color:#374151;margin-bottom:4px">默认值</label>
        <textarea rows="2" style="width:100%;padding:7px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:12px;resize:vertical;box-sizing:border-box" 
                  onchange="saveFieldProp('defaultValue',this.value)"
                  placeholder="请输入默认值，为空则无默认值">${field.defaultValue || ''}</textarea>
      </div>
      
      <!-- 字段备注 -->
      <div style="margin-bottom:14px">
        <label style="display:block;font-size:12px;font-weight:500;color:#374151;margin-bottom:4px">字段备注：</label>
        <textarea rows="2" style="width:100%;padding:7px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:12px;resize:vertical;box-sizing:border-box" 
                  onchange="saveFieldProp('fieldRemark',this.value)"
                  placeholder="字段备注说明">${field.fieldRemark || ''}</textarea>
      </div>
      
      <!-- 帮助 -->
      <div style="text-align:right;margin-top:16px">
        <button onclick="showFieldHelp()" style="padding:5px 14px;background:#fff;border:1px solid #d9d9d9;border-radius:4px;font-size:12px;cursor:pointer;color:#666;display:inline-flex;align-items:center;gap:4px" onmouseover="this.style.borderColor='#14b8a6';this.style.color='#14b8a6'" onmouseout="this.style.borderColor='#d9d9d9';this.style.color='#666'">💡 帮助</button>
      </div>
    </div>`;
}

// 保存单个字段属性（自动保存）
function saveFieldProp(prop, value) {
  if (currentEditingGroupIndex < 0 || currentEditingFieldIndex < 0) return;
  const field = currentEditingForm.groups[currentEditingGroupIndex].fields[currentEditingFieldIndex];
  field[prop] = value;
  currentEditingForm.updatedAt = new Date().toISOString();
  if (prop === 'required' || prop === 'displayStyle') {
    renderGroupList();
  }
}

// 编辑字段富文本描述
function editFieldRichDesc() {
  if (currentEditingGroupIndex < 0 || currentEditingFieldIndex < 0) return;
  const field = currentEditingForm.groups[currentEditingGroupIndex].fields[currentEditingFieldIndex];
  // 打开富文本编辑弹窗
  const editor = document.getElementById("field-rich-desc-editor");
  if (editor) {
    editor.innerHTML = field.richDesc || "";
  }
  openModal("modal-field-rich-desc");
}

// 保存字段富文本描述
function saveFieldRichDesc() {
  if (currentEditingGroupIndex < 0 || currentEditingFieldIndex < 0) return;
  const field = currentEditingForm.groups[currentEditingGroupIndex].fields[currentEditingFieldIndex];
  const editor = document.getElementById("field-rich-desc-editor");
  if (editor) {
    field.richDesc = editor.innerHTML;
  }
  currentEditingForm.updatedAt = new Date().toISOString();
  closeModal("modal-field-rich-desc");
  renderFieldEditor();
  showToast("富文本描述已更新");
}

// 字段帮助
function showFieldHelp() {
  alert("字段属性说明：\n\n" +
    "• 字段显示样式：控制填写时该字段占一行还是半行\n" +
    "• 字段文本描述：显示在字段下方的提示文字\n" +
    "• 字段富文本描述：可包含格式的详细说明\n" +
    "• 必填：填写时必须输入\n" +
    "• 填入上次填写内容：自动带入上次填写的值\n" +
    "• 默认值：新填写时的初始值\n" +
    "• 字段备注：仅供管理员查看的备注信息");
}

// 保存字段编辑（兼容旧调用）
function saveFieldEdit() {
  if (currentEditingGroupIndex < 0 || currentEditingFieldIndex < 0) return;
  const field = currentEditingForm.groups[currentEditingGroupIndex].fields[currentEditingFieldIndex];
  if (!field.label) {
    showToast("请填写字段名称");
    return;
  }
  currentEditingForm.updatedAt = new Date().toISOString();
  renderGroupList();
  showToast("字段已保存");
}

// 更新分组名称
function updateGroupName(name) {
  if (currentEditingGroupIndex < 0) return;
  currentEditingForm.groups[currentEditingGroupIndex].name = name;
  currentEditingForm.updatedAt = new Date().toISOString();
  renderGroupList();
}

// 设置分组颜色
function setGroupColor(color) {
  if (currentEditingGroupIndex < 0) return;
  currentEditingForm.groups[currentEditingGroupIndex].color = color;
  currentEditingForm.updatedAt = new Date().toISOString();
  renderGroupList();
  renderFieldEditor();
}

// 更新分组说明
function updateGroupDesc(desc) {
  if (currentEditingGroupIndex < 0) return;
  currentEditingForm.groups[currentEditingGroupIndex].description = desc;
  currentEditingForm.updatedAt = new Date().toISOString();
}

/* ---------- 保存/删除表单 ---------- */

// 保存表单
async function saveForm() {
  if (!currentEditingForm) return;
  
  currentEditingForm.name = document.getElementById("form-name-input").value.trim();
  
  // 读取富文本说明
  const richEditor = document.getElementById("form-desc-richtext");
  if (richEditor) currentEditingForm.description = richEditor.innerHTML;
  
  // 读取所属项目
  const projectSelect = document.getElementById("form-project-select");
  if (projectSelect) currentEditingForm.projectId = projectSelect.value;
  
  currentEditingForm.category = document.getElementById("form-category-select").value;
  currentEditingForm.status = document.getElementById("form-status-select").value;
  
  // 保存表单结果设置
  const resultHidden = document.getElementById("form-result-hidden");
  if (resultHidden) currentEditingForm.resultHidden = resultHidden.checked;
  const resultDesc = document.getElementById("form-result-desc");
  if (resultDesc) currentEditingForm.resultDesc = resultDesc.value.trim();
  const resultType = document.getElementById("form-result-type");
  if (resultType) currentEditingForm.resultType = resultType.value;
  const resultStatusGroup = document.getElementById("form-result-status-group");
  if (resultStatusGroup) currentEditingForm.resultStatusGroup = resultStatusGroup.value.trim();
  
  currentEditingForm.updatedAt = new Date().toISOString();
  
  if (!currentEditingForm.name) {
    showToast("请填写表单名称");
    return;
  }
  
  const totalFields = (currentEditingForm.groups || []).reduce((sum, g) => sum + (g.fields || []).length, 0);
  if (totalFields === 0) {
    showToast("请至少添加一个分组和字段");
    return;
  }
  
  await dbPut(S_FORM, currentEditingForm);
  
  // 同步到云端（失败不影响本地）
  if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
    try { await Cloud.syncForm(currentEditingForm); } catch(e) { console.warn('表单同步云端失败', e); }
  }
  
  showToast("表单已保存");
  closeModal("modal-form-editor");
  closeFormEditor();
  await renderFormList();
}

// 删除表单（带撤销功能）
let lastDeletedForm = null;
let formUndoTimer = null;

async function deleteForm(formId) {
  try {
    console.log("开始删除表单:", formId);
    const ok = await confirmDialog("确定删除这个表单吗？\n\n注意：只会删除表单模板，已填写的表单记录会保留。\n删除后5秒内可撤销。");
    console.log("用户选择:", ok);
    if (!ok) return;
    
    // 先保存被删除的表单数据，用于撤销
    let forms = await dbGetAll(S_FORM);
    lastDeletedForm = forms.find(f => f.id === formId);
    console.log("找到表单:", lastDeletedForm ? lastDeletedForm.name : "未找到");
    
    await dbDel(S_FORM, formId);
    console.log("删除成功");
    await renderFormList();
    console.log("列表已刷新");
    
    // 显示撤销提示
    showUndoToast("表单已删除", () => {
      if (lastDeletedForm) {
        dbPut(S_FORM, lastDeletedForm);
        lastDeletedForm = null;
        renderFormList();
        showToast("已撤销删除");
      }
    });
    console.log("撤销提示已显示");
  } catch (e) {
    console.error("删除表单出错:", e);
    showToast("删除失败: " + e.message);
  }
}

// 显示带撤销按钮的提示
function showUndoToast(message, undoCallback) {
  // 清除之前的定时器
  if (formUndoTimer) clearTimeout(formUndoTimer);
  
  // 移除已有的撤销提示
  const oldBar = document.getElementById("form-undo-bar");
  if (oldBar) oldBar.remove();
  
  // 创建撤销提示条
  const bar = document.createElement("div");
  bar.id = "form-undo-bar";
  bar.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:12px 20px;border-radius:10px;z-index:9999;display:flex;align-items:center;gap:16px;box-shadow:0 6px 24px rgba(0,0,0,0.3);font-size:14px;max-width:90vw";
  
  const textSpan = document.createElement("span");
  textSpan.textContent = message + "（Ctrl+Z 撤销）";
  
  // 执行撤销的函数
  const doUndo = () => {
    if (undoCallback) undoCallback();
    cleanup();
  };
  
  // 清理函数
  const cleanup = () => {
    bar.remove();
    if (formUndoTimer) clearTimeout(formUndoTimer);
    document.removeEventListener("keydown", handleKeydown);
  };
  
  // 键盘事件处理
  const handleKeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z" || e.code === "KeyZ")) {
      e.preventDefault();
      e.stopPropagation();
      doUndo();
    }
  };
  
  const undoBtn = document.createElement("button");
  undoBtn.textContent = "撤销";
  undoBtn.style.cssText = "background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;transition:all .15s";
  undoBtn.onmouseover = () => undoBtn.style.background = "#2563eb";
  undoBtn.onmouseout = () => undoBtn.style.background = "#3b82f6";
  undoBtn.onclick = doUndo;
  
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "background:none;color:#9ca3af;border:none;font-size:16px;cursor:pointer;padding:0 4px";
  closeBtn.onmouseover = () => closeBtn.style.color = "#fff";
  closeBtn.onmouseout = () => closeBtn.style.color = "#9ca3af";
  closeBtn.onclick = () => {
    cleanup();
    lastDeletedForm = null;
  };
  
  bar.appendChild(textSpan);
  bar.appendChild(undoBtn);
  bar.appendChild(closeBtn);
  document.body.appendChild(bar);
  
  // 监听 Ctrl+Z 快捷键
  document.addEventListener("keydown", handleKeydown);
  
  // 5秒后自动消失
  formUndoTimer = setTimeout(() => {
    bar.style.transition = "opacity .3s";
    bar.style.opacity = "0";
    setTimeout(() => { cleanup(); lastDeletedForm = null; }, 300);
  }, 5000);
}

// 关闭表单编辑器
function closeFormEditor() {
  currentEditingForm = null;
  currentEditingGroupIndex = -1;
  currentEditingFieldIndex = -1;
  formEditSnapshot = null;
}

/* ---------- 表单渲染器 ---------- */

// 渲染表单填写界面
function renderFormFill(form, data, containerId, readonly) {
  form = migrateFormData(form);
  const container = document.getElementById(containerId);
  if (!container || !form) return "";
  
  let html = '<div style="display:flex;flex-direction:column;gap:16px">';
  
  (form.groups || []).forEach(group => {
    if (group.visible === false) return;
    
    html += `<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">`;
    // 分组标题
    html += `<div style="background:${group.color}15;padding:10px 14px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:8px">
      <span style="width:10px;height:10px;border-radius:2px;background:${group.color}"></span>
      <span style="font-weight:600;font-size:14px;color:#1f2937">${group.name || ''}</span>
    </div>`;
    if (group.description) {
      html += `<div style="padding:8px 14px;background:#f9fafb;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb">${group.description}</div>`;
    }
    // 分组字段
    html += `<div style="padding:14px;display:flex;flex-direction:column;gap:14px">`;
    (group.fields || []).forEach(field => {
      const value = data ? data[field.id] : "";
      const requiredMark = field.required ? '<span style="color:#ef4444">*</span>' : '';
      const disabledAttr = readonly ? 'disabled style="background:#f9fafb;cursor:not-allowed"' : '';
      
      html += `<div>`;
      html += `<label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px">${field.label || ''} ${requiredMark}</label>`;
      
      switch (field.type) {
        case "text":
        case "name":
        case "location":
          html += `<input type="text" id="formfield_${field.id}" value="${value || ''}" placeholder="${field.placeholder || ''}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>`;
          break;
        case "textarea":
          html += `<textarea id="formfield_${field.id}" rows="3" placeholder="${field.placeholder || ''}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box">${value || ''}</textarea>`;
          break;
        case "number":
          html += `<input type="number" id="formfield_${field.id}" value="${value || ''}" placeholder="${field.placeholder || ''}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>`;
          break;
        case "date":
          html += `<input type="date" id="formfield_${field.id}" value="${value || ''}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>`;
          break;
        case "time":
          html += `<input type="time" id="formfield_${field.id}" value="${value || ''}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>`;
          break;
        case "datetime":
          html += `<input type="datetime-local" id="formfield_${field.id}" value="${value || ''}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>`;
          break;
        case "select":
          html += `<select id="formfield_${field.id}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box">`;
          html += `<option value="">请选择</option>`;
          (field.options || []).forEach(opt => {
            html += `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`;
          });
          html += `</select>`;
          break;
        case "radio":
          html += `<div style="display:flex;flex-wrap:wrap;gap:10px">`;
          (field.options || []).forEach(opt => {
            html += `<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:#374151">
              <input type="radio" name="formfield_${field.id}" value="${opt}" ${value === opt ? 'checked' : ''} ${readonly ? 'disabled' : ''}/> ${opt}
            </label>`;
          });
          html += `</div>`;
          break;
        case "checkbox":
          const checkedValues = Array.isArray(value) ? value : (value ? value.split(",") : []);
          html += `<div style="display:flex;flex-wrap:wrap;gap:10px">`;
          (field.options || []).forEach(opt => {
            html += `<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:#374151">
              <input type="checkbox" class="formfield_${field.id}" value="${opt}" ${checkedValues.includes(opt) ? 'checked' : ''} ${readonly ? 'disabled' : ''}/> ${opt}
            </label>`;
          });
          html += `</div>`;
          break;
        case "switch":
          html += `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="formfield_${field.id}" ${value === '是' || value === true ? 'checked' : ''} ${readonly ? 'disabled' : ''} style="width:18px;height:18px"/>
            <span style="font-size:13px;color:#374151">${value === '是' || value === true ? '是' : '否'}</span>
          </label>`;
          break;
        case "rating":
          html += `<div style="display:flex;gap:4px;font-size:22px">`;
          for (let i = 1; i <= 5; i++) {
            const filled = (parseInt(value) || 0) >= i;
            html += `<span class="rating-star" data-field="${field.id}" data-value="${i}" style="cursor:${readonly ? 'not-allowed' : 'pointer'};color:${filled ? '#fbbf24' : '#d1d5db'}" ${readonly ? '' : `onclick="setRating('${field.id}',${i})"`}>★</span>`;
          }
          html += `</div>`;
          break;
        case "image":
          html += `<div style="border:2px dashed #d1d5db;border-radius:8px;padding:16px;text-align:center;background:#f9fafb">`;
          if (value) {
            html += `<img src="${value}" style="max-width:100%;max-height:150px;border-radius:6px;margin-bottom:8px"/>`;
          }
          if (!readonly) {
            html += `<input type="file" id="formfield_${field.id}" accept="image/*" style="display:none" onchange="handleFormImageUpload(this,'${field.id}')"/>`;
            html += `<button type="button" onclick="document.getElementById('formfield_${field.id}').click()" style="padding:6px 14px;background:#fff;border:1px solid #d1d5db;border-radius:6px;font-size:12px;cursor:pointer">📷 上传图片</button>`;
          }
          html += `</div>`;
          break;
        case "signature":
          html += `<div style="border:1px solid #d1d5db;border-radius:8px;background:#fff;overflow:hidden">`;
          html += `<canvas id="formfield_${field.id}" width="400" height="120" style="width:100%;display:block;cursor:crosshair"></canvas>`;
          if (!readonly) {
            html += `<div style="padding:6px;border-top:1px solid #eee;text-align:right"><button type="button" onclick="clearSignature('${field.id}')" style="padding:4px 10px;font-size:11px;background:#f3f4f6;border:none;border-radius:4px;cursor:pointer">清除</button></div>`;
          }
          html += `</div>`;
          break;
        /* ===== 填表人信息类 ===== */
        case "phone":
          html += `<input type="tel" id="formfield_${field.id}" value="${value || ''}" placeholder="${field.placeholder || '请输入手机号'}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>`;
          break;
        case "idcard":
          html += `<input type="text" id="formfield_${field.id}" value="${value || ''}" placeholder="${field.placeholder || '请输入身份证号'}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>`;
          break;
        case "employeeId":
          html += `<input type="text" id="formfield_${field.id}" value="${value || ''}" placeholder="${field.placeholder || '请输入工号'}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>`;
          break;
        case "licensePlate":
          html += `<input type="text" id="formfield_${field.id}" value="${value || ''}" placeholder="${field.placeholder || '请输入车牌号'}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>`;
          break;
        case "gender":
          html += `<select id="formfield_${field.id}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box">
            <option value="">请选择</option>
            ${(field.options || ["男","女"]).map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>`;
          break;
        /* ===== 基本类-选项型 ===== */
        case "hazard":
        case "department":
        case "area":
        case "warehouse":
        case "weather":
        case "wind":
          html += `<select id="formfield_${field.id}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box">
            <option value="">请选择</option>
            ${(field.options || []).map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>`;
          break;
        case "areaTree":
          html += `<select id="formfield_${field.id}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box">
            <option value="">请选择区域</option>
            ${(field.options || []).map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>`;
          break;
        /* ===== 基本类-数值/环境 ===== */
        case "temperature":
          html += `<div style="display:flex;align-items:center;gap:8px">
            <input type="number" step="0.1" id="formfield_${field.id}" value="${value || ''}" placeholder="${field.placeholder || '温度'}" ${disabledAttr} style="flex:1;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>
            <span style="font-size:13px;color:#6b7280">°C</span>
          </div>`;
          break;
        case "humidity":
          html += `<div style="display:flex;align-items:center;gap:8px">
            <input type="number" step="1" id="formfield_${field.id}" value="${value || ''}" placeholder="${field.placeholder || '湿度'}" ${disabledAttr} style="flex:1;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>
            <span style="font-size:13px;color:#6b7280">%RH</span>
          </div>`;
          break;
        /* ===== 基本类-自动/只读 ===== */
        case "autoNumber":
          html += `<input type="text" id="formfield_${field.id}" value="${value || '自动生成'}" readonly style="width:100%;padding:9px 12px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;background:#f9fafb;color:#6b7280;box-sizing:border-box"/>`;
          break;
        case "weekday":
          html += `<input type="text" id="formfield_${field.id}" value="${value || ''}" readonly style="width:100%;padding:9px 12px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;background:#f9fafb;color:#6b7280;box-sizing:border-box"/>`;
          break;
        /* ===== 基本类-长文本 ===== */
        case "rectification":
        case "richText":
          html += `<textarea id="formfield_${field.id}" rows="3" placeholder="${field.placeholder || ''}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box">${value || ''}</textarea>`;
          break;
        /* ===== 基本类-媒体文件 ===== */
        case "video":
          html += `<div style="border:2px dashed #d1d5db;border-radius:8px;padding:16px;text-align:center;background:#f9fafb">`;
          if (value) html += `<video src="${value}" controls style="max-width:100%;max-height:150px;border-radius:6px;margin-bottom:8px"></video>`;
          if (!readonly) {
            html += `<input type="file" id="formfield_${field.id}" accept="video/*" style="display:none" onchange="handleFormFileUpload(this,'${field.id}','video')"/>`;
            html += `<button type="button" onclick="document.getElementById('formfield_${field.id}').click()" style="padding:6px 14px;background:#fff;border:1px solid #d1d5db;border-radius:6px;font-size:12px;cursor:pointer">🎬 上传视频</button>`;
          }
          html += `</div>`;
          break;
        case "audio":
          html += `<div style="border:2px dashed #d1d5db;border-radius:8px;padding:16px;text-align:center;background:#f9fafb">`;
          if (value) html += `<audio src="${value}" controls style="max-width:100%;margin-bottom:8px"></audio>`;
          if (!readonly) {
            html += `<input type="file" id="formfield_${field.id}" accept="audio/*" style="display:none" onchange="handleFormFileUpload(this,'${field.id}','audio')"/>`;
            html += `<button type="button" onclick="document.getElementById('formfield_${field.id}').click()" style="padding:6px 14px;background:#fff;border:1px solid #d1d5db;border-radius:6px;font-size:12px;cursor:pointer">🎙️ 上传录音</button>`;
          }
          html += `</div>`;
          break;
        case "file":
        case "attachment":
          html += `<div style="border:2px dashed #d1d5db;border-radius:8px;padding:16px;text-align:center;background:#f9fafb">`;
          if (value) html += `<div style="font-size:12px;color:#3b82f6;margin-bottom:8px;word-break:break-all">📎 ${value.name || value}</div>`;
          if (!readonly) {
            html += `<input type="file" id="formfield_${field.id}" style="display:none" onchange="handleFormFileUpload(this,'${field.id}','file')"/>`;
            html += `<button type="button" onclick="document.getElementById('formfield_${field.id}').click()" style="padding:6px 14px;background:#fff;border:1px solid #d1d5db;border-radius:6px;font-size:12px;cursor:pointer">📎 上传文件</button>`;
          }
          html += `</div>`;
          break;
        /* ===== 日期时间类 ===== */
        case "dateRange":
          const drVals = (value || "").split("~");
          html += `<div style="display:flex;align-items:center;gap:6px">
            <input type="date" id="formfield_${field.id}_start" value="${drVals[0] || ''}" ${disabledAttr} style="flex:1;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>
            <span style="color:#9ca3af;font-size:12px">至</span>
            <input type="date" id="formfield_${field.id}_end" value="${drVals[1] || ''}" ${disabledAttr} style="flex:1;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>
          </div>`;
          break;
        case "timeRange":
          const trVals = (value || "").split("~");
          html += `<div style="display:flex;align-items:center;gap:6px">
            <input type="time" id="formfield_${field.id}_start" value="${trVals[0] || ''}" ${disabledAttr} style="flex:1;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>
            <span style="color:#9ca3af;font-size:12px">至</span>
            <input type="time" id="formfield_${field.id}_end" value="${trVals[1] || ''}" ${disabledAttr} style="flex:1;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>
          </div>`;
          break;
        case "dateCalc":
          html += `<input type="text" id="formfield_${field.id}" value="${value || ''}" readonly placeholder="自动计算" style="width:100%;padding:9px 12px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;background:#f9fafb;color:#6b7280;box-sizing:border-box"/>`;
          break;
        /* ===== 公式计算类 ===== */
        case "fixedValue":
          html += `<input type="text" id="formfield_${field.id}" value="${field.fixedValue || value || ''}" readonly style="width:100%;padding:9px 12px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;background:#f9fafb;color:#6b7280;box-sizing:border-box"/>`;
          break;
        case "formula":
        case "globalFormula":
          html += `<input type="text" id="formfield_${field.id}" value="${value || ''}" readonly placeholder="自动计算" style="width:100%;padding:9px 12px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;background:#f9fafb;color:#6b7280;box-sizing:border-box"/>`;
          break;
        /* ===== 数据控制类 ===== */
        case "progress":
          const progVal = parseInt(value) || 0;
          html += `<div style="width:100%;background:#e5e7eb;border-radius:10px;height:24px;overflow:hidden;position:relative">
            <div style="width:${progVal}%;height:100%;background:linear-gradient(90deg,#3b82f6,#60a5fa);transition:width .3s;border-radius:10px"></div>
            <span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:11px;font-weight:600;color:${progVal > 50 ? '#fff' : '#374151'}">${progVal}%</span>
          </div>
          <input type="hidden" id="formfield_${field.id}" value="${progVal}"/>`;
          break;
        case "pastRecords":
          html += `<div id="formfield_${field.id}" style="padding:10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;color:#6b7280;max-height:120px;overflow-y:auto">暂无往期记录</div>`;
          break;
        /* ===== 库存管理类 ===== */
        case "relatedData":
          html += `<select id="formfield_${field.id}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box">
            <option value="">请关联基础数据</option>
            ${(field.options || []).map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>`;
          break;
        case "stockIn":
        case "stockOut":
        case "inventoryCheck":
        case "warehouseTransfer":
          html += `<div style="padding:10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;font-size:12px;color:#0369a1">
            ${field.type === 'stockIn' ? '📥' : field.type === 'stockOut' ? '📤' : field.type === 'inventoryCheck' ? '✅' : '🔄'} 
            ${field.type === 'stockIn' ? '入库操作' : field.type === 'stockOut' ? '出库操作' : field.type === 'inventoryCheck' ? '盘点操作' : '仓库转移操作'}
            <input type="hidden" id="formfield_${field.id}" value="${value || ''}"/>
          </div>`;
          break;
        default:
          html += `<input type="text" id="formfield_${field.id}" value="${value || ''}" ${disabledAttr} style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box"/>`;
      }
      
      html += `</div>`;
    });
    html += `</div></div>`;
  });
  
  html += '</div>';
  container.innerHTML = html;
  
  // 初始化签名板
  if (!readonly) {
    (form.groups || []).forEach(group => {
      (group.fields || []).forEach(field => {
        if (field.type === "signature") {
          initSignaturePad(field.id);
        }
      });
    });
  }
  
  return html;
}

// 设置评分
function setRating(fieldId, value) {
  document.querySelectorAll(`.rating-star[data-field="${fieldId}"]`).forEach(star => {
    const starVal = parseInt(star.dataset.value);
    star.style.color = starVal <= value ? '#fbbf24' : '#d1d5db';
  });
  const hiddenInput = document.getElementById(`rating_${fieldId}`);
  if (hiddenInput) {
    hiddenInput.value = value;
  } else {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.id = `rating_${fieldId}`;
    input.value = value;
    document.body.appendChild(input);
  }
}

// 处理表单图片上传
function handleFormImageUpload(input, fieldId) {
  const file = input.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const hiddenInput = document.getElementById(`image_${fieldId}`);
    if (hiddenInput) {
      hiddenInput.value = e.target.result;
    } else {
      const input2 = document.createElement('input');
      input2.type = 'hidden';
      input2.id = `image_${fieldId}`;
      input2.value = e.target.result;
      document.body.appendChild(input2);
    }
    const container = input.parentElement;
    const existingImg = container.querySelector('img');
    if (existingImg) existingImg.remove();
    const img = document.createElement('img');
    img.src = e.target.result;
    img.style.cssText = 'max-width:100%;max-height:150px;border-radius:6px;margin-bottom:8px';
    container.insertBefore(img, input);
    showToast("图片已上传");
  };
  reader.readAsDataURL(file);
}

// 处理表单文件上传（视频/音频/文件）
function handleFormFileUpload(input, fieldId, fileType) {
  const file = input.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const hiddenInput = document.getElementById(`file_${fieldId}`);
    if (hiddenInput) {
      hiddenInput.value = e.target.result;
    } else {
      const input2 = document.createElement('input');
      input2.type = 'hidden';
      input2.id = `file_${fieldId}`;
      input2.value = e.target.result;
      document.body.appendChild(input2);
    }
    const container = input.parentElement;
    const existingPreview = container.querySelector(fileType === 'video' ? 'video' : fileType === 'audio' ? 'audio' : '.file-name-display');
    if (existingPreview) existingPreview.remove();
    
    if (fileType === 'video') {
      const video = document.createElement('video');
      video.src = e.target.result;
      video.controls = true;
      video.style.cssText = 'max-width:100%;max-height:150px;border-radius:6px;margin-bottom:8px';
      container.insertBefore(video, input);
    } else if (fileType === 'audio') {
      const audio = document.createElement('audio');
      audio.src = e.target.result;
      audio.controls = true;
      audio.style.cssText = 'max-width:100%;margin-bottom:8px';
      container.insertBefore(audio, input);
    } else {
      const nameDiv = document.createElement('div');
      nameDiv.className = 'file-name-display';
      nameDiv.style.cssText = 'font-size:12px;color:#3b82f6;margin-bottom:8px;word-break:break-all';
      nameDiv.textContent = '📎 ' + file.name;
      container.insertBefore(nameDiv, input);
    }
    showToast("文件已上传");
  };
  reader.readAsDataURL(file);
}

// 初始化签名板
function initSignaturePad(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas._initialized) return;
  
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let lastX = 0, lastY = 0;
  
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }
  
  function startDraw(e) {
    e.preventDefault();
    drawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
  }
  
  function draw(e) {
    if (!drawing) return;
    e.preventDefault();
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastX = pos.x;
    lastY = pos.y;
  }
  
  function stopDraw() {
    drawing = false;
  }
  
  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDraw);
  canvas.addEventListener('mouseleave', stopDraw);
  canvas.addEventListener('touchstart', startDraw);
  canvas.addEventListener('touchmove', draw);
  canvas.addEventListener('touchend', stopDraw);
  
  canvas._initialized = true;
}

// 清除签名
function clearSignature(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// 收集表单数据
function collectFormData(form) {
  form = migrateFormData(form);
  const data = {};
  (form.groups || []).forEach(group => {
    (group.fields || []).forEach(field => {
      switch (field.type) {
        case "radio":
          const radio = document.querySelector(`input[name="formfield_${field.id}"]:checked`);
          data[field.id] = radio ? radio.value : "";
          break;
        case "checkbox":
          const checkboxes = document.querySelectorAll(`.formfield_${field.id}:checked`);
          data[field.id] = Array.from(checkboxes).map(c => c.value);
          break;
        case "switch":
          const sw = document.getElementById(`formfield_${field.id}`);
          data[field.id] = sw && sw.checked ? "是" : "否";
          break;
        case "rating":
          const ratingInput = document.getElementById(`rating_${field.id}`);
          data[field.id] = ratingInput ? parseInt(ratingInput.value) || 0 : 0;
          break;
        case "image":
          const imageInput = document.getElementById(`image_${field.id}`);
          data[field.id] = imageInput ? imageInput.value : "";
          break;
        case "video":
        case "audio":
        case "file":
        case "attachment":
          const fileInput = document.getElementById(`file_${field.id}`);
          data[field.id] = fileInput ? fileInput.value : "";
          break;
        case "signature":
          const canvas = document.getElementById(`formfield_${field.id}`);
          if (canvas) {
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const hasDrawing = imageData.data.some((val, i) => i % 4 === 3 && val > 0);
            data[field.id] = hasDrawing ? canvas.toDataURL() : "";
          } else {
            data[field.id] = "";
          }
          break;
        case "dateRange":
        case "timeRange":
          const startEl = document.getElementById(`formfield_${field.id}_start`);
          const endEl = document.getElementById(`formfield_${field.id}_end`);
          const startVal = startEl ? startEl.value : "";
          const endVal = endEl ? endEl.value : "";
          data[field.id] = (startVal || endVal) ? `${startVal}~${endVal}` : "";
          break;
        case "progress":
          const progHidden = document.getElementById(`formfield_${field.id}`);
          data[field.id] = progHidden ? progHidden.value : "0";
          break;
        case "autoNumber":
          // 自动编号：如果为空则生成
          const anInput = document.getElementById(`formfield_${field.id}`);
          let anVal = anInput ? anInput.value : "";
          if (!anVal || anVal === "自动生成") {
            anVal = "NO" + Date.now().toString().slice(-8);
          }
          data[field.id] = anVal;
          break;
        case "weekday":
          // 星期：自动计算今天
          const wdInput = document.getElementById(`formfield_${field.id}`);
          let wdVal = wdInput ? wdInput.value : "";
          if (!wdVal) {
            const days = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];
            wdVal = days[new Date().getDay()];
          }
          data[field.id] = wdVal;
          break;
        default:
          const input = document.getElementById(`formfield_${field.id}`);
          data[field.id] = input ? input.value : "";
      }
    });
  });
  return data;
}

// 验证表单必填字段
function validateForm(form, data) {
  form = migrateFormData(form);
  const missing = [];
  (form.groups || []).forEach(group => {
    (group.fields || []).forEach(field => {
      if (field.required) {
        const value = data[field.id];
        if (value === "" || value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
          missing.push(field.label);
        }
      }
    });
  });
  return { ok: missing.length === 0, missing: missing };
}

// 保存表单数据
async function saveFormData(formId, data, relatedType, relatedId, createdBy) {
  let forms = await dbGetAll(S_FORM);
  let form = forms.find(f => f.id === formId);
  if (!form) return null;
  form = migrateFormData(form);
  
  const formData = {
    id: "formdata_" + genId(),
    formId: formId,
    formName: form.name,
    data: data,
    relatedType: relatedType || "",
    relatedId: relatedId || "",
    createdBy: createdBy || "",
    createdAt: new Date().toISOString()
  };
  
  await dbPut(S_FORM_DATA, formData);
  
  // 同步到云端（失败不影响本地）
  if (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase) {
    try { await Cloud.syncFormData(formData); } catch(e) { console.warn('表单数据同步云端失败', e); }
  }
  
  return formData;
}

// 获取表单数据列表
async function getFormDataList(formId, relatedType, relatedId) {
  let list = await dbGetAll(S_FORM_DATA);
  if (formId) list = list.filter(d => d.formId === formId);
  if (relatedType) list = list.filter(d => d.relatedType === relatedType);
  if (relatedId) list = list.filter(d => d.relatedId === relatedId);
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// 显示已删除表单的填写记录
async function showDeletedFormRecords() {
  const container = document.getElementById("deleted-records-container");
  if (!container) return;
  
  // 获取所有表单模板的ID
  const forms = await dbGetAll(S_FORM);
  const formIds = new Set(forms.map(f => f.id));
  
  // 获取所有表单记录，筛选出表单模板已被删除的
  const allRecords = await dbGetAll(S_FORM_DATA);
  const deletedRecords = allRecords.filter(r => !formIds.has(r.formId));
  
  if (deletedRecords.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:60px;color:#999"><div style="font-size:48px;margin-bottom:16px">✅</div><div>没有已删除表单的记录</div><div style="font-size:12px;margin-top:8px">所有填写记录的表单模板都还在</div></div>';
    openModal("modal-deleted-form-records");
    return;
  }
  
  // 按表单名称分组
  const grouped = {};
  deletedRecords.forEach(r => {
    const key = r.formName || "未知表单";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  });
  
  let html = `<div style="margin-bottom:16px;padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:13px;color:#92400e">
    ⚠️ 共找到 <b>${deletedRecords.length}</b> 条记录，它们的表单模板已被删除，但填写的数据保留了下来。
  </div>`;
  
  for (const [formName, records] of Object.entries(grouped)) {
    html += `<div style="margin-bottom:20px">
      <div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">
        📋 ${formName} <span style="font-size:12px;color:#9ca3af;font-weight:normal">（${records.length} 条记录）</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px">`;
    
    records.forEach(r => {
      const date = formatDate(r.createdAt);
      const dataCount = r.data ? Object.keys(r.data).filter(k => r.data[k]).length : 0;
      html += `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px;transition:all .15s"
             onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,.08)'"
             onmouseout="this.style.boxShadow='none'">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
            <div style="font-size:13px;font-weight:500;color:#1f2937">记录 #${r.id.slice(-8)}</div>
            <span style="font-size:11px;color:#9ca3af">${date}</span>
          </div>
          <div style="font-size:12px;color:#6b7280;margin-bottom:8px">
            ${r.createdBy ? '👤 ' + r.createdBy : ''} 
            ${r.relatedType ? ' · 🔗 ' + r.relatedType : ''}
          </div>
          <div style="font-size:11px;color:#9ca3af;margin-bottom:10px">已填写 ${dataCount} 个字段</div>
          <div style="display:flex;gap:6px">
            <button class="btn ghost small" style="flex:1;font-size:11px;padding:4px 8px" onclick="viewDeletedRecord('${r.id}')">查看详情</button>
            <button class="btn ghost small" style="flex:1;font-size:11px;padding:4px 8px" onclick="exportDeletedRecord('${r.id}')">导出</button>
          </div>
        </div>`;
    });
    
    html += '</div></div>';
  }
  
  container.innerHTML = html;
  openModal("modal-deleted-form-records");
}

// 查看已删除表单的单条记录详情
async function viewDeletedRecord(recordId) {
  const allRecords = await dbGetAll(S_FORM_DATA);
  const record = allRecords.find(r => r.id === recordId);
  if (!record) { showToast("记录不存在"); return; }
  
  let html = `<div style="padding:20px">
    <div style="font-size:18px;font-weight:bold;margin-bottom:16px">📋 ${record.formName || '未知表单'}</div>
    <div style="background:#f9fafb;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;color:#6b7280">
      <div>记录ID：${record.id}</div>
      <div>填写时间：${formatDate(record.createdAt)}</div>
      <div>填写人：${record.createdBy || '未知'}</div>
      ${record.relatedType ? '<div>关联：' + record.relatedType + (record.relatedId ? ' (' + record.relatedId + ')' : '') + '</div>' : ''}
    </div>
    <div style="font-size:14px;font-weight:600;margin-bottom:12px">填写内容：</div>
    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">`;
  
  if (record.data && Object.keys(record.data).length > 0) {
    Object.entries(record.data).forEach(([key, value], index) => {
      const bg = index % 2 === 0 ? '#fff' : '#f9fafb';
      let displayValue = value;
      if (typeof value === 'string' && value.startsWith('data:image')) {
        displayValue = '[图片]';
      } else if (Array.isArray(value)) {
        displayValue = value.join('、');
      } else if (value === '' || value === null || value === undefined) {
        displayValue = '<span style="color:#ccc">（空）</span>';
      }
      html += `<div style="display:flex;padding:10px 16px;background:${bg};border-bottom:1px solid #f3f4f6">
        <div style="width:140px;color:#6b7280;font-size:13px;flex-shrink:0">${key}</div>
        <div style="flex:1;color:#1f2937;font-size:13px;word-break:break-all">${displayValue}</div>
      </div>`;
    });
  } else {
    html += '<div style="padding:20px;text-align:center;color:#999">无填写内容</div>';
  }
  
  html += '</div></div>';
  
  // 用一个简单的弹窗显示详情
  const detailModal = document.createElement("div");
  detailModal.className = "modal";
  detailModal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center";
  detailModal.innerHTML = `<div style="background:#fff;border-radius:12px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;position:relative">
    <button onclick="this.closest('.modal').remove()" style="position:absolute;top:12px;right:12px;background:none;border:none;font-size:20px;cursor:pointer;color:#999">✕</button>
    ${html}
  </div>`;
  detailModal.onclick = (e) => { if (e.target === detailModal) detailModal.remove(); };
  document.body.appendChild(detailModal);
}

// 导出已删除表单的单条记录
async function exportDeletedRecord(recordId) {
  const allRecords = await dbGetAll(S_FORM_DATA);
  const record = allRecords.find(r => r.id === recordId);
  if (!record) { showToast("记录不存在"); return; }
  
  let text = `表单名称：${record.formName || '未知表单'}\n`;
  text += `记录ID：${record.id}\n`;
  text += `填写时间：${formatDate(record.createdAt)}\n`;
  text += `填写人：${record.createdBy || '未知'}\n`;
  if (record.relatedType) text += `关联：${record.relatedType} ${record.relatedId || ''}\n`;
  text += `\n========== 填写内容 ==========\n`;
  
  if (record.data && Object.keys(record.data).length > 0) {
    Object.entries(record.data).forEach(([key, value]) => {
      let displayValue = value;
      if (typeof value === 'string' && value.startsWith('data:image')) {
        displayValue = '[图片数据]';
      } else if (Array.isArray(value)) {
        displayValue = value.join('、');
      }
      text += `${key}：${displayValue}\n`;
    });
  }
  
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${record.formName || '表单记录'}_${record.id.slice(-8)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("记录已导出");
}

// 格式化日期
function formatDate(dateStr) {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch (e) {
    return dateStr;
  }
}

// ============================================================
// 业务集成工具函数（巡检/维保/验收/扫码 关联自定义表单）
// ============================================================

// 获取所有可用表单（未删除）
async function getActiveForms() {
  let forms = await dbGetAll(S_FORM);
  forms = forms.filter(f => !f.deleted);
  return forms.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

// 渲染表单选择下拉框
// containerId: 容器ID, selectedId: 已选表单ID, onChange: 回调函数(formId)
async function renderFormSelector(containerId, selectedId, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const forms = await getActiveForms();
  if (forms.length === 0) {
    container.innerHTML = '<span style="color:#9ca3af;font-size:12px">暂无可用表单，请先在「表单管理」中创建</span>';
    return;
  }
  let options = '<option value="">-- 不使用表单 --</option>';
  forms.forEach(f => {
    options += `<option value="${f.id}" ${f.id === selectedId ? 'selected' : ''}>${f.name || '未命名表单'}</option>`;
  });
  container.innerHTML = `<select style="padding:6px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;min-width:200px;box-sizing:border-box" onchange="window._formSelectorOnChange && window._formSelectorOnChange(this.value)">${options}</select>`;
  if (onChange) {
    window._formSelectorOnChange = onChange;
  }
}

// 渲染表单填写区域（根据表单ID）
// 返回 form 对象，供后续 collectFormData 使用
async function renderFormFillById(formId, containerId, data, readonly) {
  if (!formId) {
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = '';
    return null;
  }
  let forms = await dbGetAll(S_FORM);
  let form = forms.find(f => f.id === formId);
  if (!form) {
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = '<div style="color:#ef4444;padding:12px;font-size:13px">表单不存在或已被删除</div>';
    return null;
  }
  form = migrateFormData(form);
  renderFormFill(form, data || {}, containerId, readonly || false);
  return form;
}

// 收集并保存表单数据，返回 formData 记录
async function collectAndSaveFormData(form, relatedType, relatedId, createdBy) {
  if (!form) return null;
  const data = collectFormData(form);
  const valid = validateForm(form, data);
  if (!valid.ok) {
    showToast("请填写必填项：" + valid.missing.join("、"));
    return null;
  }
  const formData = await saveFormData(form.id, data, relatedType, relatedId, createdBy);
  return formData;
}

// 根据关联类型和ID获取表单数据
async function getFormDataByRelation(relatedType, relatedId) {
  let list = await dbGetAll(S_FORM_DATA);
  if (relatedType) list = list.filter(d => d.relatedType === relatedType);
  if (relatedId) list = list.filter(d => d.relatedId === relatedId);
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// 查看关联的表单数据（弹窗显示）
async function viewRelatedFormData(relatedType, relatedId, title) {
  const list = await getFormDataByRelation(relatedType, relatedId);
  if (list.length === 0) {
    showToast("该记录暂无关联的表单数据");
    return;
  }
  
  let html = '';
  for (const record of list) {
    html += `<div style="margin-bottom:20px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <div style="background:#f9fafb;padding:10px 14px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;font-weight:600;color:#1f2937">📋 ${record.formName || '未命名表单'}</span>
        <span style="font-size:11px;color:#9ca3af">${formatDate(record.createdAt)} ${record.createdBy ? '· ' + record.createdBy : ''}</span>
      </div>
      <div style="padding:14px">`;
    
    if (record.data && Object.keys(record.data).length > 0) {
      Object.entries(record.data).forEach(([key, value]) => {
        let displayValue = value;
        if (typeof value === 'string' && value.startsWith('data:image')) {
          displayValue = `<img src="${value}" style="max-width:200px;max-height:150px;border-radius:4px;margin-top:4px"/>`;
        } else if (Array.isArray(value)) {
          displayValue = value.join('、');
        } else if (value === null || value === undefined || value === '') {
          displayValue = '<span style="color:#d1d5db">未填写</span>';
        }
        html += `<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed #f3f4f6">
          <div style="font-size:12px;color:#6b7280;margin-bottom:2px">${key}</div>
          <div style="font-size:13px;color:#1f2937">${displayValue}</div>
        </div>`;
      });
    } else {
      html += '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:20px">无填写内容</div>';
    }
    html += '</div></div>';
  }
  
  // 用弹窗显示
  const detailModal = document.createElement("div");
  detailModal.className = "modal";
  detailModal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center";
  detailModal.innerHTML = `<div style="background:#fff;border-radius:12px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;position:relative">
    <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;z-index:1">
      <span style="font-size:15px;font-weight:600;color:#1f2937">${title || '关联表单数据'}（${list.length}条）</span>
      <button onclick="this.closest('.modal').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#9ca3af;padding:0 4px">✕</button>
    </div>
    <div style="padding:16px 20px">${html}</div>
  </div>`;
  detailModal.onclick = (e) => { if (e.target === detailModal) detailModal.remove(); };
  document.body.appendChild(detailModal);
}

// 导出关联表单数据为文本
async function exportRelatedFormData(relatedType, relatedId, filename) {
  const list = await getFormDataByRelation(relatedType, relatedId);
  if (list.length === 0) { showToast("无表单数据可导出"); return; }
  
  let text = '';
  list.forEach((record, idx) => {
    text += `\n========== 表单 ${idx + 1}：${record.formName || '未命名'} ==========\n`;
    text += `填写时间：${formatDate(record.createdAt)}\n`;
    text += `填写人：${record.createdBy || '未知'}\n\n`;
    if (record.data && Object.keys(record.data).length > 0) {
      Object.entries(record.data).forEach(([key, value]) => {
        let displayValue = value;
        if (typeof value === 'string' && value.startsWith('data:image')) {
          displayValue = '[图片]';
        } else if (Array.isArray(value)) {
          displayValue = value.join('、');
        }
        text += `${key}：${displayValue}\n`;
      });
    }
  });
  
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `表单数据_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("表单数据已导出");
}
