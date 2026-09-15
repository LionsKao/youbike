const DATA_URL = '/api/youbike';
const REFRESH_MS = 30000;
const NEAREST_COUNT = 3;

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
let prevValues = new Map();
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

const UNKNOWN_COLOR = '#9A8C7E';

// Split-flap "flip" reveal: only rendered as an animated flip when the shown
// text actually changes from the last render; otherwise a plain static span.
function flipSpan(oldText, newText, oldColor, newColor) {
  if (oldText === newText) return `<span style="color:${newColor}">${newText}</span>`;
  return `<span class="flip-card"><span class="flip-card-inner">` +
    `<span class="flip-face front" style="color:${oldColor}">${oldText}</span>` +
    `<span class="flip-face back" style="color:${newColor}">${newText}</span>` +
    `</span></span>`;
}

function breakdownItem(cls, key, value, label, knownColor, prev) {
  const known = value != null;
  const newText = known ? value : '--';
  const prevKnown = !!prev && prev[key] != null;
  const oldText = prev ? (prevKnown ? prev[key] : '--') : '--';
  const oldColor = prevKnown ? knownColor : UNKNOWN_COLOR;
  const newColor = known ? knownColor : UNKNOWN_COLOR;
  return `
      <div class="breakdown-item ${cls}">
        <div class="b-num">${flipSpan(String(oldText), String(newText), oldColor, newColor)}</div>
        <div class="b-label">${label}</div>
      </div>`;
}

function breakdownRow(s, prev) {
  return `
    <div class="breakdown-row">${breakdownItem('b-general', 'general', s.general, '一般', '#3F9C7A', prev)}${breakdownItem('b-electric', 'electric', s.electric, '電動', '#B8860B', prev)}${breakdownItem('b-dock', 'returnable', s.returnable, '可停', 'var(--sky-deep)', prev)}
    </div>`;
}

function stationCard(s, featured) {
  const color = ratioColor(s.available, s.total, s.returnable);
  const prev = prevValues.get(s.sno);
  const distKnown = s.dist != null;
  const subLine = `<div class="site-sub site-dist${distKnown ? '' : ' unknown'}">${distKnown ? formatDistance(s.dist) : '--'}</div>`;

  const availKnown = s.available != null;
  const newNumText = availKnown ? s.available : '--';
  const prevAvailKnown = !!prev && prev.available != null;
  const oldNumText = prev ? (prevAvailKnown ? prev.available : '--') : '--';
  const oldNumColor = prevAvailKnown ? color.text : UNKNOWN_COLOR;
  const newNumColor = availKnown ? color.text : UNKNOWN_COLOR;
  const numHtml = flipSpan(String(oldNumText), String(newNumText), oldNumColor, newNumColor);

  return `
    <div class="station-card${featured ? ' featured' : ''}" data-sno="${s.sno}">
      <div class="site-name"><span>${s.name}</span></div>
      ${subLine}
      <div class="dial-wrap">
        <div class="dial${featured ? ' large' : ''}">
          ${dialSvg(s.available, s.total, color)}
          <div class="num">${numHtml}</div>
        </div>
      </div>
      ${featured ? breakdownRow(s, prev) : ''}
    </div>`;
}

let swapAnimating = false;

function animateCardSwap(prevRects) {
  const cards = cardGrid.querySelectorAll('.station-card');
  let pending = 0;

  cards.forEach(card => {
    const prev = prevRects.get(card.dataset.sno);
    if (!prev) return;
    const next = card.getBoundingClientRect();
    const dx = prev.left - next.left;
    const dy = prev.top - next.top;
    const sx = prev.width / next.width;
    const sy = prev.height / next.height;
    if (!dx && !dy && sx === 1 && sy === 1) return;

    pending++;
    card.style.transformOrigin = 'top left';
    card.style.transition = 'none';
    card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    card.style.willChange = 'transform';

    const breakdown = card.querySelector('.breakdown-row');
    if (breakdown) breakdown.style.opacity = '0';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.style.transition = 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)';
        card.style.transform = '';
        if (breakdown) {
          breakdown.style.transition = 'opacity 0.25s ease 0.15s';
          breakdown.style.opacity = '1';
        }
        card.addEventListener('transitionend', () => {
          card.style.transition = '';
          card.style.willChange = '';
          pending--;
          if (pending === 0) swapAnimating = false;
        }, { once: true });
      });
    });
  });

  if (pending === 0) swapAnimating = false;
}

function render(list) {
  lastList = list;

  const [first, ...restAll] = list;
  featuredStation = first || null;
  const featuredHtml = first ? stationCard(first, true) : '';
  const restHtml = restAll.map(s => stationCard(s, false)).join('');

  cardGrid.innerHTML = featuredHtml + `<div class="card-grid-small">${restHtml}</div>`;
  revealCardGrid();

  prevValues = new Map(list.map(s => [s.sno, {
    available: s.available, general: s.general, electric: s.electric, returnable: s.returnable,
  }]));

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cardGrid.querySelectorAll('.flip-card').forEach(el => el.classList.add('flipped'));
    });
  });
}

