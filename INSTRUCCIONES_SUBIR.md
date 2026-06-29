# Instrucciones para subir la quiniela con bolsa acumulada

## 1. GitHub Pages

1. Descomprime este ZIP.
2. Sube todos los archivos al repositorio `mundial`.
3. Verifica que se suban estos archivos principales:
   - `index.html`
   - `results.html`
   - `script.js`
   - `results.js`
   - `style.css`
   - `config.js`
   - `matches.json`
   - `matches_data.js`

En `config.js` debe estar configurado:

```js
window.APP_CONFIG = {
  API_ENDPOINT: 'https://workermundilista.jeison-corrales-garcia.workers.dev/api/betData',
  API_TOKEN: ''
};
```

Después de subir los archivos, abre:

```txt
https://jetocorrales.github.io/mundial/
```

Presiona `Ctrl + F5` para evitar caché.

## 2. Cloudflare Worker

El Worker debe tener un KV namespace enlazado con binding exacto:

```txt
BETS_DATA
```

El archivo `cloudflare_worker_quiniela_puntos.js` contiene el código del Worker.

## 3. Regla de puntos

- Cada participante aporta 100 puntos virtuales por partido.
- Si nadie acierta el marcador exacto, la bolsa se acumula.
- Si una o varias personas aciertan, la bolsa acumulada se reparte entre ellas.
- Al repartirse la bolsa, el acumulado vuelve a 0.

## 4. Botón limpiar puntos

La página principal incluye botones de administración de puntos.

El botón de regla de puntos permite cambiar cuántos puntos aporta cada participante por partido. El nuevo valor se guarda en Cloudflare y se usa para calcular la bolsa de los partidos que se cierren después del cambio. Los partidos ya cerrados conservan su bolsa histórica.

El botón para correcciones manuales permite editar los puntos ganados de cada participante y guardar esos valores en Cloudflare. Esa corrección queda como base hasta el último partido cerrado; los partidos que se cierren después suman puntos sobre esa base.

El botón de limpieza:

```txt
Limpiar puntos ganados
```

Ese botón reinicia solamente:

- Puntos ganados de cada participante

Ese botón conserva:

- Participantes
- Aciertos
- Pronósticos
- Resultados
- Acumulado
- Partidos

El botón pide doble confirmación antes de limpiar los puntos ganados. El cambio se guarda en Cloudflare y en el respaldo local del navegador.

Importante: para que el reinicio de puntos se mantenga al refrescar y en otros dispositivos, el Worker publicado en Cloudflare debe usar la versión actual de `cloudflare_worker_quiniela_puntos.js`, que conserva la marca `settings.pointsResetAfterResultIndex`.
