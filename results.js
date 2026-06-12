/*
 * Página pública de resultados de la quiniela.
 * Lee principalmente desde Cloudflare Worker. bet_data.json queda como respaldo.
 */

const RESULTS_CONFIG = window.APP_CONFIG || {};
const API_ENDPOINT_RESULTS = RESULTS_CONFIG.API_ENDPOINT || '';
const POINTS_PER_PARTICIPANT_RESULTS = 100;

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const [betData, matchesData] = await Promise.all([loadBetData(), loadMatchesData()]);
    const normalized = normalizeBetDataResults(betData);
    const matches = Array.isArray(matchesData.matches) ? matchesData.matches : matchesData;

    recalculateStandingsResults(normalized);
    renderParticipantsSummary(normalized.participants || [], normalized);
    renderMatchesSummary(normalized.results || {}, matches || []);
  } catch (error) {
    console.error('Error al cargar datos:', error);
    document.getElementById('participants-summary').textContent = 'No se pudieron cargar los datos.';
  }
});

function toNumberResults(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatPointsResults(value) {
  const number = toNumberResults(value, 0);
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(2).replace(/\.00$/, '').replace(/0$/, '');
}

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
            correct: toNumberResults(p.correct, 0),
            points: toNumberResults(p.points, 0)
          }))
          .filter((p) => p.name)
      : [],
    predictions: source.predictions && typeof source.predictions === 'object' ? source.predictions : {},
    results: source.results && typeof source.results === 'object' ? source.results : {},
    accumulatedPool: toNumberResults(source.accumulatedPool ?? source.accumulatedPot, 0),
    accumulatedPot: toNumberResults(source.accumulatedPot ?? source.accumulatedPool, 0),
    settings: source.settings && typeof source.settings === 'object' ? source.settings : {}
  };
}

function recalculateStandingsResults(data) {
  data.participants.forEach((participant) => {
    participant.correct = 0;
    participant.points = 0;
  });

  let runningAccumulated = 0;

  const resultKeys = Object.keys(data.results || {})
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key))
    .sort((a, b) => a - b);

  resultKeys.forEach((idx) => {
    const result = data.results[idx];
    if (!result) return;

    const basePool = toNumberResults(result.basePool, data.participants.length * POINTS_PER_PARTICIPANT_RESULTS);
    const previousAccumulated = runningAccumulated;
    const totalPool = previousAccumulated + basePool;
    const winners = [];

    data.participants.forEach((participant) => {
      const prediction = data.predictions[idx] ? data.predictions[idx][participant.name] : null;
      if (prediction && prediction.score1 === result.score1 && prediction.score2 === result.score2) {
        participant.correct += 1;
        winners.push(participant.name);
      }
    });

    let pointsPerWinner = 0;
    if (winners.length > 0) {
      pointsPerWinner = totalPool / winners.length;
      data.participants.forEach((participant) => {
        if (winners.includes(participant.name)) {
          participant.points += pointsPerWinner;
        }
      });
      runningAccumulated = 0;
    } else {
      runningAccumulated = totalPool;
    }

    result.participantCount = toNumberResults(result.participantCount, data.participants.length);
    result.pointsPerParticipant = POINTS_PER_PARTICIPANT_RESULTS;
    result.basePool = basePool;
    result.previousAccumulated = previousAccumulated;
    result.totalPool = totalPool;
    result.winners = winners;
    result.pointsPerWinner = pointsPerWinner;
    result.accumulatedAfter = runningAccumulated;
  });

  data.accumulatedPool = runningAccumulated;
  data.accumulatedPot = runningAccumulated;
}

function renderParticipantsSummary(participants, data) {
  const container = document.getElementById('participants-summary');
  container.innerHTML = '';

  const summary = document.createElement('div');
  summary.className = 'pool-summary';
  summary.innerHTML = `
    <strong>Regla:</strong> ${POINTS_PER_PARTICIPANT_RESULTS} puntos virtuales por participante en cada partido.<br>
    <strong>Acumulado actual:</strong> ${formatPointsResults(data.accumulatedPool || 0)} puntos.
  `;
  container.appendChild(summary);

  if (!participants || participants.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No hay participantes registrados.';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hdrRow = document.createElement('tr');

  ['Participante', 'Aciertos', 'Puntos ganados'].forEach((h) => {
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
      tdPoints.textContent = formatPointsResults(p.points);
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

  resArray.sort((a, b) => a.idx - b.idx);

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

    const baseInfo = document.createElement('p');
    baseInfo.textContent = `Bolsa base: ${formatPointsResults(result.basePool || 0)} puntos.`;

    const previousInfo = document.createElement('p');
    previousInfo.textContent = `Acumulado anterior: ${formatPointsResults(result.previousAccumulated || 0)} puntos.`;

    const totalInfo = document.createElement('p');
    totalInfo.textContent = `Bolsa total: ${formatPointsResults(result.totalPool || 0)} puntos.`;

    const winnersInfo = document.createElement('p');
    if (result.winners && result.winners.length > 0) {
      winnersInfo.textContent = `Acertaron (${result.winners.length}): ${result.winners.join(', ')}. Cada uno gana ${formatPointsResults(result.pointsPerWinner)} puntos.`;
    } else {
      winnersInfo.textContent = `Nadie acertó. Se acumulan ${formatPointsResults(result.accumulatedAfter || 0)} puntos.`;
    }

    card.appendChild(title);
    if (info.textContent) card.appendChild(info);
    card.appendChild(score);
    card.appendChild(baseInfo);
    card.appendChild(previousInfo);
    card.appendChild(totalInfo);
    card.appendChild(winnersInfo);
    container.appendChild(card);
  });
}
