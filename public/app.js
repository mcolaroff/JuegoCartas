/* Cliente del juego: muestra la pantalla que corresponde según el estado que manda el servidor. */
(() => {
  const GAME_NAME = 'Nombre del juego';
  const SESSION_KEY = 'jdc_session';
  const app = document.getElementById('app');
  const socket = io({ transports: ['websocket', 'polling'] });

  let S = null;            // estado de la partida (del servidor)
  let clockOffset = 0;     // diferencia de reloj con el servidor
  const ui = { screen: 'home', mode: 'join', code: '', name: '', error: '', field: '', sheet: null, busy: false };

  // ---------- Utilidades ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initial = (n) => esc((n || '?').trim().charAt(0).toUpperCase());
  const now = () => Date.now() + clockOffset;
  const secsLeft = (deadline) => Math.max(0, Math.ceil((deadline - now()) / 1000));
  const fmt = (s) => `0:${String(s).padStart(2, '0')}`;
  const saveSession = (s) => { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {} };
  const loadSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } };
  const clearSession = () => { try { localStorage.removeItem(SESSION_KEY); } catch {} };
  const inviteLink = () => `${location.origin}/?c=${S?.code || ''}`;

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // ---------- Íconos ----------
  const I = {
    back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6l6 6"/></svg>',
    dots: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
    alert: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>',
    copy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8h10v10H8z"/><path d="M16 8V6H6v10h2"/></svg>',
    exit: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/></svg>',
    stop: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
    swap: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11A8 8 0 0 0 5.3 7.1L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.7 3.9L20 15"/><path d="M20 20v-5h-5"/></svg>',
    check: (size, color) => `<svg class="paddle-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5l5 5L19.5 7"/></svg>`,
    cross: (size, color) => `<svg class="paddle-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>`,
    mark: '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path fill="#B3171F" d="M3 4h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8l-4 3v-3H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>',
    addUser: '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#B3171F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M17 8v6"/><path d="M14 11h6"/></svg>',
  };
  const menuBtn = () => `<button class="icon-btn" data-act="menu" aria-label="Menú de la partida" aria-haspopup="dialog">${I.dots}</button>`;
  const dots = '<div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>';

  // ---------- Pantallas previas a entrar ----------
  function vHome() {
    return `<main class="screen">
      <div class="grow center" style="gap:24px">
        <div class="logo-card"><b>Nombre<br>del juego</b><span style="font-size:12px;font-weight:600;letter-spacing:.12em">[LOGO]</span></div>
        <p class="p" style="font-size:18px;max-width:280px;color:var(--ink-2)">Una carta, una afirmación. ¿A favor o en contra?</p>
      </div>
      <div class="stack-12">
        <button class="btn btn-primary" data-act="goCreate">Crear partida</button>
        <button class="btn btn-secondary" data-act="goJoin">Unirse a una partida</button>
        <p class="small">Se juega con 3 personas o más, cada una con su celular.</p>
      </div>
    </main>`;
  }

  function vCode() {
    const err = ui.field === 'code' ? ui.error : '';
    return `<main class="screen">
      <button class="icon-btn" data-act="home" aria-label="Volver">${I.back}</button>
      <div class="stack"><h1 class="h1">Unirse a una partida</h1><p class="p">Pedile el código de 4 números a quien creó la partida.</p></div>
      <form class="stack field" data-form="code" novalidate>
        <label for="code">Código</label>
        <input id="code" class="input code-input" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="4" value="${esc(ui.code)}" aria-invalid="${err ? 'true' : 'false'}" aria-describedby="code-err">
        <p id="code-err" class="error" role="alert" ${err ? '' : 'hidden'}>${I.alert}${esc(err)}</p>
        <div class="grow"></div>
        <button class="btn btn-primary" type="submit" id="codeBtn" ${ui.code.length === 4 && !ui.busy ? '' : 'disabled'}>Entrar</button>
      </form>
    </main>`;
  }

  function vNick() {
    const err = ui.field === 'name' ? ui.error : '';
    const base = ui.name.trim().slice(0, 16);
    const sugg = ui.taken ? [`${base} 2`, `${base}cho`] : [];
    return `<main class="screen">
      <div class="bar"><button class="icon-btn" data-act="${ui.mode === 'join' ? 'goJoin' : 'home'}" aria-label="Volver">${I.back}</button>
      ${ui.mode === 'join' ? `<span class="pill">Partida ${esc(ui.code)}</span>` : ''}</div>
      <div class="stack"><h1 class="h1">¿Cómo te llamamos?</h1><p class="p">Tu nombre o apodo. Así te van a ver los demás.</p></div>
      <form class="stack field" data-form="nick" novalidate style="flex-grow:1">
        <label for="nick">Nombre o apodo</label>
        <input id="nick" class="input" maxlength="20" autocomplete="nickname" autocapitalize="words" value="${esc(ui.name)}" aria-invalid="${err ? 'true' : 'false'}" aria-describedby="nick-err">
        <p id="nick-err" class="error" role="alert" ${err ? '' : 'hidden'}>${I.alert}${esc(err)}</p>
        ${sugg.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px">${sugg.map((s) => `<button type="button" class="chip-btn" style="border:1px solid var(--line);background:#fff" data-act="sugg" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
        <div class="grow"></div>
        <button class="btn btn-primary" type="submit" id="nickBtn" ${ui.name.trim() && !ui.busy ? '' : 'disabled'}>${ui.mode === 'create' ? 'Crear partida' : 'Entrar a la partida'}</button>
      </form>
    </main>`;
  }

  // ---------- Sala ----------
  function playerList(showVotes) {
    return `<ul class="list">${S.players.map((p) => `<li class="player ${p.connected ? '' : 'off'}">
      <span class="avatar">${initial(p.name)}</span><span class="name">${esc(p.name)}</span>
      <span class="tag">${[p.id === S.meId ? 'Vos' : '', p.isHost ? 'Anfitrión' : '', p.connected ? '' : 'Desconectado'].filter(Boolean).join(' · ')}</span></li>`).join('')}</ul>`;
  }

  function vLobby() {
    const missing = Math.max(0, S.minPlayers - S.connectedCount);
    if (S.isHost) {
      return `<main class="screen">
        <div class="bar"><span class="label">Sala de espera</span>${menuBtn()}</div>
        <section class="card-box"><span class="label">Código de la partida</span><span class="big-code">${esc(S.code)}</span>
          <button class="chip-btn" data-act="copy">${I.copy}Copiar link de invitación</button></section>
        <section class="stack grow">
          <div class="bar" style="min-height:auto"><h2 class="h2">Jugadores</h2><span class="label" style="font-weight:400">${S.connectedCount} conectados</span></div>
          ${playerList()}
          ${missing ? '<div class="placeholder">Esperando a que se sumen…</div>' : ''}
        </section>
        <div class="stack">
          <p class="small">${missing ? `Falta${missing > 1 ? 'n' : ''} ${missing} jugador${missing > 1 ? 'es' : ''} para poder empezar (mínimo ${S.minPlayers}).` : 'Pueden seguir sumándose aunque ya empiece.'}</p>
          <button class="btn btn-primary" data-act="start" ${missing ? 'disabled' : ''}>Empezar partida</button>
        </div>
      </main>`;
    }
    return `<main class="screen">
      <div class="bar"><span class="label">Sala de espera</span><div class="row"><span class="pill">Partida ${esc(S.code)}</span>${menuBtn()}</div></div>
      <section class="card-box" style="padding:28px 20px;text-align:center">${dots}
        <h1 class="h1" style="font-size:28px">Ya estás adentro, ${esc(S.me?.name)}</h1>
        <p class="p">Esperando que ${esc(S.hostName)} empiece la partida.</p></section>
      <section class="stack grow">
        <div class="bar" style="min-height:auto"><h2 class="h2">Jugadores</h2><span class="label" style="font-weight:400">${S.connectedCount} conectados</span></div>
        ${playerList()}
      </section>
    </main>`;
  }

  // ---------- Turno: lector ----------
  function vOfferMe() {
    const left = secsLeft(S.offerDeadline);
    return `<main class="screen red">
      <div class="bar"><span class="spacer44"></span><span class="pill">Ronda ${S.round} · Turno ${S.turn + 1}</span>${S.isHost ? menuBtn() : '<span class="spacer44"></span>'}</div>
      <div class="grow center" style="gap:28px">
        <div class="back-card" aria-hidden="true"><b>Nombre<br>del juego</b></div>
        <div class="stack" style="gap:10px"><h1 class="h-xl">¡Te toca leer, ${esc(S.me?.name)}!</h1>
        <p class="p" style="font-size:17px;max-width:300px;margin:0 auto">Vas a leer la carta en voz alta y moderar el debate. Vos no votás.</p></div>
      </div>
      <div class="stack-12">
        <div class="bar" style="min-height:auto;font-size:14px;font-weight:600"><span>Si no aceptás, pasa a otro</span><span data-timer="${S.offerDeadline}" data-fmt="s">${left} s</span></div>
        <div class="progress" role="progressbar" aria-label="Tiempo para aceptar" aria-valuemin="0" aria-valuemax="20"><i data-bar="${S.offerDeadline}" data-total="20" style="width:${(left / 20) * 100}%"></i></div>
        <button class="btn btn-white" data-act="accept">Aceptar y ver la carta</button>
      </div>
    </main>`;
  }

  function cardSize(t) { const n = t.length; return n < 55 ? 38 : n < 80 ? 34 : n < 105 ? 30 : 27; }

  function vReadingMe() {
    const c = S.card || { text: '', cat: '' };
    return `<main class="screen">
      <div class="bar"><span class="label">Leé en voz alta</span><div class="row"><span class="pill">Carta ${S.cardNumber} de ${S.deckTotal}</span>${S.isHost ? menuBtn() : ''}</div></div>
      <div class="grow center">
        <article class="game-card" aria-label="Carta">
          <div class="bar" style="min-height:auto">${I.mark}<span class="cat">${esc(c.cat)}</span></div>
          <p class="txt" style="font-size:${cardSize(c.text)}px">${esc(c.text)}</p>
          <span class="brand">${GAME_NAME}</span>
        </article>
      </div>
      <div class="stack">
        <button class="btn btn-primary" data-act="openVoting">Ya la leí · abrir votación</button>
        <button class="btn-link" data-act="pass">Pasar esta carta (perdés el turno)</button>
      </div>
    </main>`;
  }

  function vVotingMe() {
    const others = S.players.filter((p) => p.id !== S.readerId);
    const yes = others.filter((p) => p.vote === 'yes').length;
    const no = others.filter((p) => p.vote === 'no').length;
    const none = others.length - yes - no;
    const left = secsLeft(S.voteDeadline);
    const chip = (v) => v === 'yes' ? '<span class="chip c-yes">✓ A favor</span>' : v === 'no' ? '<span class="chip c-no">✕ En contra</span>' : '<span class="chip c-none">Sin voto</span>';
    return `<main class="screen" style="gap:16px">
      <div class="bar"><span class="label">Debate en curso</span><div class="row"><span class="pill" data-timer="${S.voteDeadline}" data-fmt="vote">${left ? `Votación · ${fmt(left)}` : 'Tiempo de voto cumplido'}</span>${S.isHost ? menuBtn() : ''}</div></div>
      <p class="quote">${esc(S.card?.text)}</p>
      <section class="tally" aria-label="Resultado">
        <div class="t-yes"><b>${yes}</b><span>A favor</span></div>
        <div class="t-no"><b>${no}</b><span>En contra</span></div>
        <div class="t-none"><b>${none}</b><span>Sin voto</span></div>
      </section>
      <ul class="list grow" style="gap:6px">${others.map((p) => `<li class="vote-row" ${p.connected ? '' : 'style="opacity:.55"'}><span class="name">${esc(p.name)}</span>${chip(p.vote)}</li>`).join('')}</ul>
      <div class="stack">
        <p class="small">Pueden cambiar el voto hasta que cierres el turno.</p>
        <button class="btn btn-dark" data-act="closeTurn">Cerrar turno</button>
      </div>
    </main>`;
  }

  // ---------- Turno: resto de jugadores ----------
  function vWaitReader() {
    const sub = S.phase === 'offer' ? 'Esperando que acepte el turno.' : 'Cuando lea la carta, se habilita tu voto acá.';
    return `<main class="screen">
      <div class="bar"><span class="label">Ronda ${S.round} · Turno ${S.phase === 'offer' ? S.turn + 1 : S.turn}</span><div class="row"><span class="pill">Partida ${esc(S.code)}</span>${menuBtn()}</div></div>
      <div class="grow center" style="gap:20px">
        <span class="avatar lg">${initial(S.readerName)}</span>
        <div class="stack"><span class="label" style="font-size:15px">Le tocó leer a</span><h1 class="h-xxl">${esc(S.readerName)}</h1></div>
        <p class="p" style="max-width:280px">${sub}</p>${dots}
      </div>
      <div class="vote-mini" aria-hidden="true"><button tabindex="-1" style="background:var(--yes-btn)" disabled>A favor</button><button tabindex="-1" style="background:var(--no-btn)" disabled>En contra</button></div>
    </main>`;
  }

  function vVote() {
    const left = secsLeft(S.voteDeadline);
    return `<main class="screen" style="gap:16px">
      <div class="bar"><h1 class="h1" style="font-size:26px;font-weight:900">Turno de ${esc(S.readerName)}</h1>
        <div class="row"><span class="pill pill-dark" role="timer" data-timer="${S.voteDeadline}" data-fmt="clock">${fmt(left)}</span>${menuBtn()}</div></div>
      <div class="progress" role="progressbar" aria-label="Tiempo para votar" aria-valuemin="0" aria-valuemax="30"><i data-bar="${S.voteDeadline}" data-total="30" style="width:${(left / 30) * 100}%"></i></div>
      <p class="p" style="color:var(--ink-2)" data-late="${S.voteDeadline}">${left ? 'Escuchá la carta y elegí. Después podés cambiar.' : 'Se terminó el tiempo, pero podés votar igual.'}</p>
      <div class="grow" style="display:flex;flex-direction:column;gap:12px">
        <button class="vote-btn yes" data-act="vote" data-v="yes">${I.check(72, '#0F4D26').replace('class="paddle-icon" ', '')}<span>A favor</span></button>
        <button class="vote-btn no" data-act="vote" data-v="no">${I.cross(72, '#7F1414').replace('class="paddle-icon" ', '')}<span>En contra</span></button>
      </div>
    </main>`;
  }

  function vPaddle() {
    const yes = S.myVote === 'yes';
    return `<main class="screen ${yes ? 'yes' : 'no'}">
      <div class="paddle-top"><span class="spacer44"></span><span class="label">Mostrale tu pantalla al grupo</span>${menuBtn()}</div>
      <div class="grow center" role="img" aria-label="${yes ? 'Votaste a favor' : 'Votaste en contra'}" style="gap:8px">
        ${yes ? I.check(260, '#0F4D26') : I.cross(240, '#7F1414')}
        <span class="paddle-word">${yes ? 'A favor' : 'En contra'}</span>
      </div>
      <button class="swap-btn" data-act="vote" data-v="${yes ? 'no' : 'yes'}">${I.swap}Cambiar a ${yes ? 'en contra' : 'a favor'}</button>
    </main>`;
  }

  // ---------- Estados ----------
  function vPaused() {
    const missing = Math.max(1, S.minPlayers - S.connectedCount);
    return `<main class="screen">
      <div class="bar"><span class="label">Partida en pausa</span><div class="row"><span class="pill">Partida ${esc(S.code)}</span>${menuBtn()}</div></div>
      <div class="grow center" style="gap:20px">${I.addUser}
        <h1 class="h-xl" style="font-size:40px">Esperando jugadores</h1>
        <p class="p" style="font-size:17px;color:var(--ink-2);max-width:300px">${S.connectedCount === 1 ? 'Quedaste solo' : `Quedaron ${S.connectedCount} personas`} y se necesitan ${S.minPlayers}. El juego sigue solo cuando se sume alguien.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
          ${S.players.filter((p) => p.connected).map((p) => `<span class="pill" style="border:0;font-size:15px">${esc(p.name)}</span>`).join('')}
          <span class="pill" style="background:transparent;border:1.5px dashed #BDB8B2;color:var(--muted);font-weight:400">+${missing}</span>
        </div>
      </div>
      <section class="card-box" style="flex-direction:row;justify-content:space-between;padding:16px">
        <div class="stack" style="gap:2px"><span class="label" style="font-weight:400;font-size:13px">Invitá con el código</span><span style="font-size:32px;font-weight:900;letter-spacing:.1em;line-height:1">${esc(S.code)}</span></div>
        <button class="chip-btn" data-act="copy">Copiar link</button>
      </section>
    </main>`;
  }

  function vEnded() {
    return `<main class="screen red">
      <div class="grow center" style="gap:20px">
        <h1 class="h-xl" style="font-size:56px;font-stretch:66%">Fin de la partida</h1>
        <p class="p" style="font-size:17px;max-width:300px">Gracias por jugar. Lo importante fue la charla.</p>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;width:100%;margin-top:8px">
          <div class="stat"><b>${S.stats.discussed}</b><span>carta${S.stats.discussed === 1 ? '' : 's'} debatida${S.stats.discussed === 1 ? '' : 's'}</span></div>
          <div class="stat"><b>${S.stats.players}</b><span>jugadores</span></div>
        </div>
      </div>
      <div class="stack-12">
        <button class="btn btn-white" data-act="newGame">Crear otra partida</button>
        <button class="btn btn-outline-white" data-act="exitHome">Volver al inicio</button>
      </div>
    </main>`;
  }

  // ---------- Hojas ----------
  function vSheet() {
    if (!ui.sheet || !S) return '';
    if (ui.sheet === 'menu') {
      return `<div class="scrim" data-act="closeSheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Menú de la partida">
        <span class="grip" aria-hidden="true"></span>
        <button class="menu-item" data-act="copy">${I.copy}Copiar link de invitación</button>
        ${S.isHost && S.phase !== 'ended' ? `<button class="menu-item danger" data-act="askEnd">${I.stop}Terminar partida</button>` : ''}
        <button class="menu-item" data-act="leave">${I.exit}Salir de la partida</button>
        <button class="btn btn-secondary" data-act="closeSheet">Cancelar</button>
      </div></div>`;
    }
    if (ui.sheet === 'confirmEnd') {
      return `<div class="scrim" data-act="closeSheet"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="fin-t">
        <span class="grip" aria-hidden="true"></span>
        <h2 id="fin-t" class="h1" style="font-size:28px;font-weight:900">¿Terminar la partida?</h2>
        <p class="p" style="color:var(--ink-2)">Se corta para ${S.connectedCount === 1 ? 'vos' : `los ${S.connectedCount} jugadores`} y todos ven la pantalla de cierre. No se puede deshacer.</p>
        <div class="stack" style="margin-top:8px">
          <button class="btn btn-primary" data-act="confirmEnd">Sí, terminar partida</button>
          <button class="btn btn-secondary" data-act="closeSheet">Seguir jugando</button>
        </div>
      </div></div>`;
    }
    return '';
  }

  // ---------- Render ----------
  function currentView() {
    if (!S) return ui.screen === 'code' ? vCode() : ui.screen === 'nick' ? vNick() : vHome();
    const me = S.readerId === S.meId;
    switch (S.phase) {
      case 'lobby': return vLobby();
      case 'paused': return vPaused();
      case 'offer': return me ? vOfferMe() : vWaitReader();
      case 'reading': return me ? vReadingMe() : vWaitReader();
      case 'voting': return me ? vVotingMe() : S.myVote ? vPaddle() : vVote();
      case 'ended': return vEnded();
      default: return vHome();
    }
  }

  let lastKey = '';
  function render() {
    const html = currentView() + vSheet();
    if (html === lastKey) return;
    // Mantener foco/cursor si se re-renderiza un formulario.
    const active = document.activeElement?.id;
    lastKey = html;
    app.innerHTML = html;
    document.body.style.background = getComputedStyle(app.firstElementChild).backgroundColor;
    if (active && document.getElementById(active)) document.getElementById(active).focus();
    tick();
  }

  // Actualiza contadores sin re-dibujar toda la pantalla.
  function tick() {
    app.querySelectorAll('[data-timer]').forEach((el) => {
      const s = secsLeft(+el.dataset.timer);
      if (el.dataset.fmt === 's') el.textContent = `${s} s`;
      else if (el.dataset.fmt === 'clock') el.textContent = fmt(s);
      else if (el.dataset.fmt === 'vote') el.textContent = s ? `Votación · ${fmt(s)}` : 'Tiempo de voto cumplido';
    });
    app.querySelectorAll('[data-bar]').forEach((el) => {
      el.style.width = `${(secsLeft(+el.dataset.bar) / +el.dataset.total) * 100}%`;
    });
    app.querySelectorAll('[data-late]').forEach((el) => {
      if (!secsLeft(+el.dataset.late)) el.textContent = 'Se terminó el tiempo, pero podés votar igual.';
    });
  }
  setInterval(tick, 500);

  // ---------- Acciones ----------
  function setError(field, msg, extra = {}) { Object.assign(ui, { field, error: msg, busy: false }, extra); lastKey = ''; render(); }

  function submitCode() {
    if (ui.code.length !== 4 || ui.busy) return;
    ui.busy = true;
    socket.emit('checkCode', { code: ui.code }, (r) => {
      ui.busy = false;
      if (r?.error) return setError('code', r.error);
      Object.assign(ui, { screen: 'nick', mode: 'join', error: '', field: '', taken: false });
      render();
      document.getElementById('nick')?.focus();
    });
  }

  function submitNick() {
    const name = ui.name.trim();
    if (!name || ui.busy) return;
    ui.busy = true; render();
    const done = (r) => {
      ui.busy = false;
      if (r?.error) {
        if (r.field === 'code') { Object.assign(ui, { screen: 'code' }); return setError('code', r.error); }
        return setError('name', r.error, { taken: !!r.taken });
      }
      ui.error = ''; ui.field = '';
    };
    if (ui.mode === 'create') socket.emit('create', { name }, done);
    else socket.emit('join', { code: ui.code, name }, done);
  }

  async function copyLink() {
    const link = inviteLink();
    try { await navigator.clipboard.writeText(link); toast('Link copiado'); }
    catch { toast(link); }
  }

  function goHome() {
    S = null; clearSession();
    Object.assign(ui, { screen: 'home', sheet: null, error: '', field: '', busy: false });
    history.replaceState(null, '', '/');
    render();
  }

  const actions = {
    goCreate: () => { Object.assign(ui, { screen: 'nick', mode: 'create', error: '', field: '', taken: false }); render(); document.getElementById('nick')?.focus(); },
    goJoin: () => { Object.assign(ui, { screen: 'code', error: '', field: '' }); render(); document.getElementById('code')?.focus(); },
    home: () => { Object.assign(ui, { screen: 'home', error: '', field: '' }); render(); },
    sugg: (el) => { ui.name = el.dataset.v; ui.error = ''; ui.field = ''; ui.taken = false; render(); },
    start: () => socket.emit('start'),
    accept: () => socket.emit('accept'),
    pass: () => socket.emit('pass'),
    openVoting: () => socket.emit('openVoting'),
    closeTurn: () => socket.emit('closeTurn'),
    vote: (el) => {
      // Respuesta inmediata en pantalla; el servidor confirma.
      S.myVote = el.dataset.v; render();
      if (navigator.vibrate) navigator.vibrate(30);
      socket.emit('vote', { value: el.dataset.v });
    },
    menu: () => { ui.sheet = 'menu'; render(); },
    closeSheet: (el, ev) => { if (ev && el.classList.contains('scrim') && ev.target !== el) return; ui.sheet = null; render(); },
    copy: () => { ui.sheet = null; render(); copyLink(); },
    askEnd: () => { ui.sheet = 'confirmEnd'; render(); },
    confirmEnd: () => { ui.sheet = null; socket.emit('endGame'); },
    leave: () => { socket.emit('leave'); goHome(); },
    newGame: () => { goHome(); actions.goCreate(); },
    exitHome: () => goHome(),
  };

  app.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el, ev);
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ui.sheet) { ui.sheet = null; render(); } });

  app.addEventListener('input', (ev) => {
    if (ev.target.id === 'code') {
      ev.target.value = ev.target.value.replace(/\D/g, '').slice(0, 4);
      ui.code = ev.target.value;
      if (ui.field === 'code') { ui.error = ''; ui.field = ''; ev.target.setAttribute('aria-invalid', 'false'); document.getElementById('code-err').hidden = true; }
      document.getElementById('codeBtn').disabled = ui.code.length !== 4;
      if (ui.code.length === 4) submitCode(); // al completar el 4º número entra solo
    }
    if (ev.target.id === 'nick') {
      ui.name = ev.target.value;
      if (ui.field === 'name') { ui.error = ''; ui.field = ''; ev.target.setAttribute('aria-invalid', 'false'); document.getElementById('nick-err').hidden = true; }
      document.getElementById('nickBtn').disabled = !ui.name.trim();
    }
  });
  app.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (ev.target.dataset.form === 'code') submitCode();
    if (ev.target.dataset.form === 'nick') submitNick();
  });

  // ---------- Socket ----------
  socket.on('state', (state) => {
    clockOffset = state.serverNow - Date.now();
    const wasHost = S?.isHost;
    S = state;
    if (S.phase === 'ended' && ui.sheet) ui.sheet = null;
    if (wasHost === false && S.isHost) toast('Ahora sos el anfitrión');
    lastKey = ''; render();
  });
  socket.on('session', (s) => {
    saveSession(s);
    history.replaceState(null, '', `/?c=${s.code}`);
  });
  socket.on('connect', () => {
    document.getElementById('offline').hidden = true;
    const s = loadSession();
    if (s) socket.emit('resume', s, (r) => { if (r?.error) { clearSession(); if (S) goHome(); } });
  });
  socket.on('disconnect', () => { if (S) document.getElementById('offline').hidden = false; });

  // Link de invitación: /?c=4821
  const qc = new URLSearchParams(location.search).get('c');
  const saved = loadSession();
  if (qc && /^\d{4}$/.test(qc) && (!saved || saved.code !== qc)) {
    if (saved) clearSession();
    ui.code = qc; ui.screen = 'code';
    render();
    submitCode();
  } else {
    render();
  }
})();
