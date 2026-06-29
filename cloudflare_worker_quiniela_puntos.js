// Worker Cloudflare para quiniela de puntos virtuales.
// Requiere un KV namespace enlazado con binding: BETS_DATA
// Endpoint público usado por GitHub Pages: /api/betData

const DATA_KEY = 'betData';
const POINTS_PER_PARTICIPANT = 150;

const DEFAULT_DATA = {
  participants: [],
  predictions: {},
  results: {},
  accumulatedPool: 0,
  accumulatedPot: 0,
  settings: {
    pointsPerParticipant: POINTS_PER_PARTICIPANT,
    pointsPerParticipantUpdatedAt: null,
    pointsResetAfterResultIndex: null,
    pointsResetAt: null,
    manualPointsAfterResultIndex: null,
    manualPointsAt: null,
    manualPointsByParticipant: null
  }
};

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';

  const allowedOrigins = [
    'https://jetocorrales.github.io',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ];

  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin)
      ? origin
      : 'https://jetocorrales.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function jsonResponse(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeData(data) {
  const source = data && typeof data === 'object' ? data : {};

  const participants = Array.isArray(source.participants)
    ? source.participants
        .map((p) => ({
          name: String(p.name || '').trim(),
          correct: toNumber(p.correct, 0),
          points: toNumber(p.points, 0)
        }))
        .filter((p) => p.name)
    : [];

  return {
    participants,
    predictions: source.predictions && typeof source.predictions === 'object' ? source.predictions : {},
    results: source.results && typeof source.results === 'object' ? source.results : {},
    accumulatedPool: toNumber(source.accumulatedPool ?? source.accumulatedPot, 0),
    accumulatedPot: toNumber(source.accumulatedPot ?? source.accumulatedPool, 0),
    settings: {
      pointsPerParticipant: POINTS_PER_PARTICIPANT,
      pointsPerParticipantUpdatedAt: null,
      pointsResetAfterResultIndex: null,
      pointsResetAt: null,
      manualPointsAfterResultIndex: null,
      manualPointsAt: null,
      manualPointsByParticipant: null,
      ...(source.settings && typeof source.settings === 'object' ? source.settings : {})
    }
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request)
      });
    }

    if (url.pathname !== '/api/betData' && url.pathname !== '/api/betData/') {
      return jsonResponse(request, {
        error: 'Ruta no encontrada. Usa /api/betData'
      }, 404);
    }

    if (!env.BETS_DATA) {
      return jsonResponse(request, {
        error: 'KV no configurado. Enlaza un KV namespace con el binding BETS_DATA.'
      }, 500);
    }

    if (request.method === 'GET') {
      const stored = await env.BETS_DATA.get(DATA_KEY, { type: 'json' });
      return jsonResponse(request, normalizeData(stored || DEFAULT_DATA));
    }

    if (request.method === 'POST') {
      let payload;

      try {
        payload = await request.json();
      } catch (error) {
        return jsonResponse(request, { error: 'JSON inválido.' }, 400);
      }

      const cleanData = normalizeData(payload);
      await env.BETS_DATA.put(DATA_KEY, JSON.stringify(cleanData));

      return jsonResponse(request, {
        ok: true,
        message: 'Datos guardados correctamente.',
        data: cleanData
      });
    }

    return jsonResponse(request, {
      error: 'Método no permitido.'
    }, 405);
  }
};
