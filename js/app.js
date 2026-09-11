/* ============================================================
 * app.js - 入口初始化与全局事件
 * 依赖：所有其他模块
 * ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const m = $("context-menu");
  if (m) m.addEventListener('mousedown', e => e.stopPropagation());
  const vm = $("vector-context-menu");
  if (vm) vm.addEventListener('mousedown', e => e.stopPropagation());
  if (typeof initSidebarState === 'function') initSidebarState();
  if (typeof loadFieldConfig === 'function') loadFieldConfig();
  if (typeof initPendingPanelState === 'function') initPendingPanelState();
  // 自动导入扫码巡检记录
  if (typeof importPendingInspectRecords === 'function') importPendingInspectRecords();
  // 打开主系统即同步一次巡检记录状态（自动生成维修/维保工单，无需等待打开列表或刷新）
  if (typeof syncDeviceStatusFromInspectRecords === 'function') {
    setTimeout(() => { syncDeviceStatusFromInspectRecords().catch(() => {}); }, 800);
  }
  // 初始化云端同步
  if (typeof Cloud !== 'undefined') Cloud.init();
  // 扫码实时联动：扫码页提交巡检后，主系统即时刷新设备状态
  let _lastDeviceChange = localStorage.getItem('firemap_device_change') || '';
  window.addEventListener('storage', (e) => {
    if (e.key === 'firemap_device_change' && e.newValue !== e.oldValue) {
      _lastDeviceChange = e.newValue || '';
      if (typeof refreshFromScanRealtime === 'function') refreshFromScanRealtime();
    }
  });
  // 兜底轮询：15秒检查一次变更标记（storage 事件不可靠时也能刷新）
  setInterval(() => {
    try {
      const cur = localStorage.getItem('firemap_device_change') || '';
      if (cur !== _lastDeviceChange) {
        _lastDeviceChange = cur;
        if (typeof refreshFromScanRealtime === 'function') refreshFromScanRealtime();
      }
    } catch(e) {}
  }, 15000);
  // 云端模式兜底：30秒主动拉取一次（手机扫码更新云端后，主系统自动感知）
  setInterval(() => {
    try {
      const cloudOn = (typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.supabase);
      if (cloudOn && typeof refreshFromScanRealtime === 'function') refreshFromScanRealtime();
    } catch(e) {}
  }, 30000);
  // 自动修复可访问性属性
  fixAccessibility();
  // 给所有弹窗添加右上角关闭按钮
  addCloseButtonsToAllModals();
});

// 给所有弹窗动态添加右上角关闭按钮（页面加载时执行）
function addCloseButtonsToAllModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    ensureModalCloseButton(modal);
  });
}

// 自动修复可访问性：给动态创建的表单元素和图片添加必要属性
function fixAccessibility(root) {
  const scope = root || document;
  // 给没有alt的img添加alt=""
  scope.querySelectorAll('img:not([alt])').forEach(img => img.setAttribute('alt', ''));
  // 给没有aria-label和placeholder的input添加aria-label
  scope.querySelectorAll('input:not([aria-label]):not([placeholder])').forEach(input => {
    const label = input.id || input.name || '输入框';
    input.setAttribute('aria-label', label);
  });
  // 给没有aria-label和placeholder的textarea添加aria-label
  scope.querySelectorAll('textarea:not([aria-label]):not([placeholder])').forEach(ta => {
    const label = ta.id || ta.name || '文本编辑';
    ta.setAttribute('aria-label', label);
  });
  // 给没有aria-label的select添加aria-label
  scope.querySelectorAll('select:not([aria-label])').forEach(select => {
    const label = select.id || select.name || '选择框';
    select.setAttribute('aria-label', label);
  });
  // 给没有文字和aria-label的button添加aria-label
  scope.querySelectorAll('button:not([aria-label])').forEach(btn => {
    if (!btn.textContent.trim()) {
      btn.setAttribute('aria-label', btn.id || '按钮');
    }
  });
}

document.addEventListener("click", e => {
  if (!e.target.closest("#context-menu")) hideContextMenu();
  if (!e.target.closest("#vector-context-menu")) hideVectorMenu();
  // 复制模式下，点击地图以外的UI控件自动退出
  if ((typeof singleCopyTemplate !== 'undefined' && singleCopyTemplate) || (typeof multiCopyTemplate !== 'undefined' && multiCopyTemplate)) {
    const inMap = e.target.closest("#map-container");
    const inModal = e.target.closest(".modal");
    const inPopup = e.target.closest(".leaflet-popup");
    const inUndo = e.target.closest("#undo-bar");
    if (!inMap && !inModal && !inPopup && !inUndo) {
      if (typeof exitSingleCopy === 'function' && singleCopyTemplate) exitSingleCopy();
      if (typeof exitMultiCopy === 'function' && multiCopyTemplate) exitMultiCopy();
    }
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    hideContextMenu(); hideVectorMenu(); hideUndoBar(); closeAllModals();
    if (map) map.closePopup();
    clearSelectedMarker();
    if (typeof clearDeviceSelection === 'function') clearDeviceSelection();
    if (resizingMarker) stopResize();
    removeClickBlocker();
    if (drawMode) cancelDraw();
    if (typeof multiCopyTemplate !== 'undefined' && multiCopyTemplate) exitMultiCopy();
    if (typeof crossFloorPasteMode !== 'undefined' && crossFloorPasteMode) exitCrossFloorPaste();
    if (typeof deviceMoveMode !== 'undefined' && deviceMoveMode) {
      deviceMoveMode = false;
      deviceMoveStart = null;
      // 恢复设备拖拽和实体（管理模式下）
      if (typeof markers !== 'undefined') {
        markers.forEach(m => {
          if (manageMode && m.dragging) m.dragging.enable();
          m.setOpacity(1);
        });
      }
      deviceMoveOrigins = [];
      document.body.style.cursor = "";
    }
    // 退出批量移动选择模式
    if (typeof deviceMoveSelectMode !== 'undefined' && deviceMoveSelectMode) {
      deviceMoveSelectMode = false;
      document.body.style.cursor = "";
    }
  }
  // Delete键删除选中设备
  if ((e.key === "Delete" || e.key === "Backspace")) {
    const tag = e.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.target.isContentEditable) {
      if (typeof selectedDeviceIds !== 'undefined' && selectedDeviceIds.length > 0) {
        e.preventDefault();
        deleteSelectedDevices();
      }
    }
  }
  // M键启动批量移动（CAD风格：先选后M 或 先M后选）
  if (e.key === "m" || e.key === "M") {
    const tag = e.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.target.isContentEditable && typeof startDeviceMove === 'function') {
      if (typeof deviceMoveSelectMode !== 'undefined' && deviceMoveSelectMode) {
        // 正在选择对象模式，再次按M确认选择并进入移动
        if (selectedDeviceIds.length > 0) {
          deviceMoveSelectMode = false;
          startDeviceMove();
        } else {
          showToast("未选择任何设备");
          deviceMoveSelectMode = false;
          document.body.style.cursor = "";
        }
      } else if (selectedDeviceIds.length > 0) {
        // 已有选中设备，直接进入移动模式
        startDeviceMove();
      } else {
        // 没有选中设备，进入"选择对象"模式
        deviceMoveSelectMode = true;
        document.body.style.cursor = "crosshair";
        showToast("移动模式：框选要移动的设备，选完后按M确认");
      }
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undoLast(); }
});

/* ---------- 初始化 ---------- */
(async function () {
  checkAuth();
  if (typeof updateAuthUserDisplay === 'function') updateAuthUserDisplay();
  if (typeof updateRoleUI === 'function') updateRoleUI();
  // 先打开Meta数据库，确保有默认项目
  await openMetaDB();
  await ensureDefaultProject();
  // 确保所有项目都有访问编码
  if (typeof ensureAllProjectsHaveCode === 'function') await ensureAllProjectsHaveCode();
  // 再打开当前项目的业务数据库
  await openDB();
  loadFireIcons();
  loadHeaderConfig();
  loadBuildingFoldState();
  initCategoriesCollapsed();
  renderAllLegend();
  await initDevTypeSelect();
  await showAllLegend();
  renderTree();
  if (typeof renderProjectSidebarList === 'function') renderProjectSidebarList();
  if (typeof applyCategoryTitles === 'function') applyCategoryTitles();
  if (typeof initCategoryTitleEdit === 'function') initCategoryTitleEdit();
  calcStat();
  await loadCurrentFloor();
  initMapDropZone();
  initVectorToolbar();
  renderIconPicker();
  if (typeof initDrawBoard === 'function') initDrawBoard();
  makeDraggable($("float-legend-panel"), $("float-legend-header"));
  makeDraggable($("float-legend-config-panel"), $("float-legend-config-header"));
  makeDraggable($("search-result-panel"), $("srp-header"));
  if (typeof initResizeHandles === 'function') initResizeHandles();
  // 自动检查到期巡检计划并生成任务
  if (typeof checkAndGenerateTasks === 'function') {
    setTimeout(() => checkAndGenerateTasks(), 2000);
  }
  // 维保到期自动微信通知
  if (typeof checkAndNotifyDueMaintain === 'function') {
    setTimeout(() => checkAndNotifyDueMaintain(), 3000);
  }
  // 月计划到期提醒（差7天月底时检查）
  if (typeof checkMonthlyPlanReminder === 'function') {
    setTimeout(() => checkMonthlyPlanReminder(), 4000);
  }
})();
