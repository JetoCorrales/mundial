/*
 * Administración de quiniela/pronósticos del Mundial 2026.
 *
 * Lógica actual:
 *  - Cada participante suma 100 puntos virtuales a la bolsa de cada partido.
 *  - Si nadie acierta el marcador exacto, la bolsa se acumula para el siguiente partido.
 *  - Si una o varias personas aciertan, se reparte toda la bolsa acumulada entre ellas.
 *  - Cloudflare Worker es la fuente principal de datos.
 *  - localStorage solo se usa como respaldo/cache para no perder lo digitado.
 */

const APP_CONFIG = window.APP_CONFIG || {};
const API_ENDPOINT = APP_CONFIG.API_ENDPOINT || '';
const API_TOKEN = APP_CONFIG.API_TOKEN || '';
const POINTS_PER_PARTICIPANT = 150;

const DEFAULT_DATA = {
  participants: [],
  predictions: {},
  results: {},
  accumulatedPool: 0,
  accumulatedPot: 0,
  settings: {
    pointsPerParticipant: POINTS_PER_PARTICIPANT,
    pointsResetAfterResultIndex: null,
    pointsResetAt: null,
    manualPointsAfterResultIndex: null,
    manualPointsAt: null,
    manualPointsByParticipant: null
  }
};

let betData = { ...DEFAULT_DATA };
let matches = [];
let apiAvailable = false;

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

  const clearDataButton = document.getElementById('clear-data-button');
  if (clearDataButton) {
    clearDataButton.addEventListener('click', clearPlayerPoints);
  }

  const editPointsButton = document.getElementById('edit-points-button');
  if (editPointsButton) {
    editPointsButton.addEventListener('click', openManualPointsModal);
  }

  const closePointsModal = document.getElementById('close-points-modal');
  if (closePointsModal) {
    closePointsModal.addEventListener('click', closeManualPointsModal);
  }

  const saveManualPointsButton = document.getElementById('save-manual-points');
  if (saveManualPointsButton) {
    saveManualPointsButton.addEventListener('click', saveManualPoints);
  }

  const editPointsRuleButton = document.getElementById('edit-points-rule-button');
  if (editPointsRuleButton) {
    editPointsRuleButton.addEventListener('click', openPointsRuleModal);
  }

  const closePointsRuleModalButton = document.getElementById('close-points-rule-modal');
  if (closePointsRuleModalButton) {
    closePointsRuleModalButton.addEventListener('click', closePointsRuleModal);
  }

  const savePointsRuleButton = document.getElementById('save-points-rule');
  if (savePointsRuleButton) {
    savePointsRuleButton.addEventListener('click', savePointsRule);
  }

  document.addEventListener('click', (event) => {
    if (event.target && event.target.id === 'edit-points-rule-button') {
      openPointsRuleModal();
    }
  });

  await loadInitialBetData();
  await loadMatches();
});

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatPoints(value) {
  const number = toNumber(value, 0);
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(2).replace(/\.00$/, '').replace(/0$/, '');
}

function getPointsPerParticipant(data = betData) {
  const value = data && data.settings ? data.settings.pointsPerParticipant : null;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;

  const ruleKeys = Object.keys((data && data.results) || {})
    .map((key) => Number(key))
    .filter((key) => (
      Number.isInteger(key) &&
      data.results[key] &&
      Number.isFinite(Number(data.results[key].pointsPerParticipantOverride)) &&
      Number(data.results[key].pointsPerParticipantOverride) > 0
    ));

  if (ruleKeys.length) {
    const latestRule = data.results[Math.max(...ruleKeys)];
    return Number(latestRule.pointsPerParticipantOverride);
  }

  return POINTS_PER_PARTICIPANT;
}

function normalizeBetData(data) {
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
      pointsResetAfterResultIndex: null,
      pointsResetAt: null,
      manualPointsAfterResultIndex: null,
      manualPointsAt: null,
      manualPointsByParticipant: null,
      ...(source.settings && typeof source.settings === 'object' ? source.settings : {})
    }
  };
}

