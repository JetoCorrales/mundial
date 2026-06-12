/*
 * Script para la página de resultados de las apuestas del Mundial 2026.
 *
 * Este script carga los datos desde bet_data.json y matches.json (o la constante
 * MATCHES_DATA como respaldo) y genera un resumen de los participantes y de
 * los resultados de los partidos. No permite editar ni registrar nuevas
 * apuestas; su objetivo es mostrar información ya consolidada, ideal para
 * publicar en un sitio público como GitHub Pages.
 */

// URL de la API donde se almacenan los datos de apuestas (opcional).
const API_ENDPOINT_RESULTS = 'https://workermundilista.jeison-corrales-garcia.workers.dev/api/betData'; // e.g. 'https://tu-worker.workers.dev/api/betData'

// Función principal que se ejecuta cuando el DOM está listo
document.addEventListener('DOMContentLoaded', () => {
  // Función para cargar betData desde la API si está configurada
  const loadBetDataFromApi = () => {
    if (API_ENDPOINT_RESULTS) {
      return fetch(API_ENDPOINT_RESULTS, { cache: 'no-store' })
        .then((resp) => {
          if (resp.ok) return resp.json();
          throw new Error('Respuesta no OK');
        })
        .catch((err) => {
          console.warn('No se pudo obtener betData desde la API:', err);
          return null;
        });
    }
    return Promise.resolve(null);
  };

  const loadBetDataFromFile = () => {
    return fetch('bet_data.json')
      .then((resp) => resp.json())
      .catch(() => {
        return {};
      });
  };

  const loadMatchesData = () => {
    return fetch('matches.json')
      .then((resp) => resp.json())
      .catch(() => {
        return { matches: Array.isArray(window.MATCHES_DATA) ? window.MATCHES_DATA : [] };
      });
  };

  Promise.all([loadBetDataFromApi(), loadBetDataFromFile(), loadMatchesData()])
    .then(([apiData, fileBetData, matchesData]) => {
      const betData = apiData && Object.keys(apiData).length > 0 ? apiData : fileBetData;
      const matches = matchesData.matches || matchesData;
      renderParticipantsSummary(betData.participants || []);
      renderMatchesSummary(betData.results || {}, matches);
    })
    .catch((err) => {
      console.error('Error al cargar datos:', err);
    });
});

/**
 * Renderiza la tabla de participantes con sus aciertos y ganancias.
 * @param {Array} participants Lista de participantes
 */
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
  ['Participante', 'Aciertos', 'Ganancias (₡)'].forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    hdrRow.appendChild(th);
  });
  thead.appendChild(hdrRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  // Ordenar por mayor número de aciertos y luego por mayores ganancias
  participants
    .slice()
    .sort((a, b) => {
      if (b.correct !== a.correct) return b.correct - a.correct;
      return b.earnings - a.earnings;
    })
    .forEach((p) => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = p.name;
      const tdCorrect = document.createElement('td');
      tdCorrect.textContent = p.correct;
      const tdMoney = document.createElement('td');
      tdMoney.textContent = p.earnings.toFixed(2);
      tr.appendChild(tdName);
      tr.appendChild(tdCorrect);
      tr.appendChild(tdMoney);
      tbody.appendChild(tr);
    });
  table.appendChild(tbody);
  container.appendChild(table);
}

/**
 * Muestra un resumen de los partidos con resultados.
 * @param {object} results Diccionario de resultados con índice de partido como clave
 * @param {Array} matches Lista de partidos (con información de equipos, fecha y hora)
 */
function renderMatchesSummary(results, matches) {
  const container = document.getElementById('matches-summary');
  container.innerHTML = '';
  // Convertir results a array de objetos con índice para ordenar por fecha
  const resArray = Object.keys(results).map((idx) => {
    const res = results[idx];
    return { idx: parseInt(idx, 10), result: res };
  });
  if (resArray.length === 0) {
    container.textContent = 'Aún no hay resultados registrados.';
    return;
  }
  // Ordenar por fecha del partido según matches
  resArray.sort((a, b) => {
    const matchA = matches[a.idx];
    const matchB = matches[b.idx];
    if (!matchA || !matchB) return 0;
    const dateA = new Date(matchA.date + 'T' + (matchA.time ? matchA.time.split(' ')[0] : '00:00'));
    const dateB = new Date(matchB.date + 'T' + (matchB.time ? matchB.time.split(' ')[0] : '00:00'));
    return dateA - dateB;
  });
  // Crear un contenedor de tarjetas de resultados
  resArray.forEach(({ idx, result }) => {
    const match = matches[idx];
    const card = document.createElement('div');
    card.className = 'match-result-card';
    const title = document.createElement('h3');
    if (match) {
      title.textContent = `${match.team1} vs. ${match.team2}`;
    } else {
      title.textContent = `Partido ${idx}`;
    }
    const info = document.createElement('p');
    if (match) {
      info.textContent = `${match.date}${match.time ? ' ' + match.time : ''}`;
    }
    const score = document.createElement('p');
    score.textContent = `Marcador final: ${result.score1} - ${result.score2}`;
    const potInfo = document.createElement('p');
    potInfo.textContent = `Pozo total: ₡${result.pot.toFixed(2)}`;
    const winnersInfo = document.createElement('p');
    if (result.winners && result.winners.length > 0) {
      winnersInfo.textContent = `Ganadores (${result.winners.length}): ${result.winners.join(', ')} (₡${result.share.toFixed(2)} cada uno)`;
    } else {
      winnersInfo.textContent = 'Nadie acertó. El pozo se acumuló.';
    }
    card.appendChild(title);
    if (info.textContent) card.appendChild(info);
    card.appendChild(score);
    card.appendChild(potInfo);
    card.appendChild(winnersInfo);
    container.appendChild(card);
  });
}