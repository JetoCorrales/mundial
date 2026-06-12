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

## 4. Botón limpiar datos

La página principal incluye un botón:

```txt
Limpiar todos los datos
```

Ese botón borra:

- Participantes
- Pronósticos
- Resultados
- Acumulado
- Respaldo local del navegador
- Datos guardados en Cloudflare

El botón pide doble confirmación antes de limpiar.
