const DATA_URL = '/api/youbike';
const REFRESH_MS = 30000;
const NEAREST_COUNT = 5;

const cardGrid = document.getElementById('cardGrid');
const loadingState = document.getElementById('loadingState');
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalActions = document.getElementById('modalActions');
const fabLocation = document.getElementById('fabLocation');
const fabDebugPwa = document.getElementById('fabDebugPwa');
const fabDebugFake = document.getElementById('fabDebugFake');

const pillWarnTooltip = document.createElement('div');
pillWarnTooltip.id = 'pillWarnTooltip';
pillWarnTooltip.className = 'pill-warn-tooltip';
document.body.appendChild(pillWarnTooltip);
let pillWarnTimer = null;
function showPillWarning(anchorEl, text, persist) {
  const rect = anchorEl.getBoundingClientRect();
  pillWarnTooltip.textContent = text;
  const half = pillWarnTooltip.offsetWidth / 2;
  const margin = 8;
  const anchorCenterX = rect.left + rect.width / 2;
  const centerX = Math.max(half + margin, Math.min(window.innerWidth - half - margin, anchorCenterX));
  pillWarnTooltip.style.left = centerX + 'px';
  pillWarnTooltip.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
  const arrowPct = half > 0 ? Math.max(10, Math.min(90, ((anchorCenterX - centerX) / (half * 2) + 0.5) * 100)) : 50;
  pillWarnTooltip.style.setProperty('--arrow-left', arrowPct + '%');
  pillWarnTooltip.classList.add('visible');
  clearTimeout(pillWarnTimer);
  if (!persist) {
    pillWarnTimer = setTimeout(() => pillWarnTooltip.classList.remove('visible'), 1800);
  }
}
function hidePillWarning() {
  clearTimeout(pillWarnTimer);
  pillWarnTooltip.classList.remove('visible');
}

function closeModal() {
  modalOverlay.style.display = 'none';
}

function openModal({ title, body, singleButton, confirmColor, confirmLabel, onConfirm }) {
  modalTitle.textContent = title;
  if (body) {
    modalBody.textContent = body;
    modalBody.style.display = '';
  } else {
    modalBody.textContent = '';
    modalBody.style.display = 'none';
  }

  modalActions.innerHTML = '';
  if (!singleButton) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'compass-modal-btn compass-modal-cancel';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', closeModal);
    modalActions.appendChild(cancelBtn);
  }

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'compass-modal-btn compass-modal-confirm';
  confirmBtn.style.background = confirmColor;
  confirmBtn.textContent = confirmLabel || '確定';
  confirmBtn.addEventListener('click', () => {
    closeModal();
    if (onConfirm) onConfirm();
  });
  modalActions.appendChild(confirmBtn);

  modalOverlay.style.display = 'flex';
}

modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) closeModal();
});

let userPos = null;
let lastList = [];
let featuredStation = null;
let firstLoadDone = false;

function revealCardGrid() {
  if (firstLoadDone) return;
  firstLoadDone = true;
  loadingState.style.display = 'none';
  cardGrid.style.display = '';
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistance(m) {
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toFixed(1) + ' km';
}

function ratioColor(available, total, returnable) {
  if (available == null) return { hex: '#D8CDBF', text: '#9A8C7E' };
  if (returnable === 0) return { hex: '#FFAAB8', text: '#D9647A' };
  if (available <= 2) return { hex: '#FFAAB8', text: '#D9647A' };
  if (available <= 6) return { hex: '#FFD966', text: '#B8860B' };
  return { hex: '#8FE0C0', text: '#3F9C7A' };
}

function dialSvg(available, total, color) {
  const r = 34, c = 2 * Math.PI * r;
  const ratio = total > 0 && available != null ? Math.min(available / total, 1) : 0;
  const offset = c * (1 - ratio);
  return `<svg class="ring-svg" viewBox="0 0 80 80">
    <circle class="ring-bg" cx="40" cy="40" r="${r}" fill="none" stroke-width="11"/>
    <circle class="ring-val" cx="40" cy="40" r="${r}" fill="none" stroke="${color.hex}" stroke-width="11"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 40 40)"/>
  </svg>`;
}

function stationCard(s, featured) {
  const color = ratioColor(s.available, s.total, s.returnable);
  const subLine = s.dist != null ? `<div class="site-sub site-dist">${formatDistance(s.dist)}</div>` : '';
  return `
    <div class="station-card${featured ? ' featured' : ''}" data-sno="${s.sno}">
      <div class="site-name"><span>${s.name}</span></div>
      ${subLine}
      <div class="dial-wrap">
        <div class="dial${featured ? ' large' : ''}">
          ${dialSvg(s.available, s.total, color)}
          <div class="num" style="color:${color.text}">${s.available != null ? s.available : '--'}</div>
        </div>
      </div>
    </div>`;
}

function render(list) {
  lastList = list;

  const [first, ...restAll] = list;
  featuredStation = first || null;
  const featuredHtml = first ? stationCard(first, true) : '';
  const restHtml = restAll.map(s => stationCard(s, false)).join('');

  cardGrid.innerHTML = featuredHtml + `<div class="card-grid-small">${restHtml}</div>`;
  revealCardGrid();
}

cardGrid.addEventListener('click', e => {
  const nameEl = e.target.closest('.site-name');
  if (!nameEl) return;
  const card = nameEl.closest('.station-card');
  if (!card) return;
  const station = lastList.find(s => s.sno === card.dataset.sno);
  if (!station) return;
  window.open(`https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lng}`, '_blank');
});

let dataErrorModalShown = false;

function showDataErrorModal() {
  if (dataErrorModalShown) return;
  dataErrorModalShown = true;
  openModal({
    title: '無法取得即時資料',
    body: '請確認網路連線後再試一次。',
    singleButton: true,
    confirmColor: 'var(--sun)',
    confirmLabel: '我知道了',
  });
}

async function fetchLiveData() {
  const params = new URLSearchParams();
  if (userPos) {
    params.set('lat', userPos.lat);
    params.set('lng', userPos.lng);
  }
  params.set('n', NEAREST_COUNT);
  const url = DATA_URL + '?' + params.toString();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const list = json.map(s => ({
        sno: s.sno,
        name: userPos ? (s.sna || '').replace(/^YouBike2\.0_/, '').replace(/\([^)]*\)/g, m => m.split('').join('⁠')) : '--',
        lat: s.latitude,
        lng: s.longitude,
        total: s.Quantity,
        available: userPos ? s.available_rent_bikes : null,
        returnable: userPos ? s.available_return_bikes : null,
        dist: s.dist,
      }));
      dataErrorModalShown = false;
      render(list);
      return;
    } catch (err) {
      if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
    }
  }
  showDataErrorModal();
  render([]);
}

