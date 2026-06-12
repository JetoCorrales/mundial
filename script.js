/*
 * Administración de quiniela/pronósticos del Mundial 2026.
 *
 * Cambios principales:
 *  - Cloudflare Worker es la fuente principal de datos.
 *  - localStorage solo se usa como respaldo/cache, no para sobrescribir la API.
 *  - Se eliminan cálculos de dinero y se usa un sistema de puntos.
 */

const APP_CONFIG = window.APP_CONFIG || {};
const API_ENDPOINT = APP_CONFIG.API_ENDPOINT || '';
const API_TOKEN = APP_CONFIG.API_TOKEN || '';
const POINTS_EXACT_SCORE = 3;

const DEFAULT_DATA = {
  participants: [],
  predictions: {},
  results: {},
  accumulatedPot: 0 // campo heredado; ya no se usa para dinero
};

let betData = { ...DEFAULT_DATA };
let matches = [];
let apiAvailable = false;

// Cargar datos iniciales al arrancar la página
window.addEventListener('DOMContentLoaded', async () => {
  const addForm = document.getElementById('add-participant-form');
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('participant-name');
    const name = input.value.trim();
    if (name) {
      await addParticipant(name);
      input.value = '';
    }
  });

  await loadInitialBetData();
  await loadMatches();
});

function normalizeBetData(data) {
  const source = data && typeof data === 'object' ? data : {};

  const participants = Array.isArray(source.participants)
    ? source.participants
        .map((p) => ({
          name: String(p.name || '').trim(),
          correct: Number.isFinite(Number(p.correct)) ? Number(p.correct) : 0,
          points: Number.isFinite(Number(p.points))
            ? Number(p.points)
            : (Number.isFinite(Number(p.correct)) ? Number(p.correct) * POINTS_EXACT_SCORE : 0)
        }))
        .filter((p) => p.name)
    : [];

  return {
    participants,
    predictions: source.predictions && typeof source.predictions === 'object' ? source.predictions : {},
    results: source.results && typeof source.results === 'object' ? source.results : {},
    accumulatedPot: 0
  };
}

function hasUsefulData(data) {
  return Boolean(
    data &&
      ((Array.isArray(data.participants) && data.participants.length > 0) ||
        (data.predictions && Object.keys(data.predictions).length > 0) ||
        (data.results && Object.keys(data.results).length > 0))
  );
}

function readLocalBackup() {
  const keys = ['betData_api_cache', 'betData'];
  for (const key of keys) {
    const stored = localStorage.getItem(key);
    if (!stored) continue;
    try {
      const parsed = normalizeBetData(JSON.parse(stored));
      if (hasUsefulData(parsed)) return parsed;
    } catch (error) {
      console.warn(`No se pudo leer ${key}:`, error);
    }
  }
  return null;
}

function saveLocalBackup() {
  const json = JSON.stringify(betData);
  localStorage.setItem('betData_api_cache', json);
  // Se conserva la llave antigua para facilitar migración desde versiones previas.
  localStorage.setItem('betData', json);
}

