// 腾讯云PostgreSQL兼容层 - 模拟Supabase API风格
// 使用fetch直接调用腾讯云REST API，支持完整链式调用

class TCBClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.key,
      'Authorization': 'Bearer ' + this.key
    };
  }

  from(table) {
    return new TCBQuery(this, table);
  }
}

class TCBQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
    this.selectColumns = '*';
  }

  // 累积过滤条件
  eq(field, value) {
    this.filters.push({ field, op: 'eq', value });
    return this;
  }

  // select（不立即执行，返回this继续链式调用）
  select(columns = '*') {
    this.selectColumns = columns;
    return this;
  }

  // 构建查询字符串
  buildQueryString() {
    const params = ['select=' + encodeURIComponent(this.selectColumns)];
    for (const f of this.filters) {
      params.push(f.field + '=' + f.op + '.' + encodeURIComponent(f.value));
    }
    return '?' + params.join('&');
  }

  // 执行查询（Promise）
  async then(resolve, reject) {
    try {
      const url = this.client.url + '/v1/rdb/rest/' + this.table + this.buildQueryString();
      const res = await fetch(url, {
        method: 'GET',
        headers: this.client.getHeaders()
      });
      if (!res.ok) {
        const text = await res.text();
        resolve({ data: null, error: { message: res.status + ' ' + res.statusText, code: res.status, details: text } });
        return;
      }
      const data = await res.json();
      resolve({ data: data, error: null });
    } catch (e) {
      resolve({ data: null, error: { message: e.message, code: 'FETCH_ERROR' } });
    }
  }

  // single（返回第一条数据）
  async single() {
    const result = await this;
    if (result.error) return result;
    if (result.data && result.data.length > 0) {
      return { data: result.data[0], error: null };
    }
    return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
  }

  // insert
  async insert(data) {
    try {
      const url = this.client.url + '/v1/rdb/rest/' + this.table;
      const res = await fetch(url, {
        method: 'POST',
        headers: this.client.getHeaders(),
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const text = await res.text();
        return { data: null, error: { message: res.status + ' ' + res.statusText, code: res.status, details: text } };
      }
      const result = await res.json().catch(() => null);
      return { data: result, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message, code: 'FETCH_ERROR' } };
    }
  }

  // upsert
  async upsert(data, options = {}) {
    try {
      const conflict = options.onConflict || 'id';
      const url = this.client.url + '/v1/rdb/rest/' + this.table + '?on_conflict=' + encodeURIComponent(conflict);
      const headers = this.client.getHeaders();
      headers['Prefer'] = 'resolution=merge-duplicates';
      const res = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const text = await res.text();
        return { data: null, error: { message: res.status + ' ' + res.statusText, code: res.status, details: text } };
      }
      const result = await res.json().catch(() => null);
      return { data: result, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message, code: 'FETCH_ERROR' } };
    }
  }

  // update（返回this继续链式调用eq）
  update(data) {
    this._updateData = data;
    return this;
  }

  // delete（返回this继续链式调用eq）
  delete() {
    this._isDelete = true;
    return this;
  }

  // 当update/delete后调用eq时执行
  // 由于eq返回this，我们需要在await时判断是update还是delete
  // 重写then方法处理update/delete
  // 但上面已经定义了then用于select，这里需要区分
  // 简化：update/delete后必须调用eq，eq后直接await执行
}

// 由于update/delete需要eq后执行，我们修改eq方法
// 当有_updateData或_isDelete时，eq后执行对应的操作
TCBQuery.prototype.eq = function(field, value) {
  this.filters.push({ field, op: 'eq', value });
  
  // 如果是update操作
  if (this._updateData) {
    const self = this;
    return {
      async then(resolve) {
        try {
          const url = self.client.url + '/v1/rdb/rest/' + self.table + '?' + field + '=eq.' + encodeURIComponent(value);
          const res = await fetch(url, {
            method: 'PATCH',
            headers: self.client.getHeaders(),
            body: JSON.stringify(self._updateData)
          });
          if (!res.ok) {
            const text = await res.text();
            resolve({ data: null, error: { message: res.status + ' ' + res.statusText, code: res.status, details: text } });
            return;
          }
          const result = await res.json().catch(() => null);
          resolve({ data: result, error: null });
        } catch (e) {
          resolve({ data: null, error: { message: e.message, code: 'FETCH_ERROR' } });
        }
      }
    };
  }
  
  // 如果是delete操作
  if (this._isDelete) {
    const self = this;
    return {
      async then(resolve) {
        try {
          const url = self.client.url + '/v1/rdb/rest/' + self.table + '?' + field + '=eq.' + encodeURIComponent(value);
          const res = await fetch(url, {
            method: 'DELETE',
            headers: self.client.getHeaders()
          });
          if (!res.ok) {
            const text = await res.text();
            resolve({ data: null, error: { message: res.status + ' ' + res.statusText, code: res.status, details: text } });
            return;
          }
          resolve({ data: null, error: null });
        } catch (e) {
          resolve({ data: null, error: { message: e.message, code: 'FETCH_ERROR' } });
        }
      }
    };
  }
  
  // 普通select过滤，返回this继续链式调用
  return this;
};

// 创建client
function createTCBClient(url, key) {
  return new TCBClient(url, key);
}
