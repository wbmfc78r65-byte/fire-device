/* ============================================================
 * db.js - 数据库层（IndexedDB + 多项目独立数据库）
 * ============================================================ */

const META_DB_NAME = "FireMapDB_Meta";
const DB_VER = 39;
const SB = "building", SF = "floor", SD = "device", SL = "maintainLog", SLEG = "legend", SIMG = "images", SVEC = "vectorShapes";
const S_TASK = "inspectTask", S_LOG = "inspectLog", S_OPLOG = "operationLog";
const S_PLAN = "inspectPlan", S_HIDDEN = "hiddenDanger", S_WORKORDER = "workOrder";
const S_PARTS = "parts", S_EMERGENCY = "emergencyPlan", S_DRILL = "drillRecord";
const S_IOT = "iotDevice", S_AI = "aiRecord", S_ROUTE = "inspectRoute", S_ROUTE_LOG = "routeLog";
const S_FORM = "customForm", S_FORM_DATA = "formData";

let db = null;
let metaDB = null;
let currentProjectId = null;

const genId = () => Date.now() + Math.random().toString(36);
const $ = id => document.getElementById(id);

/* ---------- 工具函数（全局共享） ---------- */
const showToast = m => {
  const t = $("toast");
  let msg = (m == null) ? "" : String(m);
  if (msg.length > 200) {
    console.warn("[showToast] 超长内容被截断, 长度=" + msg.length + ", 前50字符=" + msg.substring(0, 50));
    console.trace("[showToast] 调用来源");
    msg = msg.substring(0, 80) + "...(内容过长)";
  }
  t.innerText = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 1800);
};
const closeModal = id => $(id).classList.add("hidden");
const closeAllModals = () => document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
const openModal = id => {
  if (typeof hideContextMenu === 'function') hideContextMenu();
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove("hidden");
  // 确保弹窗有关闭按钮
  ensureModalCloseButton(modal);
  if (typeof fixAccessibility === 'function') fixAccessibility(modal);
};

