/* ============================================================
 * mobile.js - 移动端现场作业模块
 * 功能：移动端菜单、现场拍照、扫码定位、触摸优化
 * ============================================================ */

/* ---------- 移动端检测 ---------- */
const isMobile = () => {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
};

/* ---------- 移动端菜单按钮 ---------- */
function initMobileMenu() {
  if (!isMobile()) return;

  // 创建左侧菜单按钮
  const leftBtn = document.createElement('button');
  leftBtn.className = 'mobile-menu-btn left';
  leftBtn.innerHTML = '☰';
  leftBtn.title = '菜单';
  leftBtn.onclick = () => {
    document.querySelector('.sidebar')?.classList.toggle('mobile-open');
    document.querySelector('.right-panel')?.classList.remove('mobile-open');
  };
  document.body.appendChild(leftBtn);

  // 创建右侧菜单按钮
  const rightBtn = document.createElement('button');
  rightBtn.className = 'mobile-menu-btn right';
  rightBtn.innerHTML = '⚙️';
  rightBtn.title = '设置';
  rightBtn.onclick = () => {
    document.querySelector('.right-panel')?.classList.toggle('mobile-open');
    document.querySelector('.sidebar')?.classList.remove('mobile-open');
  };
  document.body.appendChild(rightBtn);

  // 点击地图区域关闭菜单
  if (typeof map !== 'undefined' && map) {
    map.on('click', () => {
      document.querySelector('.sidebar')?.classList.remove('mobile-open');
      document.querySelector('.right-panel')?.classList.remove('mobile-open');
    });
  }
}

/* ---------- 现场拍照上传 ---------- */
function openCameraForPhoto(deviceId) {
  // 创建隐藏的文件输入，调用摄像头
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment'; // 后置摄像头
  input.style.display = 'none';
  document.body.appendChild(input);

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      // 压缩图片
      const compressed = await compressImage(file, 800, 0.7);
      // 保存到设备
      const dev = (await dbGetAll(SD)).find(d => d.id === deviceId);
      if (dev) {
        dev.sitePhoto = compressed;
        dev.sitePhotoTime = new Date().toISOString();
        await dbPut(SD, dev);
        addOperationLog('photo', `现场拍照：${dev.deviceType} ${dev.deviceCode || ''}`);
        showToast("现场照片已保存");
        renderDeviceMarkers();
      }
    } catch (err) {
      showToast("照片保存失败：" + err.message);
    }
    document.body.removeChild(input);
  };

  input.click();
}

/* ---------- 图片压缩 ---------- */
function compressImage(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = h * maxWidth / w; w = maxWidth; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------- 扫码快速定位 ---------- */
function openScanner() {
  // 检查是否支持摄像头扫码
  if (!isMobile()) {
    showToast("请在手机端使用扫码功能");
    return;
  }

  // 创建扫码窗口
  const scanWindow = window.open('', '_blank');
  if (!scanWindow) { showToast("请允许弹出窗口"); return; }

  scanWindow.document.write(`
    <!DOCTYPE html>
    <html><head><title>扫码定位设备</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { margin:0; padding:20px; font-family:sans-serif; background:#1a1a1a; color:#fff; }
      h2 { text-align:center; }
      #preview { width:100%; max-width:400px; margin:20px auto; display:block; border:2px solid #d92121; border-radius:8px; }
      #result { text-align:center; margin-top:20px; padding:15px; background:#333; border-radius:8px; display:none; }
      .btn { display:block; width:200px; margin:15px auto; padding:12px; background:#d92121; color:#fff; border:none; border-radius:6px; font-size:16px; }
      input[type=file] { display:none; }
    </style></head><body>
    <h2>📷 扫描设备二维码</h2>
    <video id="preview" autoplay playsinline></video>
    <div id="result"></div>
    <button class="btn" onclick="document.getElementById('fileinput').click()">📁 从相册选择</button>
    <input type="file" id="fileinput" accept="image/*" onchange="handleFile(this.files[0])">
    <script src="lib/qrcode.min.js"><\/script>
    <script>
      let scanning = true;
      const video = document.getElementById('preview');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // 尝试调用摄像头
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          .then(stream => { video.srcObject = stream; scanLoop(); })
          .catch(err => {
            document.getElementById('result').style.display = 'block';
            document.getElementById('result').innerHTML = '无法访问摄像头，请从相册选择二维码图片<br>' + err.message;
          });
      }

      function scanLoop() {
        if (!scanning) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          try {
            // 这里需要二维码解析库，简化处理：提示用户截图
          } catch(e) {}
        }
        requestAnimationFrame(scanLoop);
      }

      function handleFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          document.getElementById('result').style.display = 'block';
          document.getElementById('result').innerHTML = '已选择图片，请返回系统查看设备信息';
          // 将结果传回主页面
          window.opener.postMessage({ type: 'scan-result', data: e.target.result }, '*');
          setTimeout(() => window.close(), 1500);
        };
        reader.readAsDataURL(file);
      }
    <\/script>
    </body></html>
  `);
  scanWindow.document.close();
}

// 监听扫码结果
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'scan-result') {
    showToast("扫码成功，正在定位设备...");
    // 这里可以解析二维码内容并定位设备
  }
});

/* ---------- 移动端巡检打卡快捷按钮 ---------- */
function showMobileInspectBar() {
  if (!isMobile()) return;

  const bar = document.createElement('div');
  bar.id = 'mobile-inspect-bar';
  bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #ddd;padding:8px;display:flex;gap:8px;justify-content:space-around;z-index:150;box-shadow:0 -2px 8px rgba(0,0,0,.1)';
  bar.innerHTML = `
    <button class="btn small" onclick="openCameraForPhoto(currentInspectDeviceId)" style="flex:1">📷 拍照</button>
    <button class="btn small primary" onclick="quickInspect('normal')" style="flex:1">✅ 正常</button>
    <button class="btn small" style="background:#f59e0b;flex:1" onclick="quickInspect('fault')">⚠️ 故障</button>
    <button class="btn small" style="background:#dc2626;flex:1" onclick="quickInspect('maintain-needed')">🔧 维保</button>
  `;
  document.body.appendChild(bar);
}

let currentInspectDeviceId = null;

function quickInspect(result) {
  if (!currentInspectDeviceId) { showToast("请先选择设备"); return; }
  // 打开带表单支持的巡检打卡弹窗
  if (typeof openInspectCheckinModal === 'function') {
    openInspectCheckinModal(currentInspectDeviceId);
  } else {
    inspectCheckIn(currentInspectDeviceId, result);
  }
}

/* ---------- 初始化 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    initMobileMenu();
    if (isMobile()) {
      showToast("已切换到移动端模式");
    }
  }, 500);
});
