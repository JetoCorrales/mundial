# Cambios realizados

Se corrigió la conexión entre GitHub Pages y Cloudflare Worker.

## Archivo clave

Edita `config.js` solo si necesitas cambiar el Worker o agregar token:

```js
window.APP_CONFIG = {
  API_ENDPOINT: 'https://workermundilista.jeison-corrales-garcia.workers.dev/api/betData',
  API_TOKEN: ''
};
```

## Qué cambió

- `script.js` ahora carga primero desde Cloudflare Worker.
- `localStorage` ya no sobrescribe los datos de Cloudflare.
- `localStorage` queda solo como respaldo/cache.
- `results.js` también lee desde Cloudflare Worker.
- Se agregó una barra de estado para saber si cargó/guardó en Cloudflare.
- Se cambió la lógica a quiniela de puntos: marcador exacto = 3 puntos.

## Archivos que debes subir a GitHub Pages

Sube todos estos archivos reemplazando los anteriores:

- `index.html`
- `results.html`
- `script.js`
- `results.js`
- `style.css`
- `config.js`
- `matches.json`
- `matches_data.js`
- `bet_data.json`

## Prueba después de subir

1. Abre la página de GitHub Pages.
2. Presiona Ctrl + F5.
3. Abre F12 > Network / Red.
4. Agrega un participante.
5. Debe aparecer una solicitud POST hacia:
   `https://workermundilista.jeison-corrales-garcia.workers.dev/api/betData`
6. Luego abre esa URL del Worker y verifica que el participante aparezca en el JSON.

## Nota importante sobre token

Si tu Worker exige `Authorization: Bearer ...`, debes poner el token en `config.js`.
Pero recuerda: en GitHub Pages cualquier persona puede ver ese token porque el frontend es público.