// 确保弹窗有关闭按钮（每次打开弹窗时调用，兼容动态创建的弹窗）
function ensureModalCloseButton(modal) {
  if (!modal) return;
  // 跳过自定义确认弹窗（有自己的关闭逻辑）
  if (modal.id === 'custom-confirm-modal') return;
  // 巡检记录弹窗结构特殊（position:fixed），已手动添加关闭按钮，跳过
  if (modal.id === 'modal-inspect-records') return;

  const box = modal.querySelector('.modal-box');
  if (!box) return;

  // 只检查是否有JS添加的关闭按钮，避免误判
  if (box.querySelector('.modal-close-btn')) return;

  // 设置相对定位（关闭按钮需要父元素有定位）
  // 注意：不覆盖已有的 fixed/absolute 定位
  if (!box.style.position || box.style.position === 'static') {
    box.style.position = 'relative';
  }

  // 创建关闭按钮
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close-btn';
  closeBtn.innerHTML = '✕';
  closeBtn.style.cssText = `
    position: absolute;
    top: 14px;
    right: 14px;
    background: #f5f5f5;
    border: none;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    font-size: 14px;
    cursor: pointer;
    color: #666;
    line-height: 1;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  `;
  closeBtn.onmouseover = () => { closeBtn.style.background = '#ef4444'; closeBtn.style.color = '#fff'; };
  closeBtn.onmouseout = () => { closeBtn.style.background = '#f5f5f5'; closeBtn.style.color = '#666'; };
  closeBtn.onclick = (e) => { e.stopPropagation(); closeModal(modal.id); };

  box.appendChild(closeBtn);

  // 弹窗结构改造：把"整体滚动型"弹窗变成"固定头部 + 滚动内容区 + 固定底部"
  // 标题和关闭按钮天然固定在顶部，不依赖 sticky（sticky 在部分弹窗不可靠）
  const children = Array.from(box.children).filter(el => el.tagName !== 'BUTTON' || !el.classList.contains('modal-close-btn'));
  if (children.length > 0) {
    const firstChild = children[0];
    const boxCS = window.getComputedStyle(box);
    // 仅处理"整体滚动型"弹窗（modal-box 自身 overflowY:auto 滚动，标题在滚动区内）
    // flex 型弹窗（头部固定+内容独立滚动，如巡检记录/补录巡检/表单管理）保持原结构，不受影响
    const isWholeScrollBox = (boxCS.overflowY === 'auto' || boxCS.overflowY === 'scroll') && boxCS.position !== 'fixed';
    // 标题判定：第一个子元素是 h1-h6，或内部包含 h1-h6 标题
    const isTitleEl = /^H[1-6]$/i.test(firstChild.tagName) || (firstChild.querySelector && firstChild.querySelector('h1,h2,h3,h4,h5,h6') !== null);
    // 避免重复改造（弹窗关闭再打开时会再次调用本函数）
    const alreadyRebuilt = box.querySelector('.modal-fixed-header, .modal-scroll-content');
    if (isWholeScrollBox && isTitleEl && !alreadyRebuilt && modal.id !== 'modal-field-config') {
      // 1. 固定头部：把标题元素移入头部容器
      const header = document.createElement('div');
      header.className = 'modal-fixed-header';
      header.style.cssText = 'flex-shrink:0;background:#fff;padding:14px 56px 12px 18px;border-bottom:1px solid #e5e7eb;position:relative;z-index:50';
      box.insertBefore(header, firstChild);
      header.appendChild(firstChild);
      firstChild.style.margin = '0';
      // 2. 底部按钮行（modal-btn-row）单独保留，固定在底部
      let bottomRow = null;
      const rest = Array.from(box.children).filter(el => el !== header && el !== closeBtn);
      const last = rest[rest.length - 1];
      if (last && last.classList && last.classList.contains('modal-btn-row')) {
        bottomRow = last;
        rest.pop();
      }
      // 3. 其余内容包进滚动区（独立滚动，标题/圆叉/底部按钮都不动）
      const scrollWrap = document.createElement('div');
      scrollWrap.className = 'modal-scroll-content';
      scrollWrap.style.cssText = 'flex:1;overflow-y:auto;min-height:0;padding:16px 18px';
      rest.forEach(el => scrollWrap.appendChild(el));
      box.appendChild(scrollWrap);
      // 4. 底部按钮行固定
      if (bottomRow) {
        bottomRow.style.cssText = (bottomRow.style.cssText || '') + ';flex-shrink:0;margin:0;padding:12px 18px;border-top:1px solid #e5e7eb;background:#fff';
        box.appendChild(bottomRow);
      }
      // 5. modal-box 改成 flex 纵向布局，自身不再滚动（滚动交给内容区）
      box.style.cssText = (box.style.cssText || '') + ';display:flex;flex-direction:column;overflow:hidden;padding:0';
      // 关闭按钮 absolute 相对 box 定位，box 不滚动后天然固定不动
      closeBtn.style.top = '14px';
    } else {
      // 非标题开头或 flex 型弹窗：只给块级元素添加右边距，避免与关闭按钮重叠
      const computedStyle = window.getComputedStyle(firstChild);
      if (computedStyle.display !== 'inline' && computedStyle.display !== 'inline-block') {
        // 关闭按钮需要 28px宽 + 14px右间距 + 14px内容间距 = 56px
        const existingPadding = parseFloat(computedStyle.paddingRight) || 0;
        if (existingPadding < 50) {
          firstChild.style.paddingRight = '56px';
          // 确保 box-sizing 正确
          if (!firstChild.style.boxSizing) {
            firstChild.style.boxSizing = 'border-box';
          }
        }
      }
    }
  }
}