async function loadInitialBetData() {
  showSyncStatus('Conectando con Cloudflare...', 'info');
  const localBackupBeforeApi = readLocalBackup();

  if (API_ENDPOINT) {
    try {
      const response = await fetch(`${API_ENDPOINT}?_=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`La API respondió ${response.status}`);
      }

      betData = normalizeBetData(await response.json());
      recalculateStandings();
      apiAvailable = true;
      showSyncStatus('Datos cargados desde Cloudflare.', 'success');

      if (!hasUsefulData(betData) && hasUsefulData(localBackupBeforeApi)) {
        showSyncStatus(
          'Cloudflare está vacío, pero este navegador tiene datos locales anteriores.',
          'warning',
          {
            label: 'Subir datos locales a Cloudflare',
            handler: async () => {
              betData = normalizeBetData(localBackupBeforeApi);
              recalculateStandings();
              await persistBetData();
              renderParticipants();
              renderMatches();
            }
          }
        );
      }
      if (hasUsefulData(betData)) {
        saveLocalBackup();
      }
      return;
    } catch (error) {
      apiAvailable = false;
      console.warn('No se pudo cargar desde Cloudflare:', error);
      showSyncStatus('No se pudo cargar desde Cloudflare. Se usará respaldo local si existe.', 'warning');
    }
  }

  const localBackup = readLocalBackup();
  if (localBackup) {
    betData = normalizeBetData(localBackup);
    recalculateStandings();
    showSyncStatus('Datos cargados desde respaldo local.', 'warning');
    return;
  }

  try {
    const response = await fetch('bet_data.json', { cache: 'no-store' });
    betData = normalizeBetData(await response.json());
    recalculateStandings();
    saveLocalBackup();
    showSyncStatus('Datos iniciales cargados desde bet_data.json.', 'info');
  } catch (error) {
    console.warn('No se pudo cargar bet_data.json:', error);
    betData = normalizeBetData(DEFAULT_DATA);
    saveLocalBackup();
  }
}

async function loadMatches() {
  try {
    const response = await fetch('matches.json', { cache: 'no-store' });
    const data = await response.json();
    matches = Array.isArray(data.matches) ? data.matches : [];
  } catch (error) {
    console.warn('No se pudo cargar matches.json. Se usará MATCHES_DATA como respaldo:', error);
    matches = Array.isArray(window.MATCHES_DATA) ? window.MATCHES_DATA : [];
  }

  matches.sort((a, b) => {
    const dateA = new Date(`${a.date}T${a.time ? a.time.split(' ')[0] : '00:00'}`);
    const dateB = new Date(`${b.date}T${b.time ? b.time.split(' ')[0] : '00:00'}`);
    return dateA - dateB;
  });

  renderParticipants();
  renderMatches();
}

async function persistBetData() {
  betData = normalizeBetData(betData);
  recalculateStandings();
  saveLocalBackup();

  if (!API_ENDPOINT) {
    showSyncStatus('Guardado solo en respaldo local porque no hay API configurada.', 'warning');
    return true;
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(betData),
      cache: 'no-store'
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(`La API respondió ${response.status}. ${message}`.trim());
    }

    apiAvailable = true;
    showSyncStatus('Datos guardados correctamente en Cloudflare.', 'success');
    return true;
  } catch (error) {
    apiAvailable = false;
    console.error('No se pudo guardar en Cloudflare:', error);
    showSyncStatus('No se pudo guardar en Cloudflare. Revisa CORS, método POST o token del Worker.', 'error');
    throw error;
  }
}

async function addParticipant(name) {
  const exists = betData.participants.some((p) => p.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    alert('El participante ya existe.');
    return;
  }

  betData.participants.push({ name, correct: 0, points: 0 });

  try {
    await persistBetData();
    renderParticipants();
    renderMatches();
  } catch (error) {
    alert(`No se pudo guardar el participante en Cloudflare. Detalle: ${error.message}`);
  }
}

function renderParticipants() {
  const container = document.getElementById('participants-list');
  container.innerHTML = '';

  if (!betData.participants.length) {
    container.textContent = 'No hay participantes registrados.';
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');

  ['Participante', 'Aciertos', 'Puntos'].forEach((header) => {
    const th = document.createElement('th');
    th.textContent = header;
    trh.appendChild(th);
  });

  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  betData.participants
    .slice()
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return b.correct - a.correct;
    })
    .forEach((p) => {
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      nameTd.textContent = p.name;
      const correctTd = document.createElement('td');
      correctTd.textContent = p.correct;
      const pointsTd = document.createElement('td');
      pointsTd.textContent = p.points;
      tr.appendChild(nameTd);
      tr.appendChild(correctTd);
      tr.appendChild(pointsTd);
      tbody.appendChild(tr);
    });

  table.appendChild(tbody);
  container.appendChild(table);
}

function renderMatches() {
  const list = document.getElementById('matches-list');
  list.innerHTML = '';

  matches.forEach((match, idx) => {
    const card = document.createElement('div');
    card.className = 'match-card';

    if (betData.results[idx]) {
      card.classList.add('past');
    }

    const teams = document.createElement('div');
    teams.className = 'teams';
    teams.textContent = `${match.team1} vs. ${match.team2}`;

    const datetime = document.createElement('div');
    datetime.className = 'date-time';
    datetime.textContent = `${match.date}${match.time ? ' ' + match.time : ''}`;

    card.appendChild(teams);
    card.appendChild(datetime);
    card.addEventListener('click', () => openMatchModal(match, idx));
    list.appendChild(card);
  });
}

function openMatchModal(match, idx) {
  const modal = document.getElementById('match-modal');
  modal.classList.remove('hidden');

  document.getElementById('modal-match-title').textContent = `${match.team1} vs. ${match.team2} – ${match.date}${match.time ? ' ' + match.time : ''}`;

  const form = document.getElementById('predictions-form');
  form.innerHTML = '';

  betData.participants.forEach((p) => {
    const label = document.createElement('label');
    label.dataset.participant = p.name;
    label.textContent = p.name;

    const input1 = document.createElement('input');
    input1.type = 'number';
    input1.min = '0';
    input1.placeholder = match.team1;

    const input2 = document.createElement('input');
    input2.type = 'number';
    input2.min = '0';
    input2.placeholder = match.team2;

    if (betData.predictions[idx] && betData.predictions[idx][p.name]) {
      const pred = betData.predictions[idx][p.name];
      input1.value = pred.score1;
      input2.value = pred.score2;
    }

    const inputContainer = document.createElement('div');
    inputContainer.style.display = 'flex';
    inputContainer.style.gap = '0.25rem';
    inputContainer.appendChild(input1);
    inputContainer.appendChild(input2);

    label.appendChild(inputContainer);
    form.appendChild(label);
  });

  document.getElementById('predictions-form-container').style.display = '';
  document.getElementById('result-form-container').style.display = '';
  document.getElementById('result-summary').classList.add('hidden');

  document.getElementById('team1-label').textContent = match.team1;
  document.getElementById('team2-label').textContent = match.team2;

  const resTeam1 = document.getElementById('result-team1');
  const resTeam2 = document.getElementById('result-team2');

  if (betData.results[idx]) {
    resTeam1.value = betData.results[idx].score1;
    resTeam2.value = betData.results[idx].score2;
    showResultSummary(idx);
  } else {
    resTeam1.value = '';
    resTeam2.value = '';
  }

  document.getElementById('save-predictions').onclick = async () => {
    try {
      collectPredictions(idx, form);
      await persistBetData();
      alert('Pronósticos guardados correctamente en Cloudflare.');
    } catch (error) {
      alert(`No se pudieron guardar los pronósticos. Detalle: ${error.message}`);
    }
  };

  document.getElementById('save-result').onclick = async () => {
    try {
      collectPredictions(idx, form);
      await saveResult(idx, resTeam1.value, resTeam2.value);
    } catch (error) {
      alert(`No se pudo guardar el resultado. Detalle: ${error.message}`);
    }
  };

  document.getElementById('close-modal').onclick = () => {
    modal.classList.add('hidden');
  };
}

function collectPredictions(idx, form) {
  betData.predictions[idx] = betData.predictions[idx] || {};

  const labels = form.querySelectorAll('label');
  labels.forEach((label) => {
    const name = label.dataset.participant;
    const [input1, input2] = label.querySelectorAll('input');
    const score1 = input1.value !== '' ? parseInt(input1.value, 10) : null;
    const score2 = input2.value !== '' ? parseInt(input2.value, 10) : null;

    if (score1 !== null && score2 !== null && !Number.isNaN(score1) && !Number.isNaN(score2)) {
      betData.predictions[idx][name] = { score1, score2 };
    } else if (betData.predictions[idx][name]) {
      delete betData.predictions[idx][name];
    }
  });
}

async function saveResult(idx, s1, s2) {
  const score1 = parseInt(s1, 10);
  const score2 = parseInt(s2, 10);

  if (Number.isNaN(score1) || Number.isNaN(score2)) {
    alert('Introduce un marcador válido para ambos equipos.');
    return;
  }

  betData.results[idx] = {
    score1,
    score2,
    winners: [],
    pointsPerWinner: POINTS_EXACT_SCORE
  };

  recalculateStandings();
  await persistBetData();
  renderParticipants();
  renderMatches();
  showResultSummary(idx);
}

function recalculateStandings() {
  betData.participants.forEach((participant) => {
    participant.correct = 0;
    participant.points = 0;
  });

  Object.keys(betData.results || {}).forEach((idx) => {
    const result = betData.results[idx];
    if (!result) return;

    const winners = [];
    betData.participants.forEach((participant) => {
      const prediction = betData.predictions[idx] ? betData.predictions[idx][participant.name] : null;
      if (prediction && prediction.score1 === result.score1 && prediction.score2 === result.score2) {
        participant.correct += 1;
        participant.points += POINTS_EXACT_SCORE;
        winners.push(participant.name);
      }
    });

    result.winners = winners;
    result.pointsPerWinner = POINTS_EXACT_SCORE;
    delete result.pot;
    delete result.share;
  });
}

function showResultSummary(idx) {
  const summaryDiv = document.getElementById('result-summary');
  summaryDiv.innerHTML = '';

  const result = betData.results[idx];
  if (!result) return;

  const p1 = document.createElement('p');
  p1.textContent = `Marcador final: ${result.score1} - ${result.score2}`;

  const p2 = document.createElement('p');
  p2.textContent = `Puntos por marcador exacto: ${POINTS_EXACT_SCORE}`;

  summaryDiv.appendChild(p1);
  summaryDiv.appendChild(p2);

  const p3 = document.createElement('p');
  if (result.winners && result.winners.length > 0) {
    p3.textContent = `Acertaron (${result.winners.length}): ${result.winners.join(', ')}`;
  } else {
    p3.textContent = 'Nadie acertó el marcador exacto.';
  }
  summaryDiv.appendChild(p3);

  summaryDiv.classList.remove('hidden');
}

function showSyncStatus(message, type = 'info', action = null) {
  let status = document.getElementById('sync-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'sync-status';
    status.className = 'sync-status';
    const header = document.querySelector('header');
    header.insertAdjacentElement('afterend', status);
  }

  status.className = `sync-status ${type}`;
  status.innerHTML = '';

  const text = document.createElement('span');
  text.textContent = message;
  status.appendChild(text);

  if (action && action.label && typeof action.handler === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await action.handler();
      } catch (error) {
        console.error(error);
        alert(`No se pudieron subir los datos locales. Detalle: ${error.message}`);
      } finally {
        button.disabled = false;
      }
    });
    status.appendChild(button);
  }
}
