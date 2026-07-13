(() => {
  'use strict';

  const API_BASE = String(window.DOUHUI_API_BASE || '').replace(/\/$/, '');
  const $ = id => document.getElementById(id);
  const studio = window.studioApi;
  const fullPalette = MARD_PALETTES[291];
  const colorById = new Map(fullPalette.map(item => [item[0], item]));
  let user = null;
  let authProvider = 'phone';
  let phoneMode = 'password';
  let pendingAfterLogin = null;
  let oauthAttempt = null;
  let oauthTimer = null;
  let otpTimer = null;
  let stockRows = [];
  let selectedAdminUserId = null;

  function openModal(id) {
    $(id).classList.remove('hidden');
  }

  function closeModal(id) {
    $(id).classList.add('hidden');
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function accountInitial() {
    return (user?.nickname || '豆').trim().slice(0, 1).toUpperCase();
  }

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function api(path, options = {}) {
    if (!API_BASE) throw new Error('账号服务尚未连接，请部署后端并配置 API 地址');
    const headers = { ...options.headers };
    if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(apiUrl(path), { ...options, headers, credentials: 'include' });
    } catch {
      throw new Error('无法连接账号服务，请稍后重试');
    }
    const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || '账号服务暂时无法完成请求');
    return payload;
  }

  function renderUserButton() {
    $('userName').textContent = user ? user.nickname : '登录';
    $('userAvatar').innerHTML = user?.avatarUrl
      ? `<img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.nickname)}" />`
      : escapeHtml(accountInitial());
    $('adminTabBtn').classList.toggle('hidden', user?.role !== 'admin');
  }

  function clearOAuth() {
    clearTimeout(oauthTimer);
    oauthTimer = null;
    oauthAttempt = null;
  }

  function showAuthError(error) {
    $('loginError').textContent = error?.message || String(error);
  }

  function showServiceNotice() {
    $('authServiceNotice').classList.toggle('hidden', Boolean(API_BASE));
    $('authServiceNotice').textContent = API_BASE ? '' : '账号后端尚未部署。界面已经完成，配置 api-config.js 后即可连接腾讯云服务。';
  }

  function setPhoneMode(mode) {
    phoneMode = mode;
    document.querySelectorAll('[data-phone-auth-mode]').forEach(button => button.classList.toggle('active', button.dataset.phoneAuthMode === mode));
    document.querySelector('[data-auth-field="password"]').classList.toggle('hidden', mode === 'otp');
    document.querySelector('[data-auth-field="confirmation"]').classList.toggle('hidden', mode !== 'register');
    document.querySelector('[data-auth-field="otp"]').classList.toggle('hidden', mode === 'password');
    document.querySelector('[data-auth-field="nickname"]').classList.toggle('hidden', mode !== 'register');
    document.querySelector('[data-auth-field="region"]').classList.toggle('hidden', mode !== 'register');
    $('authPassword').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('loginSubmit').textContent = mode === 'register' ? '注册并登录' : '登录';
    $('loginError').textContent = '';
  }

  function setAuthProvider(provider) {
    authProvider = provider;
    clearOAuth();
    document.querySelectorAll('[data-auth-provider]').forEach(button => button.classList.toggle('active', button.dataset.authProvider === provider));
    $('phoneAuthPanel').classList.toggle('hidden', provider !== 'phone');
    $('qrAuthPanel').classList.toggle('hidden', provider === 'phone');
    $('loginError').textContent = '';
    if (provider !== 'phone') startOAuth(provider);
  }

  function validatePhone() {
    const phone = $('authPhone').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error('请输入正确的 11 位手机号');
    return phone;
  }

  async function submitPhoneAuth() {
    $('loginSubmit').disabled = true;
    $('loginError').textContent = '';
    try {
      const phone = validatePhone();
      let payload;
      if (phoneMode === 'password') {
        payload = await api('/auth/login/password', { method: 'POST', body: JSON.stringify({ phone, password: $('authPassword').value }) });
      } else if (phoneMode === 'otp') {
        payload = await api('/auth/login/otp', { method: 'POST', body: JSON.stringify({ phone, code: $('authOtp').value.trim() }) });
      } else {
        payload = await api('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            phone,
            code: $('authOtp').value.trim(),
            password: $('authPassword').value,
            passwordConfirmation: $('authPasswordConfirmation').value,
            nickname: $('authNickname').value.trim(),
            region: $('authRegion').value.trim(),
          }),
        });
      }
      completeLogin(payload.user);
    } catch (error) {
      showAuthError(error);
    } finally {
      $('loginSubmit').disabled = false;
    }
  }

  async function requestOtp() {
    try {
      const phone = validatePhone();
      $('sendOtpBtn').disabled = true;
      await api('/auth/sms/request', { method: 'POST', body: JSON.stringify({ phone, purpose: phoneMode === 'register' ? 'register' : 'login' }) });
      let seconds = 60;
      $('sendOtpBtn').textContent = `${seconds} 秒`;
      clearInterval(otpTimer);
      otpTimer = setInterval(() => {
        seconds--;
        $('sendOtpBtn').textContent = seconds > 0 ? `${seconds} 秒` : '获取验证码';
        if (seconds <= 0) {
          clearInterval(otpTimer);
          $('sendOtpBtn').disabled = false;
        }
      }, 1000);
    } catch (error) {
      $('sendOtpBtn').disabled = false;
      showAuthError(error);
    }
  }

  async function startOAuth(provider = authProvider) {
    clearOAuth();
    $('oauthQrImage').classList.add('hidden');
    $('oauthQrPlaceholder').classList.remove('hidden');
    $('oauthQrPlaceholder').textContent = '正在获取二维码';
    $('oauthStatus').textContent = `请使用${provider === 'wechat' ? '微信' : 'QQ'}扫码`;
    try {
      const result = await api(`/auth/oauth/${provider}/start`, { method: 'POST' });
      oauthAttempt = { provider, ...result };
      $('oauthQrImage').src = result.qrDataUrl;
      $('oauthQrImage').classList.remove('hidden');
      $('oauthQrPlaceholder').classList.add('hidden');
      pollOAuth();
    } catch (error) {
      $('oauthQrPlaceholder').textContent = '二维码暂不可用';
      showAuthError(error);
    }
  }

  async function pollOAuth() {
    if (!oauthAttempt) return;
    try {
      const result = await api(`/auth/oauth/attempts/${oauthAttempt.attemptId}`, { headers: { 'X-OAuth-Poll-Token': oauthAttempt.pollToken } });
      if (result.status === 'authenticated') {
        const me = await api('/auth/me');
        clearOAuth();
        completeLogin(me.user);
        return;
      }
      if (result.status === 'expired' || result.status === 'failed') {
        $('oauthStatus').textContent = '二维码已失效，请刷新';
        return;
      }
      $('oauthStatus').textContent = result.status === 'complete' ? '授权完成，正在登录' : '等待扫码确认';
      oauthTimer = setTimeout(pollOAuth, 1800);
    } catch (error) {
      showAuthError(error);
    }
  }

  function completeLogin(nextUser) {
    user = nextUser;
    closeModal('authModal');
    renderUserButton();
    const action = pendingAfterLogin;
    pendingAfterLogin = null;
    if (action) action();
    else openAccount('history');
  }

  function requireUser(action) {
    if (user) return action();
    pendingAfterLogin = action;
    showServiceNotice();
    openModal('authModal');
  }

  function patternPayload(snapshot) {
    return {
      title: snapshot.title,
      width: snapshot.width,
      height: snapshot.height,
      paletteSize: snapshot.paletteSize,
      beads: snapshot.beads,
    };
  }

  async function savePatternSnapshot(snapshot) {
    if (!snapshot?.beads?.flat().some(Boolean)) return null;
    const result = await api('/patterns', { method: 'POST', body: JSON.stringify(patternPayload(snapshot)) });
    return result.pattern;
  }

  function drawHistoryPreview(canvas, snapshot) {
    const context = canvas.getContext('2d');
    const scale = Math.min(canvas.width / snapshot.width, canvas.height / snapshot.height);
    const left = (canvas.width - snapshot.width * scale) / 2;
    const top = (canvas.height - snapshot.height * scale) / 2;
    context.fillStyle = '#f8f7f3';
    context.fillRect(0, 0, canvas.width, canvas.height);
    snapshot.beads.forEach((row, y) => row.forEach((id, x) => {
      if (!id) return;
      context.fillStyle = colorById.get(id)?.[1] || '#fff';
      context.fillRect(left + x * scale, top + y * scale, Math.ceil(scale), Math.ceil(scale));
    }));
  }

  async function renderHistory() {
    const list = $('historyList');
    list.innerHTML = '<div class="empty-list">正在加载图纸</div>';
    try {
      const result = await api('/patterns');
      if (!result.patterns.length) {
        list.innerHTML = '<div class="empty-list">还没有保存过图纸</div>';
        return;
      }
      list.innerHTML = result.patterns.map(entry => `<article class="history-item"><canvas width="104" height="104" data-preview-id="${entry.id}"></canvas><div class="history-meta"><strong>${escapeHtml(entry.title)}</strong><small>${entry.width} × ${entry.height} · MARD ${entry.paletteSize}</small><small>${new Date(entry.createdAt).toLocaleString('zh-CN')}</small><div class="history-actions"><button data-open-history="${entry.id}">打开</button><button data-delete-history="${entry.id}">删除</button></div></div></article>`).join('');
      list.querySelectorAll('[data-open-history]').forEach(button => button.onclick = async () => {
        try {
          const detail = await api(`/patterns/${button.dataset.openHistory}`);
          studio.loadPattern(detail.pattern);
          closeModal('accountModal');
          studio.notify('已打开历史图纸');
        } catch (error) {
          studio.notify(error.message);
        }
      });
      list.querySelectorAll('[data-delete-history]').forEach(button => button.onclick = async () => {
        if (!window.confirm('确定删除这张历史图纸吗？')) return;
        try {
          await api(`/patterns/${button.dataset.deleteHistory}`, { method: 'DELETE' });
          renderHistory();
        } catch (error) {
          studio.notify(error.message);
        }
      });
      await Promise.all([...list.querySelectorAll('[data-preview-id]')].map(async canvas => {
        const detail = await api(`/patterns/${canvas.dataset.previewId}`);
        drawHistoryPreview(canvas, detail.pattern);
      }));
    } catch (error) {
      list.innerHTML = `<div class="empty-list">${escapeHtml(error.message)}</div>`;
    }
  }

  async function renderInventory() {
    try {
      const result = await api('/inventory');
      const search = $('inventorySearch').value.trim().toUpperCase();
      const colors = fullPalette.filter(([id]) => !search || id.includes(search));
      $('inventoryList').innerHTML = colors.map(([id, color]) => {
        const value = Math.max(0, Number(result.quantities[id] || 0));
        return `<label class="inventory-row"><i style="background:${color}"></i><b>${id}</b><small>${value < 100 ? '库存偏低' : '剩余数量'}</small><input type="number" min="0" step="1" value="${value}" data-inventory-id="${id}" /></label>`;
      }).join('');
      $('inventorySummary').textContent = `已登记 ${Object.values(result.quantities).filter(value => Number(value) > 0).length} 种颜色`;
      $('inventoryList').querySelectorAll('[data-inventory-id]').forEach(input => input.onchange = async () => {
        try {
          await api('/inventory', { method: 'PUT', body: JSON.stringify({ items: [{ colorId: input.dataset.inventoryId, quantity: Math.max(0, Math.floor(Number(input.value) || 0)) }] }) });
        } catch (error) {
          studio.notify(error.message);
        }
      });
    } catch (error) {
      $('inventoryList').innerHTML = `<div class="empty-list">${escapeHtml(error.message)}</div>`;
    }
  }

  function renderProfile() {
    $('profileNickname').value = user.nickname || '';
    $('profileRegion').value = user.region || '';
    $('profileAvatarImage').classList.toggle('hidden', !user.avatarUrl);
    $('profileAvatarFallback').classList.toggle('hidden', Boolean(user.avatarUrl));
    if (user.avatarUrl) $('profileAvatarImage').src = user.avatarUrl;
    $('profileAvatarFallback').textContent = accountInitial();
    $('passwordChange').classList.toggle('hidden', !user.phone);
    $('locationStatus').textContent = '';
  }

  async function renderAdminUsers() {
    const list = $('adminUserList');
    list.innerHTML = '<div class="empty-list">正在加载用户</div>';
    try {
      const query = encodeURIComponent($('adminSearch').value.trim());
      const result = await api(`/admin/users?query=${query}`);
      list.innerHTML = result.users.length ? result.users.map(item => `<button class="admin-user${item.id === selectedAdminUserId ? ' active' : ''}" data-admin-user="${item.id}"><strong>${escapeHtml(item.nickname)}${item.role === 'admin' ? ' · 管理员' : ''}</strong><small>${escapeHtml(item.phone || '第三方登录')} · ${item.patternCount} 张图纸</small></button>`).join('') : '<div class="empty-list">没有找到用户</div>';
      list.querySelectorAll('[data-admin-user]').forEach(button => button.onclick = () => {
        selectedAdminUserId = button.dataset.adminUser;
        renderAdminUsers();
        renderAdminPatterns(selectedAdminUserId);
      });
    } catch (error) {
      list.innerHTML = `<div class="empty-list">${escapeHtml(error.message)}</div>`;
    }
  }

  async function renderAdminPatterns(userId) {
    const list = $('adminPatternList');
    list.innerHTML = '<div class="empty-list">正在加载图纸</div>';
    try {
      const result = await api(`/admin/users/${userId}/patterns`);
      list.innerHTML = result.patterns.length ? result.patterns.map(pattern => `<article class="admin-pattern"><strong>${escapeHtml(pattern.title)}</strong><small>${pattern.width} × ${pattern.height} · ${new Date(pattern.createdAt).toLocaleDateString('zh-CN')}</small><button data-admin-delete="${pattern.id}">删除</button></article>`).join('') : '<div class="empty-list">该用户没有图纸</div>';
      list.querySelectorAll('[data-admin-delete]').forEach(button => button.onclick = async () => {
        if (!window.confirm('确定以管理员身份删除这张图纸吗？此操作会记录审计日志。')) return;
        try {
          await api(`/admin/patterns/${button.dataset.adminDelete}`, { method: 'DELETE' });
          renderAdminPatterns(userId);
        } catch (error) {
          studio.notify(error.message);
        }
      });
    } catch (error) {
      list.innerHTML = `<div class="empty-list">${escapeHtml(error.message)}</div>`;
    }
  }

  function selectAccountTab(tab) {
    if (tab === 'admin' && user?.role !== 'admin') return;
    document.querySelectorAll('[data-account-tab]').forEach(button => button.classList.toggle('active', button.dataset.accountTab === tab));
    document.querySelectorAll('[data-account-view]').forEach(view => view.classList.toggle('active', view.dataset.accountView === tab));
    if (tab === 'history') renderHistory();
    if (tab === 'inventory') renderInventory();
    if (tab === 'profile') renderProfile();
    if (tab === 'admin') renderAdminUsers();
  }

  function openAccount(tab = 'history') {
    if (!user) return requireUser(() => openAccount(tab));
    selectAccountTab(tab);
    openModal('accountModal');
  }

  async function openStockAdjustment(patternId) {
    try {
      const result = await api(`/patterns/${patternId}/complete`, { method: 'POST' });
      if (!result.applied) return;
      stockRows = result.changes;
      $('stockAdjustList').innerHTML = stockRows.map(row => `<label class="stock-adjust-row"><i style="background:${colorById.get(row.colorId)?.[1] || '#fff'}"></i><b>${row.colorId}</b><small>原有 ${row.before} · 图纸使用 ${row.used}</small><input type="number" min="0" step="1" value="${row.after}" data-stock-id="${row.colorId}" /></label>`).join('');
      $('stockAdjustList').querySelectorAll('[data-stock-id]').forEach(input => input.oninput = () => {
        const row = stockRows.find(value => value.colorId === input.dataset.stockId);
        row.after = Math.max(0, Math.floor(Number(input.value) || 0));
        updateLowStockAlert();
      });
      updateLowStockAlert();
      openModal('stockModal');
    } catch (error) {
      studio.notify(error.message);
    }
  }

  function updateLowStockAlert() {
    const low = stockRows.filter(row => Number(row.after) < 100);
    $('lowStockAlert').classList.toggle('hidden', low.length === 0);
    $('lowStockAlert').innerHTML = low.length ? `<strong>需要补充拼豆：</strong> ${low.map(row => `${row.colorId}（剩余 ${row.after}）`).join('、')}` : '';
  }

  function recordExport() {
    const snapshot = studio.getSnapshot();
    if (!snapshot.beads.flat().some(Boolean)) return;
    requireUser(async () => {
      try {
        const pattern = await savePatternSnapshot(snapshot);
        await openStockAdjustment(pattern.id);
      } catch (error) {
        studio.notify(error.message);
      }
    });
  }

  function requestFreshCreate() {
    if (!studio.hasContent()) {
      studio.startFreshCreate();
      return true;
    }
    openModal('saveChoiceModal');
    return true;
  }

  document.querySelectorAll('[data-close-modal]').forEach(button => button.onclick = () => {
    closeModal(button.dataset.closeModal);
    if (button.dataset.closeModal === 'authModal') {
      pendingAfterLogin = null;
      clearOAuth();
    }
  });
  document.querySelectorAll('[data-auth-provider]').forEach(button => button.onclick = () => setAuthProvider(button.dataset.authProvider));
  document.querySelectorAll('[data-phone-auth-mode]').forEach(button => button.onclick = () => setPhoneMode(button.dataset.phoneAuthMode));
  document.querySelectorAll('[data-account-tab]').forEach(button => button.onclick = () => selectAccountTab(button.dataset.accountTab));
  $('loginSubmit').onclick = submitPhoneAuth;
  $('sendOtpBtn').onclick = requestOtp;
  $('refreshQrBtn').onclick = () => startOAuth();
  $('userBtn').onclick = () => user ? openAccount('history') : (showServiceNotice(), openModal('authModal'));
  $('inventorySearch').oninput = renderInventory;
  $('adminSearchBtn').onclick = renderAdminUsers;
  $('adminSearch').onkeydown = event => event.key === 'Enter' && renderAdminUsers();
  $('avatarEditor').onclick = () => $('avatarInput').click();
  $('avatarInput').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    const body = new FormData();
    body.append('avatar', file);
    try {
      const result = await api('/users/me/avatar', { method: 'POST', body });
      user.avatarUrl = `${result.avatarUrl}?v=${Date.now()}`;
      renderProfile();
      renderUserButton();
    } catch (error) {
      studio.notify(error.message);
    }
  };
  $('locateBtn').onclick = () => {
    if (!navigator.geolocation) return void ($('locationStatus').textContent = '当前浏览器不支持定位');
    $('locationStatus').textContent = '正在获取位置';
    navigator.geolocation.getCurrentPosition(position => {
      $('profileRegion').value = `${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`;
      $('locationStatus').textContent = '已获取位置，可继续手动修改地区';
    }, () => $('locationStatus').textContent = '定位失败，请检查浏览器权限或手动输入', { timeout: 10000 });
  };
  $('saveProfileBtn').onclick = async () => {
    try {
      const result = await api('/users/me', { method: 'PATCH', body: JSON.stringify({ nickname: $('profileNickname').value.trim(), region: $('profileRegion').value.trim() }) });
      user = result.user;
      renderUserButton();
      studio.notify('个人资料已保存');
    } catch (error) {
      $('locationStatus').textContent = error.message;
    }
  };
  $('changePasswordBtn').onclick = async () => {
    try {
      await api('/users/me/password', { method: 'POST', body: JSON.stringify({ currentPassword: $('currentPassword').value, newPassword: $('newPassword').value, newPasswordConfirmation: $('newPasswordConfirmation').value }) });
      ['currentPassword', 'newPassword', 'newPasswordConfirmation'].forEach(id => $(id).value = '');
      studio.notify('密码已更新，其他设备会退出登录');
    } catch (error) {
      $('locationStatus').textContent = error.message;
    }
  };
  $('logoutBtn').onclick = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    user = null;
    closeModal('accountModal');
    renderUserButton();
  };
  $('discardAndCreate').onclick = () => {
    closeModal('saveChoiceModal');
    studio.startFreshCreate();
  };
  $('saveAndCreate').onclick = () => {
    const snapshot = studio.getSnapshot();
    closeModal('saveChoiceModal');
    requireUser(async () => {
      try {
        await savePatternSnapshot(snapshot);
        studio.startFreshCreate();
        studio.notify('当前图纸已保存到生成历史');
      } catch (error) {
        studio.notify(error.message);
      }
    });
  };
  $('saveStockAdjustments').onclick = async () => {
    try {
      await api('/inventory', { method: 'PUT', body: JSON.stringify({ items: stockRows.map(row => ({ colorId: row.colorId, quantity: row.after })) }) });
      closeModal('stockModal');
      studio.notify('拼豆库存已更新');
    } catch (error) {
      studio.notify(error.message);
    }
  };

  async function restoreSession() {
    renderUserButton();
    if (!API_BASE) return;
    try {
      const result = await api('/auth/me');
      user = result.user;
      renderUserButton();
    } catch {}
  }

  setPhoneMode('password');
  showServiceNotice();
  restoreSession();
  window.accountManager = { recordExport, requestFreshCreate };
})();