function calcDeviceLife(dev) {
  if (!dev.installDate || !dev.lifeYears || dev.lifeYears <= 0) return { age: 0, remain: Infinity, status: 'none' };
  const age = (new Date() - new Date(dev.installDate)) / (365.25 * 24 * 3600 * 1000);
  const remain = dev.lifeYears - age;
  return { age: age.toFixed(1), remain: remain.toFixed(1), status: remain <= 0 ? 'expire' : remain <= 1 ? 'warn' : 'ok' };
}
function lifeTagHTML(dev) {
  const l = calcDeviceLife(dev);
  if (l.status === 'none') return '';
  if (l.status === 'ok') return `<span class="life-tag ok">剩余${l.remain}年</span>`;
  if (l.status === 'warn') return `<span class="life-tag warn">即将报废(${l.remain}年)</span>`;
  return `<span class="life-tag danger">已超期${Math.abs(l.remain)}年</span>`;
}
const sortByOrder = list => list.slice().sort((a, b) => (a.sortOrder !== undefined ? a.sortOrder : 9999) - (b.sortOrder !== undefined ? b.sortOrder : 9999));
const sortBuildings = bs => sortByOrder(bs);
const sortFloors = fs => sortByOrder(fs);

/* ---------- 项目管理（Meta数据库） ---------- */
function getBusinessDBName(projectId) {
  // 兼容旧数据：默认项目使用旧数据库名 FireMapDB
  if (projectId === "default") return "FireMapDB";
  return "FireMapDB_" + projectId;
}

function getCurrentProjectId() {
  try { return localStorage.getItem("firemap_current_project") || "default"; } catch(e) { return "default"; }
}

function setCurrentProjectId(id) {
  try { localStorage.setItem("firemap_current_project", id); } catch(e) {}
  currentProjectId = id;
}

function openMetaDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(META_DB_NAME, 1);
    r.onupgradeneeded = e => {
      const mdb = e.target.result;
      if (!mdb.objectStoreNames.contains("projects")) {
        mdb.createObjectStore("projects", { keyPath: "id" });
      }
    };
    r.onsuccess = e => { metaDB = e.target.result; res(metaDB); };
    r.onerror = e => rej(e.target.error);
  });
}

function metaPut(project) {
  return new Promise(r => {
    const t = metaDB.transaction("projects", "readwrite");
    t.objectStore("projects").put(project);
    t.oncomplete = r;
  });
}

function metaGetAll() {
  return new Promise(res => {
    const a = [];
    const r = metaDB.transaction("projects").objectStore("projects").openCursor();
    r.onsuccess = e => { const c = e.target.result; if (c) { a.push(c.value); c.continue(); } else res(a); };
  });
}

function metaDel(id) {
  return new Promise(r => {
    const t = metaDB.transaction("projects", "readwrite");
    t.objectStore("projects").delete(id);
    t.oncomplete = r;
  });
}

async function ensureDefaultProject() {
  const projects = await metaGetAll();
  if (projects.length === 0) {
    // 创建默认项目，使用旧数据库名（兼容现有数据）
    const defaultProject = {
      id: "default",
      name: "默认项目",
      remark: "系统自动创建",
      createdAt: new Date().toISOString(),
      isActive: true
    };
    await metaPut(defaultProject);
    setCurrentProjectId("default");
    return defaultProject;
  }
  // 确保有且只有一个active项目
  const active = projects.find(p => p.isActive);
  if (!active) {
    projects[0].isActive = true;
    await metaPut(projects[0]);
    setCurrentProjectId(projects[0].id);
  } else {
    setCurrentProjectId(active.id);
  }
  return active || projects[0];
}