function getDebugPos() {
  const params = new URLSearchParams(location.search);
  const lat = parseFloat(params.get('lat'));
  const lng = parseFloat(params.get('lng'));
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

let watchId = null;
let lastDistRecomputeAt = 0;
const DIST_RECOMPUTE_MIN_MS = 1500;

function recomputeDistances() {
  if (!userPos || !lastList.length) return;
  const now = Date.now();
  if (now - lastDistRecomputeAt < DIST_RECOMPUTE_MIN_MS) return;
  lastDistRecomputeAt = now;
  const updated = lastList.map(s => ({
    ...s,
    dist: haversineMeters(userPos.lat, userPos.lng, s.lat, s.lng),
  }));
  render(updated);
}

function startWatchingPosition() {
  if (watchId != null || getDebugPos() || !('geolocation' in navigator)) return;
  watchId = navigator.geolocation.watchPosition(
    pos => {
      userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      recomputeDistances();
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );
}

const GEO_GRANTED_KEY = 'youbikeGeoGranted';

function markGeoGranted() {
  try { localStorage.setItem(GEO_GRANTED_KEY, '1'); } catch (e) {}
}
function clearGeoGranted() {
  try { localStorage.removeItem(GEO_GRANTED_KEY); } catch (e) {}
}
function hasGeoGrantedBefore() {
  try { return localStorage.getItem(GEO_GRANTED_KEY) === '1'; } catch (e) { return false; }
}

function doGeolocate(onDenied, onFail, onSuccess) {
  const debugPos = getDebugPos();
  if (debugPos) {
    userPos = debugPos;
    fetchLiveData().then(() => { if (onSuccess) onSuccess(); });
    return;
  }
  if (!('geolocation' in navigator)) {
    if (onFail) onFail();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      markGeoGranted();
      fetchLiveData().then(() => { if (onSuccess) onSuccess(); });
      startWatchingPosition();
    },
    err => {
      if (err.code === err.PERMISSION_DENIED) {
        clearGeoGranted();
        if (onDenied) onDenied();
        else if (onFail) onFail();
      } else if (onFail) {
        onFail();
      }
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function requestLocation() {
  if (getDebugPos()) { doGeolocate(undefined, () => fetchLiveData()); return; }
  if (!('geolocation' in navigator)) { fetchLiveData(); return; }
  if (hasGeoGrantedBefore()) { doGeolocate(showLocationBlockedModal, () => fetchLiveData()); return; }
  if ('permissions' in navigator) {
    navigator.permissions.query({ name: 'geolocation' }).then(status => {
      if (status.state === 'granted') {
        doGeolocate(undefined, () => fetchLiveData());
      } else if (status.state === 'denied') {
        showLocationBlockedModal();
      } else {
        openLocationRequestModal(() => fetchLiveData());
      }
    }).catch(() => doGeolocate(showLocationBlockedModal, () => fetchLiveData()));
  } else {
    doGeolocate(showLocationBlockedModal, () => fetchLiveData());
  }
}

function showLocationBlockedModal() {
  openModal({
    title: '定位權限已被封鎖',
    body: '請到設定的隱私權將定位手動開啟。',
    singleButton: true,
    confirmColor: 'var(--sun)',
    confirmLabel: '我知道了',
  });
}

function openLocationRequestModal(onFail) {
  openModal({
    title: '開啟定位服務',
    confirmColor: 'var(--sun)',
    onConfirm: () => doGeolocate(showLocationBlockedModal, onFail),
  });
}

function setLocationLoading(loading) {
  fabLocation.disabled = loading;
  fabLocation.classList.toggle('is-loading', loading);
  if (loading) {
    showPillWarning(fabLocation, '正在取得車輛和定位資訊', true);
  } else {
    hidePillWarning();
  }
}

fabLocation.addEventListener('click', () => {
  if (fabLocation.disabled) return;
  if (fabDebugFake) fabDebugFake.classList.remove('active');
  setLocationLoading(true);
  const finish = () => setLocationLoading(false);
  const notifyUpdated = () => { setLocationLoading(false); showPillWarning(fabLocation, '已更新車輛和定位資訊'); };
  const onDenied = () => { finish(); showLocationBlockedModal(); };
  if (getDebugPos()) { doGeolocate(undefined, finish, notifyUpdated); return; }
  if (!('geolocation' in navigator)) { finish(); return; }
  if (hasGeoGrantedBefore()) { doGeolocate(onDenied, finish, notifyUpdated); return; }
  if ('permissions' in navigator) {
    navigator.permissions.query({ name: 'geolocation' }).then(status => {
      if (status.state === 'granted') {
        doGeolocate(onDenied, finish, notifyUpdated);
      } else if (status.state === 'denied') {
        onDenied();
      } else {
        finish();
        openLocationRequestModal();
      }
    }).catch(() => doGeolocate(onDenied, finish, notifyUpdated));
  } else {
    doGeolocate(onDenied, finish, notifyUpdated);
  }
});

const fabNavigate = document.getElementById('fabNavigate');
fabNavigate.addEventListener('click', () => {
  if (!featuredStation) return;
  window.open(`https://www.google.com/maps/search/?api=1&query=${featuredStation.lat},${featuredStation.lng}`, '_blank');
});

const openAppBtn = document.getElementById('openAppBtn');
const YOUBIKE_ANDROID_PACKAGE = 'tw.com.youbike.plus';
const YOUBIKE_IOS_UNIVERSAL_LINK = 'https://www.youbike.com.tw/easy-wallet/';
const YOUBIKE_PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${YOUBIKE_ANDROID_PACKAGE}`;
openAppBtn.addEventListener('click', () => {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) {
    const fallback = encodeURIComponent(YOUBIKE_PLAY_STORE_URL);
    location.href = `intent://#Intent;package=${YOUBIKE_ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
  } else {
    location.href = YOUBIKE_IOS_UNIVERSAL_LINK;
  }
});

const qrCodeBtn = document.getElementById('qrCodeBtn');
const qrCodeTooltip = document.getElementById('qrCodeTooltip');
qrCodeBtn.addEventListener('click', e => {
  e.stopPropagation();
  qrCodeTooltip.classList.toggle('visible');
});
document.addEventListener('click', e => {
  if (!qrCodeTooltip.classList.contains('visible')) return;
  if (e.target.closest('#qrCodeBtnWrap')) return;
  qrCodeTooltip.classList.remove('visible');
});

requestLocation();
setInterval(() => { if (firstLoadDone) fetchLiveData(); }, REFRESH_MS);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);

if (isLocalhost) {
  document.querySelector('.fab-stack-left').style.display = 'flex';

  if (new URLSearchParams(location.search).get('pwa') === '1') {
    fabDebugPwa.classList.add('active');
  }

  fabDebugPwa.addEventListener('click', () => {
    const params = new URLSearchParams(location.search);
    if (params.get('pwa') === '1') params.delete('pwa');
    else params.set('pwa', '1');
    location.search = params.toString();
  });

  function activateFakePos() {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    userPos = { lat: 25.039159775, lng: 121.50309753 };
    fetchLiveData();
    fabDebugFake.classList.add('active');
  }

  fabDebugFake.addEventListener('click', () => {
    if (fabDebugFake.classList.contains('active')) {
      fabDebugFake.classList.remove('active');
      doGeolocate();
      return;
    }
    activateFakePos();
  });

  if (!getDebugPos()) activateFakePos();
} else {
  document.querySelector('.fab-stack-left').remove();
}

const isPwa = window.matchMedia('(display-mode: standalone)').matches
  || navigator.standalone === true
  || new URLSearchParams(location.search).get('pwa') === '1';

if (isPwa) {
  document.body.classList.add('pwa-mode');
}