function getPointsResetAfterResultIndex(data = betData) {
  const value = data && data.settings ? data.settings.pointsResetAfterResultIndex : null;
  if (value !== null && value !== undefined && value !== '') {
    const number = Number(value);
    if (Number.isInteger(number)) return number;
  }

  const resetKeys = Object.keys((data && data.results) || {})
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key) && data.results[key] && data.results[key].pointsResetBoundary);

  return resetKeys.length ? Math.max(...resetKeys) : -1;
}

function getManualPointsAfterResultIndex(data = betData) {
  const value = data && data.settings ? data.settings.manualPointsAfterResultIndex : null;
  if (value !== null && value !== undefined && value !== '') {
    const number = Number(value);
    if (Number.isInteger(number)) return number;
  }

  const manualKeys = Object.keys((data && data.results) || {})
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key) && data.results[key] && data.results[key].manualPointsBoundary);

  return manualKeys.length ? Math.max(...manualKeys) : -1;
}

function hasManualPointsBaseline(data = betData) {
  return Boolean(
    data &&
    data.settings &&
    data.settings.manualPointsAt
  ) || Object.values((data && data.results) || {}).some((result) => result && result.manualPointsBoundary);
}

function getManualPointsByParticipant(data = betData) {
  const source = data && data.settings ? data.settings.manualPointsByParticipant : null;

  if (source && typeof source === 'object' && !Array.isArray(source)) {
    return new Map(
      Object.entries(source)
        .map(([name, points]) => [name, toNumber(points, 0)])
    );
  }

  const manualIndex = getManualPointsAfterResultIndex(data);
  const boundaryPoints = data &&
    data.results &&
    data.results[manualIndex] &&
    data.results[manualIndex].manualPointsByParticipant;

  if (boundaryPoints && typeof boundaryPoints === 'object' && !Array.isArray(boundaryPoints)) {
    return new Map(
      Object.entries(boundaryPoints)
        .map(([name, points]) => [name, toNumber(points, 0)])
    );
  }

  return new Map(
    (Array.isArray(data && data.participants) ? data.participants : [])
      .map((participant) => [participant.name, toNumber(participant.points, 0)])
  );
}

function pointsMapToObject(pointsMap) {
  return Array.from(pointsMap.entries()).reduce((acc, [name, points]) => {
    acc[name] = points;
    return acc;
  }, {});
}

function getLastClosedMatchIndex(data = betData) {
  const keys = Object.keys((data && data.results) || {})
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key));

  return keys.length ? Math.max(...keys) : -1;
}

function hasAwardedResult(data) {
  return Object.values((data && data.results) || {}).some((result) => (
    result &&
    Array.isArray(result.winners) &&
    result.winners.length > 0
  ));
}

function shouldInferPointsReset(data) {
  const participants = Array.isArray(data && data.participants) ? data.participants : [];

  return (
    getPointsResetAfterResultIndex(data) < 0 &&
    participants.length > 0 &&
    participants.every((participant) => toNumber(participant.points, 0) === 0) &&
    getLastClosedMatchIndex(data) >= 0 &&
    hasAwardedResult(data)
  );
}