/* ---------- 打开业务数据库（含迁移） ---------- */
function openDB(projectId) {
  projectId = projectId || getCurrentProjectId();
  const dbName = getBusinessDBName(projectId);
  return new Promise((res, rej) => {
    const r = indexedDB.open(dbName, DB_VER);
    r.onupgradeneeded = e => {
      db = e.target.result;
      const tx = e.target.transaction;
      [SB, SF, SD, SL].forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" }); });
      if (!db.objectStoreNames.contains(SLEG)) {
        const os = db.createObjectStore(SLEG, { keyPath: "id" });
        defaultLegend.forEach(i => os.add(i));
      }
      if (!db.objectStoreNames.contains(SIMG)) db.createObjectStore(SIMG, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SVEC)) {
        const os = db.createObjectStore(SVEC, { keyPath: "id" });
        os.createIndex("floorId", "floorId", { unique: false });
      }
      if (!db.objectStoreNames.contains(S_TASK)) {
        const os = db.createObjectStore(S_TASK, { keyPath: "id" });
        os.createIndex("status", "status", { unique: false });
        os.createIndex("assignee", "assignee", { unique: false });
        os.createIndex("planDate", "planDate", { unique: false });
      }
      if (!db.objectStoreNames.contains(S_LOG)) {
        const os = db.createObjectStore(S_LOG, { keyPath: "id" });
        os.createIndex("deviceId", "deviceId", { unique: false });
        os.createIndex("taskId", "taskId", { unique: false });
        os.createIndex("inspectDate", "inspectDate", { unique: false });
      }
      if (!db.objectStoreNames.contains(S_OPLOG)) {
        const os = db.createObjectStore(S_OPLOG, { keyPath: "id" });
        os.createIndex("userId", "userId", { unique: false });
        os.createIndex("action", "action", { unique: false });
        os.createIndex("time", "time", { unique: false });
      }
      // 巡检计划
      if (!db.objectStoreNames.contains(S_PLAN)) {
        const os = db.createObjectStore(S_PLAN, { keyPath: "id" });
        os.createIndex("cycle", "cycle", { unique: false });
        os.createIndex("status", "status", { unique: false });
        os.createIndex("nextDate", "nextDate", { unique: false });
      }
      // 隐患整改
      if (!db.objectStoreNames.contains(S_HIDDEN)) {
        const os = db.createObjectStore(S_HIDDEN, { keyPath: "id" });
        os.createIndex("deviceId", "deviceId", { unique: false });
        os.createIndex("status", "status", { unique: false });
        os.createIndex("level", "level", { unique: false });
        os.createIndex("deadline", "deadline", { unique: false });
        os.createIndex("assignee", "assignee", { unique: false });
      }
      // 维保工单
      if (!db.objectStoreNames.contains(S_WORKORDER)) {
        const os = db.createObjectStore(S_WORKORDER, { keyPath: "id" });
        os.createIndex("deviceId", "deviceId", { unique: false });
        os.createIndex("status", "status", { unique: false });
        os.createIndex("priority", "priority", { unique: false });
        os.createIndex("assignee", "assignee", { unique: false });
        os.createIndex("createdAt", "createdAt", { unique: false });
      }
      // 备件库存
      if (!db.objectStoreNames.contains(S_PARTS)) {
        const os = db.createObjectStore(S_PARTS, { keyPath: "id" });
        os.createIndex("name", "name", { unique: false });
        os.createIndex("category", "category", { unique: false });
      }
      // 应急预案
      if (!db.objectStoreNames.contains(S_EMERGENCY)) {
        const os = db.createObjectStore(S_EMERGENCY, { keyPath: "id" });
        os.createIndex("type", "type", { unique: false });
      }
      // 演练记录
      if (!db.objectStoreNames.contains(S_DRILL)) {
        const os = db.createObjectStore(S_DRILL, { keyPath: "id" });
        os.createIndex("planId", "planId", { unique: false });
        os.createIndex("date", "date", { unique: false });
      }
      // 物联网设备
      if (!db.objectStoreNames.contains(S_IOT)) {
        const os = db.createObjectStore(S_IOT, { keyPath: "id" });
        os.createIndex("status", "status", { unique: false });
        os.createIndex("type", "type", { unique: false });
      }
      // AI识别记录
      if (!db.objectStoreNames.contains(S_AI)) {
        const os = db.createObjectStore(S_AI, { keyPath: "id" });
        os.createIndex("createdAt", "createdAt", { unique: false });
      }
      // 巡检路线
      if (!db.objectStoreNames.contains(S_ROUTE)) {
        const os = db.createObjectStore(S_ROUTE, { keyPath: "id" });
        os.createIndex("floorId", "floorId", { unique: false });
      }
      // 路线巡检记录
      if (!db.objectStoreNames.contains(S_ROUTE_LOG)) {
        const os = db.createObjectStore(S_ROUTE_LOG, { keyPath: "id" });
        os.createIndex("routeId", "routeId", { unique: false });
        os.createIndex("date", "date", { unique: false });
      }
      // 自定义表单定义
      if (!db.objectStoreNames.contains(S_FORM)) {
        const os = db.createObjectStore(S_FORM, { keyPath: "id" });
        os.createIndex("category", "category", { unique: false });
        os.createIndex("status", "status", { unique: false });
      }
      // 自定义表单数据
      if (!db.objectStoreNames.contains(S_FORM_DATA)) {
        const os = db.createObjectStore(S_FORM_DATA, { keyPath: "id" });
        os.createIndex("formId", "formId", { unique: false });
        os.createIndex("relatedType", "relatedType", { unique: false });
        os.createIndex("relatedId", "relatedId", { unique: false });
        os.createIndex("createdAt", "createdAt", { unique: false });
      }
      const floorStore = tx.objectStore(SF);
      if (!floorStore.indexNames.contains("buildingId")) floorStore.createIndex("buildingId", "buildingId", { unique: false });
      const devStore = tx.objectStore(SD);
      ["floorId", "deviceType", "status"].forEach(idx => {
        if (!devStore.indexNames.contains(idx)) devStore.createIndex(idx, idx, { unique: false });
      });
      if (e.oldVersion < 31 && e.oldVersion > 0) migrateOldImages(tx);
    };
    r.onsuccess = e => { db = e.target.result; res(db); };
    r.onerror = e => rej(e.target.error);
  });
}

