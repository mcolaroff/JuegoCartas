# Nombre del juego — versión web

Juego de cartas para jugar en grupo, cada uno con su celular. Una persona lee una afirmación, el resto vota **a favor** o **en contra** y levanta el celular como si fuera una paleta.

## Probarlo en tu computadora

Necesitás [Node.js](https://nodejs.org) 18 o más nuevo.

```bash
npm install
npm start
```

Abrí <http://localhost:3000>. Para probar con celulares en la misma red wifi, entrá desde cada celular a `http://IP-DE-TU-COMPU:3000`. La IP la ves en la configuración de red de la compu.

## Publicarlo en internet gratis (GitHub + Render)

No hace falta instalar nada: todo se hace desde el navegador.

### 1. Subir el código a GitHub

1. Entrá a [github.com](https://github.com) y creá una cuenta gratis, si todavía no tenés.
2. Arriba a la derecha tocá **+ → New repository**.
3. Ponele un nombre, por ejemplo `juego-de-cartas`. Puede ser **Public** o **Private**. Tocá **Create repository**.
4. En la página del repositorio vacío, entrá al link **uploading an existing file**.
5. Arrastrá **todo lo que está adentro** de la carpeta `juego-web`: `server.js`, `cards.js`, `package.json`, `package-lock.json`, `README.md`, `.gitignore` y la carpeta `public`.
   - ⚠️ No arrastres la carpeta `juego-web` entera: `package.json` tiene que quedar en la raíz del repositorio.
   - `.gitignore` es un archivo oculto. Si no lo ves, no pasa nada: no es necesario.
6. Tocá **Commit changes**.

### 2. Publicarlo en Render

1. Entrá a [render.com](https://render.com) y registrate con tu cuenta de GitHub (**Sign up with GitHub**).
2. En el panel tocá **New → Web Service**.
3. Elegí tu repositorio `juego-de-cartas`. Si no aparece, tocá **Configure GitHub** y dale acceso.
4. Completá así:
   - **Language:** Node
   - **Branch:** main
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Tocá **Deploy Web Service**.
6. Esperá unos minutos. Cuando el log diga `Juego escuchando…` y el estado pase a **Live**, arriba vas a ver tu link: `https://juego-de-cartas-xxxx.onrender.com`.
7. Abrilo en el celular, creá una partida y compartí el link de invitación.

### 3. Hacer cambios después

Editá el archivo directamente en GitHub (por ejemplo `cards.js`, con el ícono del lápiz) y guardá con **Commit changes**. Render publica solo la nueva versión en un par de minutos.

### A tener en cuenta en el plan gratuito

- **Se duerme si nadie lo usa:** después de 15 minutos sin tráfico, Render lo apaga. Mientras están jugando no se apaga.
- **Primera carga lenta:** cuando está dormido, la primera visita tarda alrededor de un minuto en arrancarlo. Abrí el link un rato antes de que lleguen tus amigos.
- **Las partidas se guardan en memoria:** si el servidor se reinicia, las partidas en curso se pierden y hay que crear una nueva.

La app también funciona en Railway, Fly.io o cualquier servicio que corra Node como un servidor siempre prendido. **No funciona en Vercel** tal como está: ahí las conexiones pueden caer en servidores distintos y se cortan a los pocos minutos.

## Cómo está armado

| Archivo | Qué tiene |
|---|---|
| `server.js` | Toda la lógica de la partida: códigos, apodos, anfitrión, sorteo por rondas, turnos, votos, pausa, reconexión y fin. |
| `cards.js` | El mazo, con 86 cartas. Para agregar o cambiar cartas, editá este archivo. |
| `public/index.html` · `styles.css` · `app.js` | La interfaz móvil, basada en los wireframes. |

### Reglas que se pueden ajustar (arriba de `server.js`)

- `MIN_PLAYERS = 3`: jugadores mínimos para empezar o seguir.
- `ACCEPT_MS = 20000`: tiempo para aceptar el turno. Si no acepta, pasa a otro.
- `VOTE_MS = 30000`: tiempo para el primer voto. Después se puede votar igual.
- `GRACE_MS = 10000`: margen antes de dar por ido a alguien que perdió la conexión.

### Lógica implementada

- El primero que crea la partida es el anfitrión. Si se va, el rol pasa a otro jugador al azar.
- Los apodos son únicos dentro de la partida, sin importar mayúsculas ni tildes.
- Se puede entrar con la partida empezada. El nuevo se suma a la ronda en curso.
- Sorteo por rondas: todos leen una vez antes de que alguien repita, y nunca lee dos veces seguidas la misma persona.
- El lector no vota. Ve la carta, la puede pasar (pierde el turno y la carta se descarta) y cierra el turno cuando quiere.
- Las cartas no se repiten. Si se termina el mazo, termina la partida.
- Se puede cambiar el voto hasta que el lector cierra el turno.
- Si quedan menos de 3 jugadores, la partida se pausa y sigue sola cuando se suma alguien.
- Si alguien recarga la página o se le bloquea el celular, vuelve a su lugar.
- Solo el anfitrión puede terminar la partida, desde el menú ⋮.