function getResetTimestamp(data) {
  const value = data && data.settings ? data.settings.pointsResetAt : null;
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

function mergeLocalPointsResetSettings(remoteData, localData) {
  const remote = normalizeBetData(remoteData);
  const local = localData ? normalizeBetData(localData) : null;

  if (!local) return remote;

  const localResetIndex = getPointsResetAfterResultIndex(local);
  if (localResetIndex < 0) return remote;

  const remoteResetIndex = getPointsResetAfterResultIndex(remote);
  const localResetTime = getResetTimestamp(local);
  const remoteResetTime = getResetTimestamp(remote);

  if (remoteResetIndex < 0 || localResetTime > remoteResetTime) {
    remote.settings = {
      ...(remote.settings || {}),
      pointsResetAfterResultIndex: localResetIndex,
      pointsResetAt: local.settings.pointsResetAt || remote.settings.pointsResetAt || null
    };
  }

  return remote;
}

function inferMissingPointsResetSettings(data) {
  const normalized = normalizeBetData(data);

  if (shouldInferPointsReset(normalized)) {
    const resetIndex = getLastClosedMatchIndex(normalized);
    const resetAt = normalized.settings.pointsResetAt || new Date().toISOString();

    normalized.settings = {
      ...(normalized.settings || {}),
      pointsResetAfterResultIndex: resetIndex,
      pointsResetAt: resetAt
    };

    normalized.results[resetIndex] = {
      ...(normalized.results[resetIndex] || {}),
      pointsResetBoundary: true,
      pointsResetAt: resetAt
    };
  }

  return normalized;
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
  localStorage.setItem('betData', json);
}

async function postDataToCloudflare(dataToSave) {
  if (!API_ENDPOINT) {
    throw new Error('Falta configurar API_ENDPOINT en config.js.');
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(dataToSave),
    cache: 'no-store'
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(getFriendlyApiError(response.status, message));
  }

  return response.json().catch(() => ({ ok: true }));
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

      betData = inferMissingPointsResetSettings(
        mergeLocalPointsResetSettings(await response.json(), localBackupBeforeApi)
      );
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

  recalculateStandings();
  renderParticipants();
  renderMatches();
}

function getFriendlyApiError(status, responseText) {
  const text = String(responseText || '').trim();

  if (status === 401 || status === 403) {
    return 'Cloudflare rechazó el guardado por permisos/token. Revisa si tu Worker exige API_TOKEN.';
  }

  if (status === 404) {
    return 'No se encontró la ruta /api/betData en el Worker.';
  }

  if (status === 405) {
    return 'El Worker no permite método POST. Debes actualizar el código del Worker.';
  }

  if (status >= 500) {
    return `El Worker respondió error ${status}. ${text}`.trim();
  }

  return `Cloudflare respondió ${status}. ${text}`.trim();
}

async function persistBetData() {
  betData = normalizeBetData(betData);
  recalculateStandings();
  saveLocalBackup();

  if (!API_ENDPOINT) {
    showSyncStatus('Guardado solo en este navegador: falta configurar API_ENDPOINT en config.js.', 'warning');
    return false;
  }

  try {
    await postDataToCloudflare(betData);

    apiAvailable = true;
    showSyncStatus('Datos guardados correctamente en Cloudflare.', 'success');
    return true;
  } catch (error) {
    apiAvailable = false;
    console.error('No se pudo guardar en Cloudflare:', error);
    showSyncStatus(
      `Guardado solo en este navegador. No se pudo guardar en Cloudflare: ${error.message}`,
      'error'
    );
    return false;
  }
}

async function clearPlayerPoints() {
  const firstConfirm = confirm(
    '¿Seguro que deseas limpiar solo los puntos ganados de cada jugador? Se conservarán participantes, aciertos, pronósticos, resultados y acumulado.'
  );

  if (!firstConfirm) return;

  const secondConfirm = confirm(
    'Confirmación final: los puntos ganados quedarán en cero, pero los demás datos no se eliminarán.'
  );

  if (!secondConfirm) return;

  const button = document.getElementById('clear-data-button');

  if (button) {
    button.disabled = true;
    button.textContent = 'Limpiando puntos...';
  }

  try {
    betData = normalizeBetData(betData);
    betData.settings = {
      ...(betData.settings || {}),
      pointsPerParticipant: getPointsPerParticipant(betData),
      pointsResetAfterResultIndex: getLastClosedMatchIndex(betData),
      pointsResetAt: new Date().toISOString(),
      manualPointsAfterResultIndex: null,
      manualPointsAt: null,
      manualPointsByParticipant: null
    };

    if (betData.settings.pointsResetAfterResultIndex >= 0) {
      betData.results[betData.settings.pointsResetAfterResultIndex] = {
        ...(betData.results[betData.settings.pointsResetAfterResultIndex] || {}),
        pointsResetBoundary: true,
        pointsResetAt: betData.settings.pointsResetAt
      };
    }

    recalculateStandings();
    renderParticipants();
    renderMatches();

    const cloudSaved = await persistBetData();
    alert(cloudSaved
      ? 'Puntos ganados reiniciados correctamente en Cloudflare.'
      : 'Puntos ganados reiniciados solo en este navegador. Revisa Cloudflare para sincronizarlos.');
  } catch (error) {
    apiAvailable = false;
    console.error('No se pudieron limpiar los puntos ganados:', error);
    showSyncStatus(`No se pudieron limpiar los puntos ganados: ${error.message}`, 'error');
    alert(`No se limpiaron los puntos ganados: ${error.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Limpiar puntos ganados';
    }
  }
}

function openPointsRuleModal() {
  const modal = document.getElementById('points-rule-modal');
  const input = document.getElementById('points-per-participant-input');
  if (!modal || !input) return;

  input.value = formatPoints(getPointsPerParticipant(betData));
  modal.classList.remove('hidden');
  input.focus();
}

function closePointsRuleModal() {
  const modal = document.getElementById('points-rule-modal');
  if (modal) modal.classList.add('hidden');
}

async function savePointsRule() {
  const input = document.getElementById('points-per-participant-input');
  const button = document.getElementById('save-points-rule');
  if (!input) return;

  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) {
    alert('Introduce un valor mayor a cero para los puntos por participante.');
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Guardando...';
  }

  try {
    betData = normalizeBetData(betData);
    const ruleIndex = getLastClosedMatchIndex(betData);
    const ruleAt = new Date().toISOString();

    betData.settings = {
      ...(betData.settings || {}),
      pointsPerParticipant: value,
      pointsPerParticipantUpdatedAt: ruleAt
    };

    if (ruleIndex >= 0) {
      betData.results[ruleIndex] = {
        ...(betData.results[ruleIndex] || {}),
        pointsRuleBoundary: true,
        pointsRuleAt: ruleAt,
        pointsPerParticipantOverride: value
      };
    }

    recalculateStandings();
    renderParticipants();
    renderMatches();
    closePointsRuleModal();

    const cloudSaved = await persistBetData();
    alert(cloudSaved
      ? 'Regla de puntos actualizada correctamente en Cloudflare.'
      : 'Regla de puntos actualizada solo en este navegador. Revisa Cloudflare para sincronizarla.');
  } catch (error) {
    console.error('No se pudo actualizar la regla de puntos:', error);
    showSyncStatus(`No se pudo actualizar la regla de puntos: ${error.message}`, 'error');
    alert(`No se pudo actualizar la regla de puntos: ${error.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Guardar regla';
    }
  }
}

function openManualPointsModal() {
  if (!betData.participants.length) {
    alert('No hay participantes para editar.');
    return;
  }

  recalculateStandings();

  const modal = document.getElementById('points-modal');
  const form = document.getElementById('manual-points-form');
  if (!modal || !form) return;

  form.innerHTML = '';

  betData.participants
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .forEach((participant) => {
      const label = document.createElement('label');
      label.className = 'manual-points-row';

      const name = document.createElement('span');
      name.textContent = participant.name;

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '0.01';
      input.dataset.participant = participant.name;
      input.value = formatPoints(participant.points || 0);

      label.appendChild(name);
      label.appendChild(input);
      form.appendChild(label);
    });

  modal.classList.remove('hidden');
}

function closeManualPointsModal() {
  const modal = document.getElementById('points-modal');
  if (modal) modal.classList.add('hidden');
}

async function saveManualPoints() {
  const form = document.getElementById('manual-points-form');
  const button = document.getElementById('save-manual-points');
  if (!form) return;

  const inputs = form.querySelectorAll('input[data-participant]');
  const pointsByParticipant = new Map();

  for (const input of inputs) {
    const value = input.value === '' ? 0 : Number(input.value);
    if (!Number.isFinite(value) || value < 0) {
      alert('Introduce puntos válidos para todos los participantes.');
      return;
    }
    pointsByParticipant.set(input.dataset.participant, value);
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Guardando...';
  }

  try {
    betData = normalizeBetData(betData);
    betData.participants.forEach((participant) => {
      if (pointsByParticipant.has(participant.name)) {
        participant.points = pointsByParticipant.get(participant.name);
      }
    });

    const manualIndex = getLastClosedMatchIndex(betData);
    const manualAt = new Date().toISOString();
    const manualPointsByParticipant = pointsMapToObject(pointsByParticipant);

    betData.settings = {
      ...(betData.settings || {}),
      pointsPerParticipant: getPointsPerParticipant(betData),
      manualPointsAfterResultIndex: manualIndex,
      manualPointsAt: manualAt,
      manualPointsByParticipant
    };

    if (manualIndex >= 0) {
      betData.results[manualIndex] = {
        ...(betData.results[manualIndex] || {}),
        manualPointsBoundary: true,
        manualPointsAt: manualAt,
        manualPointsByParticipant
      };
    }

    recalculateStandings();
    renderParticipants();
    renderMatches();
    closeManualPointsModal();

    const cloudSaved = await persistBetData();
    alert(cloudSaved
      ? 'Puntos actualizados correctamente en Cloudflare.'
      : 'Puntos actualizados solo en este navegador. Revisa Cloudflare para sincronizarlos.');
  } catch (error) {
    console.error('No se pudieron actualizar los puntos manuales:', error);
    showSyncStatus(`No se pudieron actualizar los puntos manuales: ${error.message}`, 'error');
    alert(`No se pudieron actualizar los puntos manuales: ${error.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Guardar puntos';
    }
  }
}

async function addParticipant(name) {
  const exists = betData.participants.some((p) => p.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    alert('El participante ya existe.');
    return;
  }

  betData.participants.push({ name, correct: 0, points: 0 });
  recalculateStandings();
  renderParticipants();
  renderMatches();

  const cloudSaved = await persistBetData();
  if (!cloudSaved) {
    alert('El participante quedó guardado solo en este navegador. Para que aparezca en otros dispositivos, revisa Cloudflare.');
  }
}

function renderParticipants() {
  const container = document.getElementById('participants-list');
  container.innerHTML = '';
  const pointsPerParticipant = getPointsPerParticipant(betData);

  const summary = document.createElement('div');
  summary.className = 'pool-summary';
  summary.innerHTML = `
    <strong>Regla:</strong> ${formatPoints(pointsPerParticipant)} puntos virtuales por participante en cada partido.<br>
    <strong>Bolsa base del próximo partido:</strong> ${formatPoints(betData.participants.length * pointsPerParticipant)} puntos.<br>
    <strong>Acumulado actual:</strong> ${formatPoints(betData.accumulatedPool || 0)} puntos.
  `;
  container.appendChild(summary);

  if (!betData.participants.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No hay participantes registrados.';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');

  ['Participante', 'Aciertos', 'Puntos ganados'].forEach((header) => {
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
      pointsTd.textContent = formatPoints(p.points);
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
  const pointsPerParticipant = getPointsPerParticipant(betData);
  let pendingMatches = 0;

  matches.forEach((match, idx) => {
    if (betData.results[idx]) return;

    pendingMatches += 1;
    const card = document.createElement('div');
    card.className = 'match-card';

    const teams = document.createElement('div');
    teams.className = 'teams';
    teams.textContent = `${match.team1} vs. ${match.team2}`;

    const datetime = document.createElement('div');
    datetime.className = 'date-time';
    datetime.textContent = `${match.date}${match.time ? ' ' + match.time : ''}`;

    const pool = document.createElement('div');
    pool.className = 'match-pool';
    if (betData.results[idx]) {
      pool.textContent = `Bolsa: ${formatPoints(betData.results[idx].totalPool || 0)} pts`;
    } else {
      const expectedPool = (betData.accumulatedPool || 0) + betData.participants.length * pointsPerParticipant;
      pool.textContent = `Bolsa si se cierra ahora: ${formatPoints(expectedPool)} pts`;
    }

    const left = document.createElement('div');
    left.appendChild(teams);
    left.appendChild(datetime);

    card.appendChild(left);
    card.appendChild(pool);
    card.addEventListener('click', () => openMatchModal(match, idx));
    list.appendChild(card);
  });

  if (!pendingMatches) {
    const empty = document.createElement('p');
    empty.textContent = 'No hay próximos partidos pendientes.';
    list.appendChild(empty);
  }
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
    collectPredictions(idx, form);
    const cloudSaved = await persistBetData();
    alert(cloudSaved
      ? 'Pronósticos guardados correctamente en Cloudflare.'
      : 'Pronósticos guardados solo en este navegador. Revisa Cloudflare para sincronizarlos.');
  };

  document.getElementById('save-result').onclick = async () => {
    collectPredictions(idx, form);
    await saveResult(idx, resTeam1.value, resTeam2.value);
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
  const pointsPerParticipant = getPointsPerParticipant(betData);

  if (Number.isNaN(score1) || Number.isNaN(score2)) {
    alert('Introduce un marcador válido para ambos equipos.');
    return;
  }

  const existing = betData.results[idx] || {};

  betData.results[idx] = {
    ...existing,
    score1,
    score2,
    // Se congela la bolsa base al momento de cerrar el partido.
    // Así, si luego agregas más participantes, no cambia la bolsa histórica.
    participantCount: existing.participantCount || betData.participants.length,
    pointsPerParticipant: existing.pointsPerParticipant || pointsPerParticipant,
    basePool: existing.basePool || betData.participants.length * pointsPerParticipant
  };

  recalculateStandings();
  renderParticipants();
  renderMatches();
  showResultSummary(idx);

  const cloudSaved = await persistBetData();
  alert(cloudSaved
    ? 'Resultado guardado correctamente en Cloudflare.'
    : 'Resultado guardado solo en este navegador. Revisa Cloudflare para sincronizarlo.');
}

function recalculateStandings() {
  if (shouldInferPointsReset(betData)) {
    const resetIndex = getLastClosedMatchIndex(betData);
    const resetAt = betData.settings.pointsResetAt || new Date().toISOString();

    betData.settings = {
      ...(betData.settings || {}),
      pointsResetAfterResultIndex: resetIndex,
      pointsResetAt: resetAt
    };

    betData.results[resetIndex] = {
      ...(betData.results[resetIndex] || {}),
      pointsResetBoundary: true,
      pointsResetAt: resetAt
    };
  }

  const manualPointsByParticipant = getManualPointsByParticipant(betData);
  const currentPointsPerParticipant = getPointsPerParticipant(betData);
  const pointsResetAfterResultIndex = getPointsResetAfterResultIndex(betData);
  const manualPointsAfterResultIndex = getManualPointsAfterResultIndex(betData);
  const useManualPointsBaseline = (
    hasManualPointsBaseline(betData) &&
    manualPointsAfterResultIndex >= pointsResetAfterResultIndex
  );
  const pointsStartAfterResultIndex = useManualPointsBaseline
    ? manualPointsAfterResultIndex
    : pointsResetAfterResultIndex;

  betData.participants.forEach((participant) => {
    participant.correct = 0;
    participant.points = useManualPointsBaseline
      ? (manualPointsByParticipant.get(participant.name) || 0)
      : 0;
  });

  let runningAccumulated = 0;

  const resultKeys = Object.keys(betData.results || {})
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key))
    .sort((a, b) => a - b);

  resultKeys.forEach((idx) => {
    const result = betData.results[idx];
    if (!result) return;

    const resultPointsPerParticipant = toNumber(
      result.pointsPerParticipant,
      currentPointsPerParticipant
    );
    const basePool = toNumber(result.basePool, betData.participants.length * resultPointsPerParticipant);
    const previousAccumulated = runningAccumulated;
    const totalPool = previousAccumulated + basePool;

    const winners = [];
    betData.participants.forEach((participant) => {
      const prediction = betData.predictions[idx] ? betData.predictions[idx][participant.name] : null;
      if (prediction && prediction.score1 === result.score1 && prediction.score2 === result.score2) {
        participant.correct += 1;
        winners.push(participant.name);
      }
    });

    let pointsPerWinner = 0;
    if (winners.length > 0) {
      pointsPerWinner = totalPool / winners.length;
      betData.participants.forEach((participant) => {
        if (idx > pointsStartAfterResultIndex && winners.includes(participant.name)) {
          participant.points += pointsPerWinner;
        }
      });
      runningAccumulated = 0;
    } else {
      runningAccumulated = totalPool;
    }

    result.participantCount = toNumber(result.participantCount, betData.participants.length);
    result.pointsPerParticipant = resultPointsPerParticipant;
    result.basePool = basePool;
    result.previousAccumulated = previousAccumulated;
    result.totalPool = totalPool;
    result.winners = winners;
    result.pointsPerWinner = pointsPerWinner;
    result.accumulatedAfter = runningAccumulated;

    // Campos viejos: se eliminan para evitar confusión.
    delete result.pot;
    delete result.share;
  });

  betData.accumulatedPool = runningAccumulated;
  betData.accumulatedPot = runningAccumulated; // compatibilidad con versiones anteriores
  betData.settings = {
    ...(betData.settings || {}),
    pointsPerParticipant: currentPointsPerParticipant,
    pointsResetAfterResultIndex: betData.settings && betData.settings.pointsResetAfterResultIndex !== undefined
      ? betData.settings.pointsResetAfterResultIndex
      : null,
    pointsResetAt: betData.settings && betData.settings.pointsResetAt !== undefined
      ? betData.settings.pointsResetAt
      : null,
    manualPointsAfterResultIndex: betData.settings && betData.settings.manualPointsAfterResultIndex !== undefined
      ? betData.settings.manualPointsAfterResultIndex
      : null,
    manualPointsAt: betData.settings && betData.settings.manualPointsAt !== undefined
      ? betData.settings.manualPointsAt
      : null,
    manualPointsByParticipant: betData.settings && betData.settings.manualPointsByParticipant !== undefined
      ? betData.settings.manualPointsByParticipant
      : null
  };
}

function showResultSummary(idx) {
  const summaryDiv = document.getElementById('result-summary');
  summaryDiv.innerHTML = '';

  const result = betData.results[idx];
  if (!result) return;
  const pointsPerParticipant = toNumber(result.pointsPerParticipant, getPointsPerParticipant(betData));

  const p1 = document.createElement('p');
  p1.textContent = `Marcador final: ${result.score1} - ${result.score2}`;

  const p2 = document.createElement('p');
  p2.textContent = `Bolsa base del partido: ${formatPoints(result.basePool || 0)} puntos (${result.participantCount || betData.participants.length} participantes × ${formatPoints(pointsPerParticipant)}).`;

  const p3 = document.createElement('p');
  p3.textContent = `Acumulado anterior: ${formatPoints(result.previousAccumulated || 0)} puntos.`;

  const p4 = document.createElement('p');
  p4.textContent = `Bolsa total del partido: ${formatPoints(result.totalPool || 0)} puntos.`;

  summaryDiv.appendChild(p1);
  summaryDiv.appendChild(p2);
  summaryDiv.appendChild(p3);
  summaryDiv.appendChild(p4);

  const p5 = document.createElement('p');
  if (result.winners && result.winners.length > 0) {
    p5.textContent = `Acertaron (${result.winners.length}): ${result.winners.join(', ')}. Cada uno gana ${formatPoints(result.pointsPerWinner)} puntos.`;
  } else {
    p5.textContent = `Nadie acertó el marcador exacto. Se acumulan ${formatPoints(result.accumulatedAfter || 0)} puntos para el siguiente partido.`;
  }
  summaryDiv.appendChild(p5);

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
