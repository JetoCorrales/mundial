/*
 * Script principal para el sitio de apuestas del Mundial 2026.
 *
 * Funcionalidades:
 *  - Cargar calendario de partidos desde matches.json.
 *  - Gestionar participantes (altas y visualización).
 *  - Registrar apuestas por participante para cada partido.
 *  - Permitir introducir el resultado real de cada partido y calcular ganadores.
 *  - Llevar el control de aciertos y ganancias de cada participante.
 *  - Persistir la información en localStorage para mantener el estado entre sesiones.
 */

// Configuración de API (reemplazar con tu Worker y token). Si no usas API, deja las cadenas vacías.
const API_ENDPOINT = 'https://workermundilista.jeison-corrales-garcia.workers.dev/api/betData'; // e.g. 'https://tu-worker.workers.dev/api/betData'
const API_TOKEN = 'Mundial2026CalleEmma'; // e.g. 'mi_token_secreto'

// Almacenamiento de datos de apuestas
let betData = {
  participants: [],
  predictions: {},
  results: {},
  accumulatedPot: 0
};

let matches = [];

// Cargar datos iniciales al arrancar la página
document.addEventListener('DOMContentLoaded', () => {
  // Configurar eventos del formulario de participantes (siempre)
  const addForm = document.getElementById('add-participant-form');
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('participant-name');
    const name = input.value.trim();
    if (name) {
      addParticipant(name);
      input.value = '';
    }
  });

  // Paso 1: intentar cargar los datos de apuestas desde la API si está configurada
  const loadFromApi = () => {
    if (API_ENDPOINT) {
      return fetch(API_ENDPOINT, { cache: 'no-store' })
        .then((resp) => {
          if (resp.ok) return resp.json();
          throw new Error('Respuesta no OK');
        })
        .then((data) => {
          if (data && Object.keys(data).length > 0) {
            betData = data;
            // Guardar en localStorage para disponer offline
            localStorage.setItem('betData', JSON.stringify(betData));
          }
        })
        .catch((err) => {
          console.warn('No se pudo obtener datos desde la API:', err);
        });
    }
    return Promise.resolve();
  };

  // Paso 2: cargar desde localStorage o bet_data.json según corresponda
  const loadFromStorageOrFile = () => {
    const stored = localStorage.getItem('betData');
    if (stored) {
      try {
        betData = JSON.parse(stored);
      } catch (e) {
        console.error('Error al parsear betData de localStorage', e);
      }
      return Promise.resolve();
    }
    // Si no hay datos en localStorage, cargar valores iniciales desde bet_data.json
    return fetch('bet_data.json')
      .then((resp) => resp.json())
      .then((data) => {
        betData = data;
        persistBetData();
      })
      .catch((err) => {
        console.error('Error cargando bet_data.json', err);
        // si falla, inicializar con estructura vacía
        betData = { participants: [], predictions: {}, results: {}, accumulatedPot: 0 };
        persistBetData();
      });
  };

  // Ejecutar las cargas de forma secuencial: primero API, luego local
  loadFromApi().finally(() => {
    loadFromStorageOrFile().finally(() => {
      // Cargar calendario de partidos una vez que betData está listo
      loadMatches();
    });
  });
});

/**
 * Carga el calendario de partidos desde matches.json y actualiza la UI.
 */
function loadMatches() {
  fetch('matches.json')
    .then((resp) => resp.json())
    .then((data) => {
      matches = data.matches || [];
      // Ordenar los partidos por fecha y hora
      matches.sort((a, b) => {
        const dateA = new Date(a.date + 'T' + (a.time ? a.time.split(' ')[0] : '00:00'));
        const dateB = new Date(b.date + 'T' + (b.time ? b.time.split(' ')[0] : '00:00'));
        return dateA - dateB;
      });
      // Actualizar la UI
      renderParticipants();
      renderMatches();
    })
    .catch((err) => {
      console.error('Error cargando matches.json', err);
      // Si falla la carga de matches.json (por ejemplo en modo file://), utilizar la
      // constante MATCHES_DATA definida en matches_data.js como respaldo.
      if (Array.isArray(window.MATCHES_DATA)) {
        matches = window.MATCHES_DATA;
        matches.sort((a, b) => {
          const dateA = new Date(a.date + 'T' + (a.time ? a.time.split(' ')[0] : '00:00'));
          const dateB = new Date(b.date + 'T' + (b.time ? b.time.split(' ')[0] : '00:00'));
          return dateA - dateB;
        });
        renderParticipants();
        renderMatches();
      }
    });
}

/**
 * Guarda la estructura betData en localStorage.
 */
