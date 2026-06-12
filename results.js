/*
 * Página pública de resultados de la quiniela.
 * Lee principalmente desde Cloudflare Worker. bet_data.json queda como respaldo.
 */

const RESULTS_CONFIG = window.APP_CONFIG || {};
const API_ENDPOINT_RESULTS = RESULTS_CONFIG.API_ENDPOINT || '';
const POINTS_EXACT_SCORE_RESULTS = 3;

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const [betData, matchesData] = await Promise.all([loadBetData(), loadMatchesData()]);
    const normalized = normalizeBetDataResults(betData);
    const matches = Array.isArray(matchesData.matches) ? matchesData.matches : matchesData;

    recalculateStandingsResults(normalized);
    renderParticipantsSummary(normalized.participants || []);
    renderMatchesSummary(normalized.results || {}, matches || []);
  } catch (error) {
    console.error('Error al cargar datos:', error);
    document.getElementById('participants-summary').textContent = 'No se pudieron cargar los datos.';
  }
});

async function loadBetData() {
  if (API_ENDPOINT_RESULTS) {
    try {
      const response = await fetch(`${API_ENDPOINT_RESULTS}?_=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`La API respondió ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.warn('No se pudo obtener betData desde Cloudflare:', error);
    }
  }

  try {
    const response = await fetch('bet_data.json', { cache: 'no-store' });
    return await response.json();
  } catch (error) {
    console.warn('No se pudo cargar bet_data.json:', error);
    return {};
  }
}

async function loadMatchesData() {
  try {
    const response = await fetch('matches.json', { cache: 'no-store' });
    return await response.json();
  } catch (error) {
    console.warn('No se pudo cargar matches.json. Se usará MATCHES_DATA:', error);
    return { matches: Array.isArray(window.MATCHES_DATA) ? window.MATCHES_DATA : [] };
  }
}

function normalizeBetDataResults(data) {
  const source = data && typeof data === 'object' ? data : {};
  return {
    participants: Array.isArray(source.participants)
      ? source.participants
          .map((p) => ({
            name: String(p.name || '').trim(),
            correct: Number.isFinite(Number(p.correct)) ? Number(p.correct) : 0,
            points: Number.isFinite(Number(p.points))
              ? Number(p.points)
              : (Number.isFinite(Number(p.correct)) ? Number(p.correct) * POINTS_EXACT_SCORE_RESULTS : 0)
          }))
          .filter((p) => p.name)
      : [],
    predictions: source.predictions && typeof source.predictions === 'object' ? source.predictions : {},
    results: source.results && typeof source.results === 'object' ? source.results : {}
  };
}

function recalculateStandingsResults(data) {
  data.participants.forEach((participant) => {
    participant.correct = 0;
    participant.points = 0;
  });

  Object.keys(data.results || {}).forEach((idx) => {
    const result = data.results[idx];
    const winners = [];

    data.participants.forEach((participant) => {
      const prediction = data.predictions[idx] ? data.predictions[idx][participant.name] : null;
      if (prediction && prediction.score1 === result.score1 && prediction.score2 === result.score2) {
        participant.correct += 1;
        participant.points += POINTS_EXACT_SCORE_RESULTS;
        winners.push(participant.name);
      }
    });

    result.winners = winners;
    result.pointsPerWinner = POINTS_EXACT_SCORE_RESULTS;
  });
}

function renderParticipantsSummary(participants) {
  const container = document.getElementById('participants-summary');
  container.innerHTML = '';

  if (!participants || participants.length === 0) {
    container.textContent = 'No hay participantes registrados.';
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hdrRow = document.createElement('tr');

  ['Participante', 'Aciertos', 'Puntos'].forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    hdrRow.appendChild(th);
  });

  thead.appendChild(hdrRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  participants
    .slice()
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return b.correct - a.correct;
    })
    .forEach((p) => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = p.name;
      const tdCorrect = document.createElement('td');
      tdCorrect.textContent = p.correct;
      const tdPoints = document.createElement('td');
      tdPoints.textContent = p.points;
      tr.appendChild(tdName);
      tr.appendChild(tdCorrect);
      tr.appendChild(tdPoints);
      tbody.appendChild(tr);
    });

  table.appendChild(tbody);
  container.appendChild(table);
}

function renderMatchesSummary(results, matches) {
  const container = document.getElementById('matches-summary');
  container.innerHTML = '';

  const resArray = Object.keys(results).map((idx) => ({
    idx: parseInt(idx, 10),
    result: results[idx]
  }));

  if (resArray.length === 0) {
    container.textContent = 'Aún no hay resultados registrados.';
    return;
  }

  resArray.sort((a, b) => {
    const matchA = matches[a.idx];
    const matchB = matches[b.idx];
    if (!matchA || !matchB) return 0;
    const dateA = new Date(`${matchA.date}T${matchA.time ? matchA.time.split(' ')[0] : '00:00'}`);
    const dateB = new Date(`${matchB.date}T${matchB.time ? matchB.time.split(' ')[0] : '00:00'}`);
    return dateA - dateB;
  });

  resArray.forEach(({ idx, result }) => {
    const match = matches[idx];
    const card = document.createElement('div');
    card.className = 'match-result-card';

    const title = document.createElement('h3');
    title.textContent = match ? `${match.team1} vs. ${match.team2}` : `Partido ${idx}`;

    const info = document.createElement('p');
    if (match) info.textContent = `${match.date}${match.time ? ' ' + match.time : ''}`;

    const score = document.createElement('p');
    score.textContent = `Marcador final: ${result.score1} - ${result.score2}`;

    const pointsInfo = document.createElement('p');
    pointsInfo.textContent = `Puntos por marcador exacto: ${result.pointsPerWinner || POINTS_EXACT_SCORE_RESULTS}`;

    const winnersInfo = document.createElement('p');
    if (result.winners && result.winners.length > 0) {
      winnersInfo.textContent = `Acertaron (${result.winners.length}): ${result.winners.join(', ')}`;
    } else {
      winnersInfo.textContent = 'Nadie acertó el marcador exacto.';
    }

    card.appendChild(title);
    if (info.textContent) card.appendChild(info);
    card.appendChild(score);
    card.appendChild(pointsInfo);
    card.appendChild(winnersInfo);
    container.appendChild(card);
  });
}
