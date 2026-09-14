const TDX_TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TDX_API_BASE = 'https://tdx.transportdata.tw/api/basic/v2/Bike';
const CITY_CACHE_TTL = 60;

// Approximate city-hall coordinates for TDX's 22 county/city codes. Only used
// to pick which 1-2 cities are worth querying for a given position, so this
// doesn't need to be precise — we fetch real per-station coordinates from TDX.
const CITY_CENTERS = {
  Keelung: [25.1276, 121.7392],
  Taipei: [25.0330, 121.5654],
  NewTaipei: [25.0169, 121.4627],
  Taoyuan: [24.9936, 121.3010],
  Hsinchu: [24.8138, 120.9675],
  HsinchuCounty: [24.8388, 121.0177],
  MiaoliCounty: [24.5602, 120.8214],
  Taichung: [24.1477, 120.6736],
  ChanghuaCounty: [24.0518, 120.5161],
  NantouCounty: [23.9609, 120.9718],
  YunlinCounty: [23.7092, 120.5388],
  Chiayi: [23.4801, 120.4491],
  ChiayiCounty: [23.4518, 120.2555],
  Tainan: [22.9997, 120.2270],
  Kaohsiung: [22.6273, 120.3014],
  PingtungCounty: [22.6813, 120.4886],
  YilanCounty: [24.7021, 121.7377],
  HualienCounty: [23.9871, 121.6015],
  TaitungCounty: [22.7583, 121.1444],
  KinmenCounty: [24.4491, 118.3767],
  PenghuCounty: [23.5711, 119.5793],
  LienchiangCounty: [26.1608, 119.9498],
};

// Used only when we don't have any user position at all (no geolocation support).
const DEFAULT_CITIES = ['Taipei', 'NewTaipei'];

// Reused across invocations while the isolate stays warm; falls back to a
// fresh token automatically once expired or on a cold start.
let cachedToken = null;

async function getAccessToken(clientId, clientSecret) {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (!clientId || !clientSecret) throw new Error('missing TDX_CLIENT_ID/TDX_CLIENT_SECRET');

  const res = await fetch(TDX_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error('TDX auth failed: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));

  const json = await res.json();
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return cachedToken.value;
}

async function fetchCity(city, token) {
  try {
    const headers = { authorization: `Bearer ${token}` };
    const [stationRes, availRes] = await Promise.all([
      fetch(`${TDX_API_BASE}/Station/City/${city}?%24format=JSON`, { headers }),
      fetch(`${TDX_API_BASE}/Availability/City/${city}?%24format=JSON`, { headers }),
    ]);
    if (!stationRes.ok || !availRes.ok) {
      console.error(`youbike: ${city} HTTP station=${stationRes.status} avail=${availRes.status}`);
      // Drain both bodies even on failure — an unread Response body holds the
      // connection open and Workers will start canceling unrelated in-flight
      // requests once too many pile up.
      await Promise.all([stationRes.text().catch(() => {}), availRes.text().catch(() => {})]);
      return null; // fetch failure — distinct from a city that legitimately has 0 stations
    }

    const [stations, avail] = await Promise.all([stationRes.json(), availRes.json()]);
    const availByUid = new Map(avail.map(a => [a.StationUID, a]));

    return stations.map(s => {
      const a = availByUid.get(s.StationUID) || {};
      const detail = a.AvailableRentBikesDetail || {};
      return {
        sno: s.StationUID,
        sna: s.StationName?.Zh_tw || '',
        latitude: s.StationPosition?.PositionLat,
        longitude: s.StationPosition?.PositionLon,
        Quantity: s.BikesCapacity,
        available_rent_bikes: a.AvailableRentBikes ?? null,
        available_return_bikes: a.AvailableReturnBikes ?? null,
        general_bikes: detail.GeneralBikes ?? null,
        electric_bikes: detail.ElectricBikes ?? null,
        act: a.ServiceStatus === 1 ? '1' : '0',
      };
    });
  } catch (err) {
    console.error(`youbike: ${city} fetch failed`, err);
    return null;
  }
}

async function getCityStations(city, token, waitUntil) {
  const cache = caches.default;
  const key = new Request(`https://cache.internal/youbike-tdx-city-${city}`);

  const cached = await cache.match(key);
  if (cached) return cached.json();

  let list = await fetchCity(city, token);
  if (list === null) list = await fetchCity(city, token); // one retry on transient failure
  if (list === null) return [];

  if (list.length > 0) {
    waitUntil(cache.put(key, new Response(JSON.stringify(list), {
      headers: {
        'content-type': 'application/json',
        'cache-control': `max-age=${CITY_CACHE_TTL}`,
      },
    })));
  }
  return list;
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

// Picks the `count` cities whose center is nearest the given position, so we
// only ever call TDX for a small, geographically-relevant slice of Taiwan
// instead of all 22 counties on every request.
function nearestCities(lat, lng, count) {
  return Object.entries(CITY_CENTERS)
    .map(([city, [cLat, cLng]]) => ({ city, dist: haversineMeters(lat, lng, cLat, cLng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
    .map(c => c.city);
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const n = parseInt(url.searchParams.get('n') || '5', 10);
  const hasPos = !Number.isNaN(lat) && !Number.isNaN(lng);

  const cities = hasPos ? nearestCities(lat, lng, 2) : DEFAULT_CITIES;

  let stations;
  try {
    const token = await getAccessToken(env.TDX_CLIENT_ID, env.TDX_CLIENT_SECRET);
    const lists = await Promise.all(cities.map(city => getCityStations(city, token, waitUntil)));
    stations = lists.flat();
  } catch (err) {
    console.error('youbike: upstream error', err);
    return new Response(JSON.stringify({ error: 'upstream error' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  stations = stations.filter(s => s.act === '1' && s.latitude && s.longitude);

  if (hasPos) {
    stations = stations.map(s => ({ ...s, dist: haversineMeters(lat, lng, s.latitude, s.longitude) }));
    stations.sort((a, b) => a.dist - b.dist);
  } else {
    stations = stations.slice().sort((a, b) => (a.sna || '').localeCompare(b.sna || ''));
  }

  const sliced = stations.slice(0, Math.max(n, 1));

  return new Response(JSON.stringify(sliced), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}