function migrateOldImages(tx) {
  const floorReq = tx.objectStore(SF).openCursor();
  floorReq.onsuccess = e => {
    const cur = e.target.result;
    if (!cur) return;
    const f = cur.value;
    if (f.imageDataUrl && !f.imageId) {
      const imgId = "img_" + genId();
      tx.objectStore(SIMG).put({ id: imgId, data: f.imageDataUrl });
      delete f.imageDataUrl;
      f.imageId = imgId;
      cur.update(f);
    }
    cur.continue();
  };
  const devReq = tx.objectStore(SD).openCursor();
  devReq.onsuccess = e => {
    const cur = e.target.result;
    if (!cur) return;
    const d = cur.value;
    if (d.photo && !d.photoId) {
      const imgId = "photo_" + genId();
      tx.objectStore(SIMG).put({ id: imgId, data: d.photo });
      delete d.photo;
      d.photoId = imgId;
      cur.update(d);
    }
    cur.continue();
  };
}

/* ---------- 通用 CRUD ---------- */
const dbPut = (s, o) => new Promise(r => { const t = db.transaction(s, "readwrite"); t.objectStore(s).put(o); t.oncomplete = r; });
// 批量写入（一个事务，比循环dbPut快很多）
const dbBulkPut = (s, items) => new Promise((res, rej) => {
  if (!items || items.length === 0) { res(true); return; }
  const t = db.transaction(s, "readwrite");
  const store = t.objectStore(s);
  items.forEach(o => store.put(o));
  t.oncomplete = () => res(true);
  t.onerror = () => rej(t.error);
});
const dbGetAll = s => new Promise(res => {
  const a = [];
  const r = db.transaction(s).objectStore(s).openCursor();
  r.onsuccess = e => { const c = e.target.result; if (c) { a.push(c.value); c.continue(); } else res(a); };
});
const dbDel = (s, id) => new Promise(r => { const t = db.transaction(s, "readwrite"); t.objectStore(s).delete(id); t.oncomplete = r; });