function persistBetData() {
  // Guardar en localStorage
  localStorage.setItem('betData', JSON.stringify(betData));
  // Si el API está configurado y el token definido, enviar los datos al backend
  if (API_ENDPOINT && API_TOKEN) {
    // No esperamos la respuesta; en caso de error se mostrará en consola
    fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`
      },
      body: JSON.stringify(betData)
    }).catch((err) => {
      console.warn('No se pudo guardar betData en la API:', err);
    });
  }
}

/**
 * Agrega un nuevo participante.
 * @param {string} name Nombre del participante
 */
function addParticipant(name) {
  // Evitar duplicados por nombre (insensitivo a mayúsculas)
  const exists = betData.participants.some((p) => p.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    alert('El participante ya existe.');
    return;
  }
  betData.participants.push({ name, correct: 0, earnings: 0 });
  // Persistir y actualizar UI
  persistBetData();
  renderParticipants();
  renderMatches();
}

/**
 * Construye la tabla de participantes con sus estadísticas.
 */
function renderParticipants() {
  const container = document.getElementById('participants-list');
  // Limpiar contenido
  container.innerHTML = '';
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  ['Participante', 'Aciertos', 'Ganancias (₡)'].forEach((header) => {
    const th = document.createElement('th');
    th.textContent = header;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  betData.participants.forEach((p) => {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.textContent = p.name;
    const correctTd = document.createElement('td');
    correctTd.textContent = p.correct;
    const moneyTd = document.createElement('td');
    moneyTd.textContent = p.earnings.toFixed(2);
    tr.appendChild(nameTd);
    tr.appendChild(correctTd);
    tr.appendChild(moneyTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

/**
 * Muestra los partidos futuros o pendientes. Los partidos que ya tengan resultado se indican como pasados.
 */
function renderMatches() {
  const list = document.getElementById('matches-list');
  list.innerHTML = '';
  const today = new Date();
  matches.forEach((match, idx) => {
    const card = document.createElement('div');
    card.className = 'match-card';
    // Si el partido ya tiene resultado, marcar como pasado
    if (betData.results[idx]) {
      card.classList.add('past');
    }
    // Información básica
    const teams = document.createElement('div');
    teams.className = 'teams';
    teams.textContent = `${match.team1} vs. ${match.team2}`;
    const datetime = document.createElement('div');
    datetime.className = 'date-time';
    datetime.textContent = `${match.date}${match.time ? ' ' + match.time : ''}`;
    card.appendChild(teams);
    card.appendChild(datetime);
    // Evento de clic solo si no hay resultado
    if (!betData.results[idx]) {
      card.addEventListener('click', () => openMatchModal(match, idx));
    }
    list.appendChild(card);
  });
}

/**
 * Abre el modal para gestionar las apuestas y resultados de un partido.
 * @param {object} match Objeto de partido
 * @param {number} idx Índice del partido en la lista
 */
function openMatchModal(match, idx) {
  const modal = document.getElementById('match-modal');
  modal.classList.remove('hidden');
  document.getElementById('modal-match-title').textContent = `${match.team1} vs. ${match.team2} – ${match.date}${match.time ? ' ' + match.time : ''}`;
  // Renderizar formulario de predicciones
  const form = document.getElementById('predictions-form');
  form.innerHTML = '';
  betData.participants.forEach((p) => {
    const label = document.createElement('label');
    label.textContent = p.name;
    const input1 = document.createElement('input');
    input1.type = 'number';
    input1.min = '0';
    input1.placeholder = match.team1;
    const input2 = document.createElement('input');
    input2.type = 'number';
    input2.min = '0';
    input2.placeholder = match.team2;
    // Rellenar valores existentes
    if (betData.predictions[idx] && betData.predictions[idx][p.name]) {
      const pred = betData.predictions[idx][p.name];
      input1.value = pred.score1;
      input2.value = pred.score2;
    }
    // Adjuntar inputs al label
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.gap = '0.25rem';
    container.appendChild(input1);
    container.appendChild(input2);
    label.appendChild(container);
    form.appendChild(label);
  });
  // Mostrar sección de apuestas
  document.getElementById('predictions-form-container').style.display = '';
  document.getElementById('result-form-container').style.display = '';
  document.getElementById('result-summary').classList.add('hidden');
  // Configurar etiquetas de resultado
  document.getElementById('team1-label').textContent = match.team1;
  document.getElementById('team2-label').textContent = match.team2;
  // Establecer valores de resultado si existen
  const resTeam1 = document.getElementById('result-team1');
  const resTeam2 = document.getElementById('result-team2');
  if (betData.results[idx]) {
    resTeam1.value = betData.results[idx].score1;
    resTeam2.value = betData.results[idx].score2;
    // Mostrar resumen de resultado
    showResultSummary(idx);
  } else {
    resTeam1.value = '';
    resTeam2.value = '';
  }
  // Configurar botones
  document.getElementById('save-predictions').onclick = () => savePredictions(idx, form);
  // Al hacer clic en guardar resultado, primero guardamos las predicciones que estén en el formulario
  document.getElementById('save-result').onclick = () => {
    // Recoger las predicciones actuales antes de evaluar el resultado.
    // Esto evita que el usuario olvide pulsar “Guardar apuestas” y pierda sus pronósticos.
    const predictionsForm = document.getElementById('predictions-form');
    if (predictionsForm) {
      savePredictions(idx, predictionsForm);
    }
    saveResult(idx, match, resTeam1.value, resTeam2.value);
  };
  document.getElementById('close-modal').onclick = () => {
    modal.classList.add('hidden');
  };
}

/**
 * Guarda las predicciones introducidas en el modal para un partido dado.
 * @param {number} idx Índice del partido
 * @param {HTMLFormElement} form Formulario con entradas de predicciones
 */
function savePredictions(idx, form) {
  // Inicializar predicciones del partido
  betData.predictions[idx] = betData.predictions[idx] || {};
  const inputs = form.querySelectorAll('label');
  inputs.forEach((label) => {
    const name = label.childNodes[0].nodeValue.trim();
    const [input1, input2] = label.querySelectorAll('input');
    const score1 = input1.value !== '' ? parseInt(input1.value, 10) : null;
    const score2 = input2.value !== '' ? parseInt(input2.value, 10) : null;
    if (score1 !== null && score2 !== null) {
      betData.predictions[idx][name] = { score1, score2 };
    } else {
      // Si el usuario borra predicción, eliminarla
      if (betData.predictions[idx][name]) delete betData.predictions[idx][name];
    }
  });
  persistBetData();
  alert('Apuestas guardadas correctamente.');
}

/**
 * Procesa el resultado real de un partido, calcula ganadores y actualiza estadísticas.
 * @param {number} idx Índice del partido
 * @param {object} match Objeto de partido
 * @param {string|number} s1 Marcador del equipo1
 * @param {string|number} s2 Marcador del equipo2
 */
function saveResult(idx, match, s1, s2) {
  const score1 = parseInt(s1, 10);
  const score2 = parseInt(s2, 10);
  if (isNaN(score1) || isNaN(score2)) {
    alert('Introduce un marcador válido para ambos equipos.');
    return;
  }
  // Calcular pozo: todos los participantes apuestan 100
  const numParticipants = betData.participants.length;
  let pot = numParticipants * 100 + betData.accumulatedPot;
  // Calcular ganadores
  const winners = [];
  // Recorremos todos los participantes, tengan o no predicción
  betData.participants.forEach((p) => {
    const pred = betData.predictions[idx] ? betData.predictions[idx][p.name] : null;
    if (pred && pred.score1 === score1 && pred.score2 === score2) {
      winners.push(p);
    }
  });
  let share = 0;
  if (winners.length > 0) {
    share = pot / winners.length;
    winners.forEach((w) => {
      w.correct += 1;
      w.earnings += share;
    });
    betData.accumulatedPot = 0;
  } else {
    // Nadie ganó, acumular pozo
    betData.accumulatedPot = pot;
  }
  // Registrar resultado
  betData.results[idx] = {
    score1: score1,
    score2: score2,
    winners: winners.map((w) => w.name),
    pot: pot,
    share: share
  };
  // Persistir y actualizar UI
  persistBetData();
  renderParticipants();
  renderMatches();
  // Mostrar resumen en modal
  showResultSummary(idx);
}

/**
 * Muestra el resumen del resultado del partido en el modal después de guardarlo.
 * @param {number} idx Índice del partido
 */
function showResultSummary(idx) {
  const summaryDiv = document.getElementById('result-summary');
  summaryDiv.innerHTML = '';
  const result = betData.results[idx];
  if (!result) return;
  const p1 = document.createElement('p');
  p1.textContent = `Marcador final: ${result.score1} - ${result.score2}`;
  const p2 = document.createElement('p');
  p2.textContent = `Pozo total: ₡${result.pot.toFixed(2)}`;
  if (result.winners && result.winners.length > 0) {
    const p3 = document.createElement('p');
    p3.textContent = `Ganadores (${result.winners.length}): ${result.winners.join(', ')} (₡${result.share.toFixed(2)} cada uno)`;
    summaryDiv.appendChild(p1);
    summaryDiv.appendChild(p2);
    summaryDiv.appendChild(p3);
  } else {
    const p3 = document.createElement('p');
    p3.textContent = `Nadie acertó. El pozo se acumula para el siguiente partido.`;
    summaryDiv.appendChild(p1);
    summaryDiv.appendChild(p2);
    summaryDiv.appendChild(p3);
  }
  summaryDiv.classList.remove('hidden');
  // Ocultar formularios de apuestas y resultado para este partido
  document.getElementById('predictions-form-container').style.display = 'none';
  document.getElementById('result-form-container').style.display = 'none';
}