cardGrid.addEventListener('click', e => {
  const card = e.target.closest('.station-card');
  if (!card) return;
  const station = lastList.find(s => s.sno === card.dataset.sno);
  if (!station) return;

  const nameEl = e.target.closest('.site-name');
  if (nameEl) {
    window.open(`https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lng}`, '_blank');
    return;
  }

  if (lastList[0] === station || swapAnimating) return;

  const prevRects = new Map();
  cardGrid.querySelectorAll('.station-card').forEach(c => {
    prevRects.set(c.dataset.sno, c.getBoundingClientRect());
  });

  swapAnimating = true;
  render([station, ...lastList.filter(s => s !== station)]);
  animateCardSwap(prevRects);
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
        general: userPos ? s.general_bikes : null,
        electric: userPos ? s.electric_bikes : null,
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
    }).catch(() => openLocationRequestModal(() => fetchLiveData()));
  } else {
    openLocationRequestModal(() => fetchLiveData());
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

function refreshData(onDone) {
  if (fabLocation.disabled) { if (onDone) onDone(); return; }
  if (fabDebugFake) fabDebugFake.classList.remove('active');
  setLocationLoading(true);
  const finish = () => { setLocationLoading(false); if (onDone) onDone(); };
  const notifyUpdated = () => { setLocationLoading(false); showPillWarning(fabLocation, '已更新車輛和定位資訊'); if (onDone) onDone(); };
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
    }).catch(() => { finish(); openLocationRequestModal(); });
  } else {
    finish();
    openLocationRequestModal();
  }
}

fabLocation.addEventListener('click', () => refreshData());

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
// Moved out of .fab-stack (which has an SVG `filter` for the outline effect) because
// filtered elements clip their descendants to the filter region, cutting this popup off.
document.body.appendChild(qrCodeTooltip);

function positionQrTooltip() {
  const rect = qrCodeBtn.getBoundingClientRect();
  const half = qrCodeTooltip.offsetWidth / 2;
  const margin = 8;
  const anchorCenterX = rect.left + rect.width / 2;
  const centerX = Math.max(half + margin, Math.min(window.innerWidth - half - margin, anchorCenterX));
  qrCodeTooltip.style.left = centerX + 'px';
  qrCodeTooltip.style.bottom = (window.innerHeight - rect.top) + 'px';
}

qrCodeBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (!qrCodeTooltip.classList.contains('visible')) positionQrTooltip();
  qrCodeTooltip.classList.toggle('visible');
});
document.addEventListener('click', e => {
  if (!qrCodeTooltip.classList.contains('visible')) return;
  if (e.target.closest('#qrCodeBtnWrap') || e.target.closest('#qrCodeTooltip')) return;
  qrCodeTooltip.classList.remove('visible');
});

function placeholderStation(i) {
  return { sno: `placeholder-${i}`, name: '--', lat: null, lng: null, total: null, available: null, returnable: null, general: null, electric: null, dist: null };
}
render([placeholderStation(0), placeholderStation(1), placeholderStation(2)]);

requestLocation();
// setInterval(() => { if (firstLoadDone) fetchLiveData(); }, REFRESH_MS);

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

  const pullRefresh = document.getElementById('pullRefresh');
  const PULL_THRESHOLD = 64;
  const PULL_MAX = 90;
  let pullStartY = null;
  let pullDist = 0;
  let pullRefreshing = false;

  function setPull(dist, animate) {
    pullRefresh.style.transition = animate ? 'transform 0.25s ease' : 'none';
    pullRefresh.style.transform = `translate(-50%, ${dist - 60}px)`;
  }

  document.addEventListener('touchstart', e => {
    if (pullRefreshing || window.scrollY > 0) { pullStartY = null; return; }
    pullStartY = e.touches[0].clientY;
    pullDist = 0;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (pullStartY == null || pullRefreshing) return;
    const deltaY = e.touches[0].clientY - pullStartY;
    if (deltaY <= 0) return;
    pullDist = Math.min(deltaY * 0.5, PULL_MAX);
    setPull(pullDist, false);
    if (deltaY > 10) e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (pullStartY == null) return;
    pullStartY = null;
    if (pullDist >= PULL_THRESHOLD) {
      pullRefreshing = true;
      pullRefresh.classList.add('spinning');
      setPull(PULL_THRESHOLD, true);
      refreshData(() => {
        pullRefreshing = false;
        pullRefresh.classList.remove('spinning');
        setPull(0, true);
      });
    } else {
      setPull(0, true);
    }
  });
}