/* ---------- 按索引查询 ---------- */
function getByIndex(store, indexName, value) {
  return new Promise(res => {
    const a = [];
    const r = db.transaction(store).objectStore(store).index(indexName).openCursor(IDBKeyRange.only(value));
    r.onsuccess = e => { const c = e.target.result; if (c) { a.push(c.value); c.continue(); } else res(a); };
  });
}
const getDevicesByFloor = floorId => getByIndex(SD, "floorId", floorId);
const getFloorsByBuilding = bid => getByIndex(SF, "buildingId", bid);
const getDevicesByType = type => getByIndex(SD, "deviceType", type);
const getDevicesByStatus = status => getByIndex(SD, "status", status);
const getVectorShapesByFloor = floorId => getByIndex(SVEC, "floorId", floorId);

/* ---------- 图片存储 ---------- */
function saveImage(dataUrl) {
  return new Promise(res => {
    const id = "img_" + genId();
    const t = db.transaction(SIMG, "readwrite");
    t.objectStore(SIMG).put({ id, data: dataUrl });
    t.oncomplete = () => res(id);
  });
}
function getImage(id) {
  return new Promise(res => {
    if (!id) return res(null);
    const r = db.transaction(SIMG).objectStore(SIMG).get(id);
    r.onsuccess = () => res(r.result ? r.result.data : null);
    r.onerror = () => res(null);
  });
}
function deleteImage(id) {
  if (!id) return Promise.resolve();
  return dbDel(SIMG, id);
}

/* ---------- 图例 ---------- */
const getAllLegend = async () => {
  const list = await dbGetAll(SLEG);
  return list.sort((a, b) => (a.sortOrder != null ? a.sortOrder : 999) - (b.sortOrder != null ? b.sortOrder : 999));
};
const getLegendSize = leg => Math.round((leg.size || 32) * (typeof globalMarkerScale !== 'undefined' ? globalMarkerScale : 1));
function getIconDim(leg, max) {
  if (!leg || !leg.icon || !leg.iconW || !leg.iconH) return { w: max, h: max };
  const r = leg.iconW / leg.iconH;
  return r >= 1 ? { w: max, h: Math.max(8, max / r) } : { w: Math.max(8, max * r), h: max };
}
function legendIconHTML(item, size) {
  size = size || 24;
  if (item.icon) { const d = getIconDim(item, size); return `<img src="${item.icon}" alt="" style="width:${d.w}px;height:${d.h}px;display:block;flex-shrink:0" draggable="false"/>`; }
  const shape = item.shape || "circle";
  const borderRadius = shape === "square" ? "4px" : "50%";
  return `<div style="width:${size}px;height:${size}px;background:${item.color};border-radius:${borderRadius};flex-shrink:0"></div>`;
}
function draggableHTML(item, size) {
  return `<div class="draggable-legend" draggable="true" data-type="${item.name}">${legendIconHTML(item, size || 24)}<span>${item.name}</span></div>`;
}

/* ---------- 预设消防矢量图标库（SVG，可编辑持久化） ---------- */
const defaultFireIcons = {
  "室内消火栓": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8 2 6 5 6 8v2h12V8c0-3-2-6-6-6zm-4 8v10h2v-4h4v4h2V10H8z"/></svg>',
  "灭火器": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 3v2h-1v1h-2V5h-1V3h4zm-3 4h2v1h-2V7zm-1 2h4v12h-4V9z"/></svg>',
  "烟感探测器": '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="#fff"/></svg>',
  "喷淋头": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2v6M9 8h6l-1 4h-4l-1-4zM8 14h8v2H8zM10 17h4v2h-4z"/></svg>',
  "防火门": '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="3" width="16" height="18" rx="1"/><circle cx="16" cy="12" r="1.5" fill="#fff"/></svg>',
  "应急照明灯": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 00-4 12.7V19h8v-4.3A7 7 0 0012 2zm-2 20h4v1h-4z"/></svg>',
  "疏散指示标志": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h16v14H4V5zm8 3l4 4-4 4v-3H8v-2h4V8z"/></svg>',
  "消防水泵接合器": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2v4M8 6h8v2H8V6zm-2 4h12v3H6v-3zm2 5h8v8H8v-8z"/></svg>',
  "手动报警按钮": '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" fill="#fff"/></svg>',
  "防火分区": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" stroke-dasharray="4 2"/></svg>',
  "疏散通道": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16M14 6l6 6-6 6"/></svg>',
  "安全出口": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 4h2v16h-2V4zm-9 8l5-5v3h5v4h-5v3l-5-5z"/></svg>'
};
let fireIconLibrary = {};
function loadFireIcons() {
  try {
    const s = localStorage.getItem("firemap_custom_icons");
    fireIconLibrary = s ? JSON.parse(s) : JSON.parse(JSON.stringify(defaultFireIcons));
  } catch (e) { fireIconLibrary = JSON.parse(JSON.stringify(defaultFireIcons)); }
}
function saveFireIcons() {
  try { localStorage.setItem("firemap_custom_icons", JSON.stringify(fireIconLibrary)); } catch (e) { }
}
function resetFireIcons() { fireIconLibrary = JSON.parse(JSON.stringify(defaultFireIcons)); saveFireIcons(); }

