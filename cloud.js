// 云端同步模块 - Supabase集成
const Cloud = {
  supabase: null,
  enabled: false,
  config: {
    url: 'https://fire-map-system-d4f7rw8wbd00e5f5.api.tcloudbasegateway.com',
    key: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjU3OWQxZGJkLWE1NGYtNDE4MS1iOTMzLWY1NGRhNWIwZTc3OSJ9.eyJpc3MiOiJodHRwczovL2ZpcmUtbWFwLXN5c3RlbS1kNGY3cnc4d2JkMDBlNWY1LmFwLXNoYW5naGFpLnRjYi1hcGkudGVuY2VudGNsb3VkYXBpLmNvbSIsInN1YiI6ImFub24iLCJhdWQiOiJmaXJlLW1hcC1zeXN0ZW0tZDRmN3J3OHdiZDAwZTVmNSIsImV4cCI6NDA5MjM4NjU4NSwiaWF0IjoxNzg4NzAzMzg1LCJub25jZSI6Ik1CQTVQbEFpVEplbEEweWV4RFJRZ2ciLCJhdF9oYXNoIjoiTUJBNVBsQWlUSmVsQTB5ZXhEUlFnZyIsIm5hbWUiOiJBbm9ueW1vdXMiLCJzY29wZSI6ImFub255bW91cyIsInByb2plY3RfaWQiOiJmaXJlLW1hcC1zeXN0ZW0tZDRmN3J3OHdiZDAwZTVmNSIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.OtHsyA9lLX_iKfgouUrY6NXB3bjRq2UBgd-DRNnBDgs1GgxnfO0QSc42zIaTVfGSK6738k_EUd27WLNiw4AXCRSBTLFJmyG3EP8Pt7Be4xzrRJefSBHBqCqceOCOGS3whtHgEBB_Pk9ckKse35aFTn3GpIFi9DZTmJfuv3MixGyqbS4snhQVeb7du1U6rDP9coh6KHIQ1u2cmG4oHJNGReAMoncaZgnQMD_ptB8l3SbIlh2yrxav4tg7jh1QTF-SqXfZjXBpgLJ7okPMX99b9lbpYsqnoulxsibSps1qVsJVAxGYk_eljqZjZM4SBH0WvY8DY4Xvz6nUKkuFPBZ8QA'
  },

  // 初始化
  init() {
    try {
      // 测试环境（GitHub Pages / Vercel / 本地）自动关闭云同步，避免测试数据写入正式数据库；
      // 腾讯云域名（含以后绑定的自定义域名）自动开启，正式环境不受影响。
      const host = (typeof location !== 'undefined' ? location.hostname : '') || '';
      if (host.indexOf('github.io') !== -1 || host.indexOf('vercel.app') !== -1 || host === 'localhost' || host === '127.0.0.1') {
        console.log('[Cloud] 当前为测试环境(' + host + ')，云同步已自动关闭');
        this.enabled = false;
        return;
      }
      if (typeof createTCBClient !== 'undefined' && this.config.url && this.config.key) {
        this.supabase = createTCBClient(this.config.url, this.config.key);
        this.enabled = true;
        console.log('[Cloud] 腾讯云初始化成功');
      } else {
        console.log('[Cloud] 腾讯云未初始化（库未加载或配置缺失）');
      }
    } catch (e) {
      console.error('[Cloud] 初始化失败:', e);
      this.enabled = false;
    }
  },

  // ========== 设备同步 ==========

  // 同步单个设备到云端
  async syncDevice(device) {
    if (!this.enabled) return false;
    try {
      const deviceData = {
        id: device.id,
        project_id: device.projectId || localStorage.getItem('firemap_current_project') || 'default',
        building_id: device.buildingId || '',
        floor_id: device.floorId || '',
        device_type: device.deviceType || device.type || '',
        device_code: device.deviceCode || device.code || '',
        device_data: device
      };

      const { data, error } = await this.supabase
        .from('devices')
        .upsert(deviceData, { onConflict: 'id' });

      if (error) {
        console.error('[Cloud] 同步设备失败:', error);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Cloud] 同步设备异常:', e);
      return false;
    }
  },

  // 批量同步设备
  async syncDevices(devices) {
    if (!this.enabled || !devices || devices.length === 0) return false;
    try {
      const deviceData = devices.map(d => ({
        id: d.id,
        project_id: d.projectId || localStorage.getItem('firemap_current_project') || 'default',
        building_id: d.buildingId || '',
        floor_id: d.floorId || '',
        device_type: d.type || '',
        device_code: d.code || '',
        device_data: d
      }));

      const { data, error } = await this.supabase
        .from('devices')
        .upsert(deviceData, { onConflict: 'id' });

      if (error) {
        console.error('[Cloud] 批量同步设备失败:', error);
        return false;
      }
      console.log(`[Cloud] 批量同步${devices.length}个设备成功`);
      return true;
    } catch (e) {
      console.error('[Cloud] 批量同步设备异常:', e);
      return false;
    }
  },

  // 从云端获取设备
  async getDevice(deviceId) {
    if (!this.enabled) return null;
    try {
      const { data, error } = await this.supabase
        .from('devices')
        .select('*')
        .eq('id', deviceId)
        .single();

      if (error) {
        console.error('[Cloud] 获取设备失败:', error);
        return null;
      }
      return data ? data.device_data : null;
    } catch (e) {
      console.error('[Cloud] 获取设备异常:', e);
      return null;
    }
  },

  // 从云端获取楼层所有设备
  async getFloorDevices(floorId) {
    if (!this.enabled) return [];
    try {
      const { data, error } = await this.supabase
        .from('devices')
        .select('*')
        .eq('floor_id', floorId);

      if (error) {
        console.error('[Cloud] 获取楼层设备失败:', error);
        return [];
      }
      return data ? data.map(d => d.device_data) : [];
    } catch (e) {
      console.error('[Cloud] 获取楼层设备异常:', e);
      return [];
    }
  },

  // 删除云端设备
  async deleteDevice(deviceId) {
    if (!this.enabled) return false;
    try {
      const { error } = await this.supabase
        .from('devices')
        .delete()
        .eq('id', deviceId);

      if (error) {
        console.error('[Cloud] 删除设备失败:', error);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Cloud] 删除设备异常:', e);
      return false;
    }
  },

  // ========== 楼层同步 ==========

  // 同步楼层到云端
  async syncFloor(floor) {
    if (!this.enabled) return false;
    try {
      const floorData = {
        id: floor.id,
        project_id: floor.projectId || localStorage.getItem('firemap_current_project') || 'default',
        building_id: floor.buildingId || '',
        floor_name: floor.floorName || floor.name || '',
        floor_data: floor
      };

      const { data, error } = await this.supabase
        .from('floors')
        .upsert(floorData, { onConflict: 'id' });

      if (error) {
        console.error('[Cloud] 同步楼层失败:', error);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Cloud] 同步楼层异常:', e);
      return false;
    }
  },

  // 从云端获取楼层
  async getFloor(floorId) {
    if (!this.enabled) return null;
    try {
      const { data, error } = await this.supabase
        .from('floors')
        .select('*')
        .eq('id', floorId)
        .single();

      if (error) {
        console.error('[Cloud] 获取楼层失败:', error);
        return null;
      }
      return data;
    } catch (e) {
      console.error('[Cloud] 获取楼层异常:', e);
      return null;
    }
  },

  // ========== 建筑同步 ==========

  // 同步单个建筑到云端
  async syncBuilding(building) {
    if (!this.enabled) return false;
    try {
      const buildingData = {
        id: building.id,
        project_id: building.projectId || localStorage.getItem('firemap_current_project') || 'default',
        building_name: building.name || building.buildingName || '',
        building_data: building
      };

      const { data, error } = await this.supabase
        .from('buildings')
        .upsert(buildingData, { onConflict: 'id' });

      if (error) {
        console.error('[Cloud] 同步建筑失败:', error);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Cloud] 同步建筑异常:', e);
      return false;
    }
  },

  // 从云端获取建筑
  async getBuilding(buildingId) {
    if (!this.enabled) return null;
    try {
      const { data, error } = await this.supabase
        .from('buildings')
        .select('*')
        .eq('id', buildingId)
        .single();

      if (error) {
        console.error('[Cloud] 获取建筑失败:', error);
        return null;
      }
      return data;
    } catch (e) {
      console.error('[Cloud] 获取建筑异常:', e);
      return null;
    }
  },

  // ========== 巡检记录 ==========

  // 提交巡检记录
  async submitInspectLog(log) {
    if (!this.enabled) return false;
    try {
      const logData = {
        id: log.id || 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        device_id: log.deviceId || '',
        floor_id: log.floorId || '',
        inspector: log.inspector || '',
        result: log.result || '',
        remark: log.remark || '',
        photo: log.photo || '',
        inspect_date: log.inspectDate || new Date().toISOString().split('T')[0],
        inspect_time: log.inspectTime || new Date().toTimeString().split(' ')[0],
        source: log.source || 'qrcode'
      };

      const { data, error } = await this.supabase
        .from('inspect_logs')
        .insert(logData);

      if (error) {
        console.error('[Cloud] 提交巡检记录失败:', error);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Cloud] 提交巡检记录异常:', e);
      return false;
    }
  },

  // 获取设备巡检历史
  async getDeviceInspectLogs(deviceId) {
    if (!this.enabled) return [];
    try {
      const { data, error } = await this.supabase
        .from('inspect_logs')
        .select('*')
        .eq('device_id', deviceId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Cloud] 获取巡检记录失败:', error);
        return [];
      }
      return data || [];
    } catch (e) {
      console.error('[Cloud] 获取巡检记录异常:', e);
      return [];
    }
  },

  // ========== 全量同步 ==========

  // 全量同步当前项目所有数据
  async syncAll() {
    if (!this.enabled) return { success: false, message: '云端未启用' };
    try {
      // 从本地IndexedDB获取所有数据
      const buildings = await dbGetAll(SB);
      const devices = await dbGetAll(SD);
      const floors = await dbGetAll(SF);
      const forms = await dbGetAll(S_FORM);

      let buildingSuccess = 0;
      let deviceSuccess = 0;
      let floorSuccess = 0;
      let formSuccess = 0;

      if (buildings && buildings.length > 0) {
        for (const building of buildings) {
          const result = await this.syncBuilding(building);
          if (result) buildingSuccess++;
        }
      }

      if (devices && devices.length > 0) {
        const result = await this.syncDevices(devices);
        if (result) deviceSuccess = devices.length;
      }

      if (floors && floors.length > 0) {
        for (const floor of floors) {
          const result = await this.syncFloor(floor);
          if (result) floorSuccess++;
        }
      }

      // 同步表单模板（关键！扫码页面从custom_forms表加载表单）
      if (forms && forms.length > 0) {
        for (const form of forms) {
          const result = await this.syncForm(form);
          if (result) formSuccess++;
        }
      }

      let msg = `同步完成：${buildingSuccess}个建筑，${deviceSuccess}个设备，${floorSuccess}个楼层`;
      if (forms && forms.length > 0) msg += `，${formSuccess}个表单`;
      else if (forms && forms.length === 0) msg += `（本地暂无表单）`;

      return {
        success: true,
        message: msg,
        buildingCount: buildingSuccess,
        deviceCount: deviceSuccess,
        floorCount: floorSuccess,
        formCount: formSuccess
      };
    } catch (e) {
      console.error('[Cloud] 全量同步异常:', e);
      return { success: false, message: '同步失败: ' + e.message };
    }
  },

  // ========== 表单同步 ==========

  // 同步单个表单模板到云端
  async syncForm(form) {
    if (!this.enabled) return false;
    try {
      const formData = {
        id: form.id,
        name: form.name || '',
        description: form.description || '',
        groups: form.groups || [],
        tags: form.tags || [],
        project_id: form.projectId || '',
        deleted: form.deleted || false,
        result_hidden: form.resultHidden || false,
        result_desc: form.resultDesc || '',
        result_type: form.resultType || '',
        result_status_group: form.resultStatusGroup || '',
        created_at: form.createdAt || new Date().toISOString(),
        updated_at: form.updatedAt || new Date().toISOString()
      };
      const { error } = await this.supabase
        .from('custom_forms')
        .upsert(formData, { onConflict: 'id' });
      if (error) {
        console.warn('[Cloud] 同步表单失败:', error.message);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('[Cloud] 同步表单异常:', e);
      return false;
    }
  },

  // 同步表单填写数据到云端
  async syncFormData(formData) {
    if (!this.enabled) return false;
    try {
      const data = {
        id: formData.id,
        form_id: formData.formId || '',
        form_name: formData.formName || '',
        data: formData.data || {},
        related_type: formData.relatedType || '',
        related_id: formData.relatedId || '',
        created_by: formData.createdBy || '',
        created_at: formData.createdAt || new Date().toISOString()
      };
      const { error } = await this.supabase
        .from('form_data')
        .upsert(data, { onConflict: 'id' });
      if (error) {
        console.warn('[Cloud] 同步表单数据失败:', error.message);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('[Cloud] 同步表单数据异常:', e);
      return false;
    }
  },

  // 从云端加载所有表单
  async loadFormsFromCloud() {
    if (!this.enabled) return [];
    try {
      let { data, error } = await this.supabase
        .from('custom_forms')
        .select('*')
        .eq('deleted', false);
      // 如果 deleted 列不存在（旧表结构），回退为不带条件查询
      // 注意：错误码可能是 PGRST204 或 DATABASE_PGRST204，用包含匹配
      if (error && String(error.code || '').indexOf('PGRST204') >= 0) {
        console.warn('[Cloud] deleted列不存在，回退全量查询');
        const r2 = await this.supabase.from('custom_forms').select('*');
        data = r2.data; error = r2.error;
      }
      if (error) {
        console.warn('[Cloud] 加载表单失败:', error.message);
        return [];
      }
      // TCB客户端不支持.order()，改用JS排序
      if (data && data.length > 1) {
        data.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
      }
      return data || [];
    } catch (e) {
      console.warn('[Cloud] 加载表单异常:', e);
      return [];
    }
  }
};

// 全局同步函数（供按钮调用）
async function syncToCloud() {
  if (typeof Cloud === 'undefined' || !Cloud.enabled) {
    if (typeof showToast === 'function') showToast('云端同步未启用，请检查Supabase配置');
    return;
  }
  if (typeof showToast === 'function') showToast('正在同步到云端...');
  const result = await Cloud.syncAll();
  if (typeof showToast === 'function') {
    if (result.success) {
      showToast(result.message);
    } else {
      showToast('同步失败：' + result.message);
    }
  }
}
