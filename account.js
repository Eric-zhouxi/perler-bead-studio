(() => {
  'use strict';

  const STORAGE_KEY = 'douhui.local-accounts.v1';
  const HISTORY_LIMIT = 24;
  const $ = id => document.getElementById(id);
  const studio = window.studioApi;
  const fullPalette = MARD_PALETTES[291];
  const colorById = new Map(fullPalette.map(item => [item[0], item]));
  let authProvider = 'phone';
  let pendingAfterLogin = null;
  let stockRows = [];

  function defaultState() {
    return { currentId: null, users: {} };
  }

  function loadState() {
    try {
      return { ...defaultState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch {
      return defaultState();
    }
  }

  const state = loadState();
  state.users ||= {};

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      studio.notify('本机存储空间不足，请删除部分历史图纸');
    }
  }

  function currentUser() {
    return state.currentId ? state.users[state.currentId] || null : null;
  }

  function ensureUserShape(user) {
    if (!user) return null;
    user.inventory ||= {};
    user.history ||= [];
    user.completed ||= [];
    user.nickname ||= '豆绘用户';
    user.region ||= '';
    user.avatar ||= '';
    return user;
  }

  function openModal(id) {
    $(id).classList.remove('hidden');
  }

  function closeModal(id) {
    $(id).classList.add('hidden');
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function accountInitial(user) {
    return (user?.nickname || '豆').trim().slice(0, 1).toUpperCase();
  }

  function renderUserButton() {
    const user = currentUser();
    $('userName').textContent = user ? user.nickname : '登录';
    $('userAvatar').innerHTML = user?.avatar ? `<img src="${user.avatar}" alt="${escapeHtml(user.nickname)}" />` : escapeHtml(user ? accountInitial(user) : '访');
  }

  function setAuthProvider(provider) {
    authProvider = provider;
    const labels = {
      phone: ['手机号', '请输入手机号'],
      wechat: ['微信号', '请输入微信号'],
      qq: ['QQ号', '请输入QQ号'],
    };
    $('accountIdLabel').textContent = labels[provider][0];
    $('accountIdInput').placeholder = labels[provider][1];
    $('accountIdInput').value = '';
    $('loginError').textContent = '';
    document.querySelectorAll('[data-auth-provider]').forEach(button => button.classList.toggle('active', button.dataset.authProvider === provider));
  }

  function validateAccountId(provider, value) {
    if (provider === 'phone') return /^1[3-9]\d{9}$/.test(value) ? '' : '请输入正确的 11 位手机号';
    if (provider === 'qq') return /^[1-9]\d{4,11}$/.test(value) ? '' : '请输入正确的 QQ 号';
    return value.length >= 2 ? '' : '请输入微信号';
  }

  function submitLogin() {
    const identifier = $('accountIdInput').value.trim();
    const nicknameInput = $('loginNickname').value.trim();
    const error = validateAccountId(authProvider, identifier);
    if (error) {
      $('loginError').textContent = error;
      return;
    }
    const id = `${authProvider}:${identifier}`;
    const providerName = { phone: '手机', wechat: '微信', qq: 'QQ' }[authProvider];
    const user = ensureUserShape(state.users[id] || {
      id,
      provider: authProvider,
      identifier,
      nickname: nicknameInput || `${providerName}用户${identifier.slice(-4)}`,
      avatar: '',
      region: '',
      inventory: {},
      history: [],
      completed: [],
    });
    if (nicknameInput) user.nickname = nicknameInput;
    state.users[id] = user;
    state.currentId = id;
    saveState();
    closeModal('authModal');
    $('loginError').textContent = '';
    $('accountIdInput').value = '';
    $('loginNickname').value = '';
    renderUserButton();
    const action = pendingAfterLogin;
    pendingAfterLogin = null;
    if (action) action();
    else openAccount('history');
  }

  function requireUser(action) {
    if (currentUser()) {
      action();
      return;
    }
    pendingAfterLogin = action;
    openModal('authModal');
  }

  function encodePattern(snapshot) {
    const flat = snapshot.beads.flat();
    const runs = [];
    flat.forEach(id => {
      const last = runs[runs.length - 1];
      if (last && last[0] === id) last[1]++;
      else runs.push([id, 1]);
    });
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: snapshot.title,
      width: snapshot.width,
      height: snapshot.height,
      paletteSize: snapshot.paletteSize,
      createdAt: snapshot.createdAt || new Date().toISOString(),
      runs,
    };
  }

  function decodePattern(entry) {
    const flat = [];
    entry.runs.forEach(([id, count]) => {
      for (let i = 0; i < count; i++) flat.push(id);
    });
    return {
      ...entry,
      beads: Array.from({ length: entry.height }, (_, y) => flat.slice(y * entry.width, (y + 1) * entry.width)),
    };
  }

  function patternFingerprint(snapshot) {
    let hash = 2166136261;
    const text = `${snapshot.width}x${snapshot.height}:${snapshot.paletteSize}:${snapshot.beads.flat().map(id => id || '-').join(',')}`;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function savePatternSnapshot(snapshot) {
    const user = ensureUserShape(currentUser());
    if (!user || !snapshot.beads.flat().some(Boolean)) return null;
    const entry = encodePattern(snapshot);
    user.history.unshift(entry);
    user.history = user.history.slice(0, HISTORY_LIMIT);
    saveState();
    return entry;
  }

  function drawHistoryPreview(canvas, entry) {
    const snapshot = decodePattern(entry);
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

  function renderHistory() {
    const user = currentUser();
    const list = $('historyList');
    if (!user?.history?.length) {
      list.innerHTML = '<div class="empty-list">还没有保存过图纸</div>';
      return;
    }
    list.innerHTML = user.history.map(entry => `<article class="history-item" data-history-id="${entry.id}"><canvas width="104" height="104"></canvas><div class="history-meta"><strong>${escapeHtml(entry.title)}</strong><small>${entry.width} × ${entry.height} · MARD ${entry.paletteSize}</small><small>${new Date(entry.createdAt).toLocaleString('zh-CN')}</small><div class="history-actions"><button data-open-history="${entry.id}">打开</button><button data-delete-history="${entry.id}">删除</button></div></div></article>`).join('');
    list.querySelectorAll('.history-item').forEach(item => {
      const entry = user.history.find(value => value.id === item.dataset.historyId);
      drawHistoryPreview(item.querySelector('canvas'), entry);
    });
    list.querySelectorAll('[data-open-history]').forEach(button => button.onclick = () => {
      const entry = user.history.find(value => value.id === button.dataset.openHistory);
      if (!entry) return;
      studio.loadPattern(decodePattern(entry));
      closeModal('accountModal');
      studio.notify('已打开历史图纸');
    });
    list.querySelectorAll('[data-delete-history]').forEach(button => button.onclick = () => {
      if (!window.confirm('确定删除这张历史图纸吗？')) return;
      user.history = user.history.filter(value => value.id !== button.dataset.deleteHistory);
      saveState();
      renderHistory();
    });
  }

  function renderInventory() {
    const user = ensureUserShape(currentUser());
    if (!user) return;
    const query = $('inventorySearch').value.trim().toUpperCase();
    const colors = fullPalette.filter(([id]) => !query || id.includes(query));
    $('inventoryList').innerHTML = colors.map(([id, color]) => {
      const value = Math.max(0, Number(user.inventory[id] || 0));
      return `<label class="inventory-row"><i style="background:${color}"></i><b>${id}</b><small>${value < 100 ? '库存偏低' : '剩余数量'}</small><input type="number" min="0" step="1" value="${value}" data-inventory-id="${id}" /></label>`;
    }).join('');
    const registered = Object.values(user.inventory).filter(value => Number(value) > 0).length;
    $('inventorySummary').textContent = `已登记 ${registered} 种颜色`;
    $('inventoryList').querySelectorAll('[data-inventory-id]').forEach(input => input.onchange = () => {
      user.inventory[input.dataset.inventoryId] = Math.max(0, Math.floor(Number(input.value) || 0));
      saveState();
      const count = Object.values(user.inventory).filter(value => Number(value) > 0).length;
      $('inventorySummary').textContent = `已登记 ${count} 种颜色`;
    });
  }

  function renderProfile() {
    const user = ensureUserShape(currentUser());
    if (!user) return;
    $('profileNickname').value = user.nickname;
    $('profileRegion').value = user.region;
    $('profileAvatarImage').classList.toggle('hidden', !user.avatar);
    $('profileAvatarFallback').classList.toggle('hidden', Boolean(user.avatar));
    if (user.avatar) $('profileAvatarImage').src = user.avatar;
    $('profileAvatarFallback').textContent = accountInitial(user);
    $('locationStatus').textContent = '';
  }

  function selectAccountTab(tab) {
    document.querySelectorAll('[data-account-tab]').forEach(button => button.classList.toggle('active', button.dataset.accountTab === tab));
    document.querySelectorAll('[data-account-view]').forEach(view => view.classList.toggle('active', view.dataset.accountView === tab));
    if (tab === 'history') renderHistory();
    if (tab === 'inventory') renderInventory();
    if (tab === 'profile') renderProfile();
  }

  function openAccount(tab = 'history') {
    if (!currentUser()) {
      openModal('authModal');
      return;
    }
    selectAccountTab(tab);
    openModal('accountModal');
  }

  function updateLowStockAlert() {
    const low = stockRows.filter(row => Number(row.after) < 100);
    $('lowStockAlert').classList.toggle('hidden', low.length === 0);
    $('lowStockAlert').innerHTML = low.length ? `<strong>需要补充拼豆：</strong> ${low.map(row => `${row.id}（剩余 ${row.after}）`).join('、')}` : '';
  }

  function openStockAdjustment(snapshot) {
    const user = ensureUserShape(currentUser());
    const fingerprint = patternFingerprint(snapshot);
    if (user.completed.includes(fingerprint)) return;
    const usage = new Map();
    snapshot.beads.flat().filter(Boolean).forEach(id => usage.set(id, (usage.get(id) || 0) + 1));
    stockRows = [...usage].sort((a, b) => b[1] - a[1]).map(([id, used]) => {
      const before = Math.max(0, Number(user.inventory[id] || 0));
      const after = Math.max(0, before - used);
      user.inventory[id] = after;
      return { id, used, before, after };
    });
    user.completed.unshift(fingerprint);
    user.completed = user.completed.slice(0, 100);
    saveState();
    $('stockAdjustList').innerHTML = stockRows.map(row => `<label class="stock-adjust-row"><i style="background:${colorById.get(row.id)?.[1] || '#fff'}"></i><b>${row.id}</b><small>原有 ${row.before} · 图纸使用 ${row.used}</small><input type="number" min="0" step="1" value="${row.after}" data-stock-id="${row.id}" /></label>`).join('');
    $('stockAdjustList').querySelectorAll('[data-stock-id]').forEach(input => input.oninput = () => {
      const row = stockRows.find(value => value.id === input.dataset.stockId);
      row.after = Math.max(0, Math.floor(Number(input.value) || 0));
      updateLowStockAlert();
    });
    updateLowStockAlert();
    openModal('stockModal');
  }

  function recordExport() {
    const snapshot = studio.getSnapshot();
    if (!snapshot.beads.flat().some(Boolean)) return;
    requireUser(() => {
      savePatternSnapshot(snapshot);
      renderHistory();
      openStockAdjustment(snapshot);
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
    if (button.dataset.closeModal === 'authModal') pendingAfterLogin = null;
  });
  document.querySelectorAll('[data-auth-provider]').forEach(button => button.onclick = () => setAuthProvider(button.dataset.authProvider));
  document.querySelectorAll('[data-account-tab]').forEach(button => button.onclick = () => selectAccountTab(button.dataset.accountTab));
  $('loginSubmit').onclick = submitLogin;
  $('accountIdInput').onkeydown = event => event.key === 'Enter' && submitLogin();
  $('userBtn').onclick = () => currentUser() ? openAccount('history') : openModal('authModal');
  $('inventorySearch').oninput = renderInventory;
  $('avatarEditor').onclick = () => $('avatarInput').click();
  $('avatarInput').onchange = event => {
    const file = event.target.files[0];
    if (!file) return;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 160;
      const context = canvas.getContext('2d');
      const scale = Math.max(160 / image.naturalWidth, 160 / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (160 - width) / 2, (160 - height) / 2, width, height);
      const user = ensureUserShape(currentUser());
      user.avatar = canvas.toDataURL('image/jpeg', .84);
      URL.revokeObjectURL(image.src);
      saveState();
      renderProfile();
      renderUserButton();
    };
    image.src = URL.createObjectURL(file);
  };
  $('locateBtn').onclick = () => {
    if (!navigator.geolocation) {
      $('locationStatus').textContent = '当前浏览器不支持定位';
      return;
    }
    $('locationStatus').textContent = '正在获取位置…';
    navigator.geolocation.getCurrentPosition(position => {
      $('profileRegion').value = `${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`;
      $('locationStatus').textContent = '已获取位置，可继续手动修改地区';
    }, () => {
      $('locationStatus').textContent = '定位失败，请检查浏览器权限或手动输入';
    }, { enableHighAccuracy: false, timeout: 10000 });
  };
  $('saveProfileBtn').onclick = () => {
    const user = ensureUserShape(currentUser());
    const nickname = $('profileNickname').value.trim();
    if (!nickname) {
      $('locationStatus').textContent = '昵称不能为空';
      return;
    }
    user.nickname = nickname;
    user.region = $('profileRegion').value.trim();
    saveState();
    renderUserButton();
    studio.notify('个人资料已保存');
  };
  $('logoutBtn').onclick = () => {
    state.currentId = null;
    saveState();
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
    requireUser(() => {
      savePatternSnapshot(snapshot);
      studio.startFreshCreate();
      studio.notify('当前图纸已保存到生成历史');
    });
  };
  $('saveStockAdjustments').onclick = () => {
    const user = ensureUserShape(currentUser());
    stockRows.forEach(row => user.inventory[row.id] = row.after);
    saveState();
    closeModal('stockModal');
    studio.notify('拼豆库存已更新');
  };

  renderUserButton();
  window.accountManager = { recordExport, requestFreshCreate };
})();