const defaultLegend = [
  { id: "leg1", name: "室内消火栓", color: "#d92121", icon: "", iconW: 0, iconH: 0, size: 32 },
  { id: "leg2", name: "灭火器", color: "#f27022", icon: "", iconW: 0, iconH: 0, size: 28 },
  { id: "leg3", name: "烟感探测器", color: "#2563eb", icon: "", iconW: 0, iconH: 0, size: 24 },
  { id: "leg4", name: "喷淋头", color: "#06a8b9", icon: "", iconW: 0, iconH: 0, size: 22 },
  { id: "leg5", name: "防火门", color: "#8b572a", icon: "", iconW: 0, iconH: 0, size: 30 },
  { id: "leg6", name: "应急照明灯", color: "#e6a223", icon: "", iconW: 0, iconH: 0, size: 28 },
  { id: "leg7", name: "疏散指示标志", color: "#22b559", icon: "", iconW: 0, iconH: 0, size: 26 },
  { id: "leg8", name: "消防水泵接合器", color: "#9347d8", icon: "", iconW: 0, iconH: 0, size: 32 }
];

/* ---------- 撤销 ---------- */
let undoStack = [], undoTimer = null;
function pushUndo(store, data, desc) {
  undoStack.push({ store, data: JSON.parse(JSON.stringify(data)), desc, time: Date.now() });
  if (undoStack.length > 30) undoStack.shift();
}
function showUndoBar(desc) {
  $("undo-text").innerText = `已删除：${desc}`;
  $("undo-bar").classList.add("show");
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => $("undo-bar").classList.remove("show"), 12000);
}
function hideUndoBar() { $("undo-bar").classList.remove("show"); if (undoTimer) clearTimeout(undoTimer); }
async function undoLast() {
  if (!undoStack.length) { showToast("没有可撤销的操作"); return; }
  const item = undoStack.pop(); hideUndoBar();
  try {
    if (item.store === 'cascade') {
      await dbBulkPut(SB, item.data.buildings || []);
      await dbBulkPut(SF, item.data.floors || []);
      await dbBulkPut(SD, item.data.devices || []);
      await dbBulkPut(SL, item.data.logs || []);
      await dbBulkPut(SL, item.data.maintainLogs || []);
      await dbBulkPut(S_LOG, item.data.inspectLogs || []);
      await dbBulkPut(S_WORKORDER, item.data.workOrders || []);
      await dbBulkPut(S_FORM_DATA, item.data.formDataList || []);
      await dbBulkPut(SLEG, item.data.legends || []);
      await dbBulkPut(SIMG, item.data.images || []);
      await dbBulkPut(SVEC, item.data.vectors || []);
    } else await dbPut(item.store, item.data);
    showToast(`↩ 已恢复：${item.desc}`);
    if (typeof refreshAll === 'function') await refreshAll();
  } catch (e) { showToast("恢复失败：" + e.message); }
}
