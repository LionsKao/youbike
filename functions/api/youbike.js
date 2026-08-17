const SOURCE_URL = 'https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json';

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const n = parseInt(url.searchParams.get('n') || '5', 10);
  const hasPos = !Number.isNaN(lat) && !Number.isNaN(lng);

  const res = await fetch(SOURCE_URL, { cf: { cacheTtl: 120, cacheEverything: true } });
  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'upstream error' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  let stations = (await res.json()).filter(s => s.act === '1');

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
