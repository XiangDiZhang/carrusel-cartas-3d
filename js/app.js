(function(){
  // ?obs=1: modo OBS (solo la carta, fondo transparente) con la configuración que viene en el enlace
  const PARAMS = new URLSearchParams(location.search);
  const OBS = PARAMS.get('obs') === '1';
  // ---- Ajustes ----
  const SHOW_MS = 5000;   // tiempo que se muestra cada carta flotando
  const FLIP_MS = 1900;   // duración de la vuelta completa (lenta y suave)

  const thumbsEl = document.getElementById('thumbs');
  const emptyHint = document.getElementById('emptyHint');
  // reversos por defecto
  const BACK_NORMAL = 'assets/reversos/op-normal.webp';
  const BACK_LEADER = 'assets/reversos/op-lider.webp';
  const GAME_BACKS = {pkm: 'assets/reversos/pokemon.webp'};
  // ---- Top por expansión: se consulta en vivo al cargar la página (ver js/consulta.js) ----
  const GAME_NAMES = {op:'One Piece', pkm:'Pokémon'};
  let game = 'op';
  const SETS_BY_GAME = {};      // juego -> expansiones consultadas
  const gameSets = g => SETS_BY_GAME[g] || [];
  const setSelect = document.getElementById('setSelect');
  const setStatus = document.getElementById('setStatus');
  const setCache = new Map();   // juego/código -> cartas ya consultadas en esta visita
  let activeSet = '';           // expansión que se está viendo
  let setToken = 0;
  const fmtDate = d => d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
  let queriedAt = null;         // hora de la última consulta de precios
  let priceDate = '';           // día en que la fuente tomó esos precios
  let EUR_RATE = 0.8775;        // 1 $ = x €; se sustituye por el cambio del día al cargar
  let rateDate = '';
  const rateReady = Consulta.tipoCambio().then(r=>{ EUR_RATE = r.rate; rateDate = r.date; }).catch(()=>{});
  const MAX_CARDS = 50;
  let currency = 'EUR';
  let limit = 10;
  const fmtPrice = v => {
    const eur = currency === 'EUR';
    const n = eur ? v * EUR_RATE : Number(v);
    const d = n < 100 ? 2 : 0;
    return eur ? n.toLocaleString('de-DE', {minimumFractionDigits:d, maximumFractionDigits:d}) + ' €'
               : '$' + n.toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d});
  };
  const stage = document.getElementById('stage');
  const card = document.getElementById('card');
  const holo = document.getElementById('holo');
  const placeholder = document.getElementById('placeholder');
  const frontImg = document.getElementById('frontImg');
  const backImg = document.getElementById('backImg');
  const backPattern = document.getElementById('backPattern');
  const playBtn = document.getElementById('playBtn');

  let cards = [];
  let current = 0;
  let playing = false;
  let uid = 0;
  let selectMode = false;
  const selected = new Set(); // guarda las cartas (objetos) seleccionadas

  // estado de animación
  let rafId = null;
  let t0 = 0;              // inicio del bucle
  let phaseStart = 0;      // inicio de la fase actual
  let phase = 'show';      // 'show' | 'flip'
  let amp = 0;             // intensidad del flotar (sube suave al arrancar)
  let swapped = false;
  let pendingIndex = 0;
  const ph = Array.from({length:6}, ()=>Math.random()*Math.PI*2); // fases aleatorias

  function readFile(file){
    return new Promise((res, rej)=>{
      const r = new FileReader();
      r.onload = ()=>res(r.result);
      r.onerror = ()=>rej(new Error('no se pudo leer'));
      r.readAsDataURL(file);
    });
  }

  // iconos Phosphor (bold, MIT), uno solo por familia
  const ICON = {
    x: '<svg class="ico" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"/></svg>',
    back: '<svg class="ico" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M228,128a100,100,0,0,1-98.66,100H128a99.39,99.39,0,0,1-68.62-27.29,12,12,0,0,1,16.48-17.45,76,76,0,1,0-1.57-109c-.13.13-.25.25-.39.37L54.89,92H72a12,12,0,0,1,0,24H24a12,12,0,0,1-12-12V56a12,12,0,0,1,24,0V76.72L57.48,57.06A100,100,0,0,1,228,128Z"/></svg>',
    check: '<svg class="ico" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z"/></svg>'
  };
  // esqueleto de carga con la forma final de las miniaturas
  function showSkeleton(n){
    thumbsEl.innerHTML = '';
    thumbsEl.classList.remove('selecting');
    emptyHint.style.display = 'none';
    for(let k=0;k<Math.min(n,12);k++){ const d = document.createElement('div'); d.className = 'thumb skeleton'; d.setAttribute('aria-hidden','true'); thumbsEl.appendChild(d); }
    thumbsEl.setAttribute('aria-busy','true');
  }
  function renderThumbs(){
    thumbsEl.removeAttribute('aria-busy');
    thumbsEl.innerHTML = '';
    thumbsEl.classList.toggle('selecting', selectMode);
    emptyHint.style.display = cards.length ? 'none' : 'block';
    renderSelBar();
    document.getElementById('deckCount').textContent = cards.length ? '('+cards.length+')' : '';
    cards.forEach((c, i)=>{
      const inputId = 'backInput_' + (uid++);
      const t = document.createElement('div');
      t.className = 'thumb' + (i===current?' active':'') + (c.back?' has-back':'') + (selected.has(c)?' selected':'') + (c.price!=null?' has-price':'');
      if(c.name) t.title = c.name + (c.id ? ' (' + c.id + ')' : '') + (c.price!=null ? ' · ' + fmtPrice(c.price) : '') + (c.precios ? '\n' + sourcesText(c) : '');
      // miniatura pequeña; la imagen grande solo se carga para la carta que se ve (y la siguiente)
      t.innerHTML =
        '<img src="'+(c.thumb || c.front)+'" alt="Carta '+(i+1)+'" loading="lazy">' +
        '<label class="mini-btn back-set" for="'+inputId+'" title="Añadir reverso" aria-label="Añadir reverso">' + ICON.back + '</label>' +
        '<button class="mini-btn remove" title="Quitar" aria-label="Quitar">' + ICON.x + '</button>' +
        '<input type="file" id="'+inputId+'" class="back-input" accept="image/*" style="display:none">' +
        '<span class="check">' + ICON.check + '</span>' +
        (c.price!=null ? '<span class="price">' + fmtPrice(c.price) + '</span>' : '');
      t.addEventListener('click', (e)=>{
        if(e.target.closest('.back-set') || e.target.closest('.remove') || e.target.closest('.back-input')) return;
        if(selectMode){
          if(selected.has(c)) selected.delete(c); else selected.add(c);
          renderThumbs();
          return;
        }
        if(phase==='flip') return;
        current = i; setFaces(i, i); renderThumbs();
        phaseStart = performance.now();
      });
      t.querySelector('.remove').addEventListener('click', (e)=>{
        e.stopPropagation();
        selected.delete(c);
        cards.splice(i,1);
        if(current>=cards.length) current = Math.max(0, cards.length-1);
        phase = 'show'; phaseStart = performance.now();
        setFaces(current, current);
        renderThumbs(); updateButtons();
        if(!cards.length) stopPlaying();
      });
      t.querySelector('.back-input').addEventListener('change', async (e)=>{
        const f = e.target.files[0];
        if(!f) return;
        try{
          cards[i].back = await readFile(f);
          if(i===current && phase==='show') setFaces(current, current);
          renderThumbs();
        }catch(err){}
      });
      thumbsEl.appendChild(t);
    });
  }

  const selBar = document.getElementById('selBar');
  const bulkBackInput = document.getElementById('bulkBackInput');

  function renderSelBar(){
    selBar.innerHTML = '';
    if(!cards.length){ selectMode = false; selected.clear(); return; }
    if(!selectMode){
      const b = document.createElement('button');
      b.textContent = 'Seleccionar varias';
      b.onclick = ()=>{ selectMode = true; renderThumbs(); };
      selBar.appendChild(b);
      return;
    }
    const all = document.createElement('button');
    const allSel = selected.size === cards.length;
    all.textContent = allSel ? 'Ninguna' : 'Todas';
    all.onclick = ()=>{ if(allSel) selected.clear(); else cards.forEach(c=>selected.add(c)); renderThumbs(); };

    const apply = document.createElement('label');
    apply.className = 'btn primary' + (selected.size ? '' : ' disabled');
    apply.htmlFor = 'bulkBackInput';
    apply.textContent = selected.size ? 'Poner reverso a ' + selected.size + (selected.size===1?' carta':' cartas') : 'Elige cartas';

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancelar';
    cancel.onclick = ()=>{ selectMode = false; selected.clear(); renderThumbs(); };

    selBar.append(all, apply, cancel);
  }

  bulkBackInput.addEventListener('change', async ()=>{
    const f = bulkBackInput.files && bulkBackInput.files[0];
    bulkBackInput.value = '';
    if(!f || !selected.size) return;
    try{
      const url = await readFile(f);
      selected.forEach(c=>{ c.back = url; });
      if(phase==='show' && cards[current]) setBack(current);
      selected.clear();
      selectMode = false;
      renderThumbs();
    }catch(err){}
  });

  const priceTag = document.getElementById('priceTag');
  const priceVal = document.getElementById('priceVal');
  const priceLabel = priceTag.querySelector('.pt-label');
  function setPriceTag(i){
    const c = cards[i];
    if(c && c.price!=null){
      priceLabel.textContent = c.precios && c.precios.cardmarket ? 'Precio medio' : 'Precio de mercado';
      priceVal.textContent = fmtPrice(c.price); priceTag.hidden = false;
    }
    else priceTag.hidden = true;
  }
  function setFront(i){
    setPriceTag(i);
    const c = cards[i];
    if(!c){ placeholder.style.display='flex'; frontImg.style.display='none'; return; }
    placeholder.style.display='none';
    frontImg.src = c.front; frontImg.style.display='block';
    // las capas del relieve usan la misma imagen (ya descargada)
    reliefShade.src = reliefShine.src = c.front;
    // se adelanta la descarga de la siguiente para que la vuelta no se quede en blanco
    const next = cards[(i+1) % cards.length];
    if(next && next !== c) new Image().src = next.front;
  }
  function setBack(i){
    const c = cards[i];
    if(c && c.back){ backImg.src = c.back; backImg.style.display='block'; backPattern.style.display='none'; }
    else { backImg.style.display='none'; backPattern.style.display='flex'; }
  }
  function setFaces(fi, bi){ setFront(fi); setBack(bi); }

  // mueve el brillo y el reflejo según la inclinación
  function setLight(rx, ry){
    const hx = 50 + ry/18*45, hy = 50 - rx/8*40;
    const gx = 50 + ry/18*55, gy = 35 - rx/8*35;
    const hi = Math.min(1, (Math.abs(ry)/16 + Math.abs(rx)/8)/1.3);
    card.style.setProperty('--hx', hx.toFixed(1)+'%');
    card.style.setProperty('--hy', hy.toFixed(1)+'%');
    card.style.setProperty('--gx', gx.toFixed(1)+'%');
    card.style.setProperty('--gy', gy.toFixed(1)+'%');
    card.style.setProperty('--hi', hi.toFixed(2));
    card.style.setProperty('--hr', (ry*6).toFixed(1));
    setReliefLight(rx, ry);
  }

  // ---- Relieve ----
  // la luz llega de arriba a la izquierda y gira y se inclina con la carta: así los relieves brillan y hacen sombra al moverse
  const RELIEF_SCALE = {no: 0, suave: 2.5, marcado: 6};
  const reliefShade = document.getElementById('reliefShade');
  const reliefShine = document.getElementById('reliefShine');
  const reliefLights = document.querySelectorAll('.relief-light');
  let reliefOn = false, lastAz = null, lastEl = null;
  function setReliefLight(rx, ry){
    if(!reliefOn) return;
    const az = 225 + ry*5 - rx*4;
    const el = Math.max(25, Math.min(65, 45 + rx*2 - Math.abs(ry)*0.6));
    // los filtros de luz son caros: solo se recalculan si la luz cambia de verdad
    if(lastAz !== null && Math.abs(az - lastAz) < 0.4 && Math.abs(el - lastEl) < 0.4) return;
    lastAz = az; lastEl = el;
    reliefLights.forEach(l=>{ l.setAttribute('azimuth', az.toFixed(1)); l.setAttribute('elevation', el.toFixed(1)); });
  }
  function setRelief(name){
    if(!(name in RELIEF_SCALE)) name = 'no';
    card.dataset.relieve = name;
    reliefOn = name !== 'no';
    document.querySelectorAll('#reliefPicker button').forEach(x=>x.setAttribute('aria-pressed', x.dataset.relieve===name?'true':'false'));
    document.querySelectorAll('#fRelieveSombra feDiffuseLighting, #fRelieveBrillo feSpecularLighting')
      .forEach(f=>f.setAttribute('surfaceScale', RELIEF_SCALE[name]));
    lastAz = null;
  }
  document.getElementById('reliefPicker').addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b) return;
    setRelief(b.dataset.relieve);
  });

  document.getElementById('holoPicker').addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b) return;
    setHolo(b.dataset.holo);
  });
  function setHolo(name){
    card.dataset.holo = name;
    document.querySelectorAll('#holoPicker button').forEach(x=>x.setAttribute('aria-pressed', x.dataset.holo===name?'true':'false'));
  }

  const intRange = document.getElementById('intRange');
  const intVal = document.getElementById('intVal');
  intRange.addEventListener('input', ()=>{
    card.style.setProperty('--int', (intRange.value/100).toFixed(2));
    intVal.textContent = intRange.value + '%';
  });
  function setIntensity(v){
    intRange.value = v;
    card.style.setProperty('--int', (v/100).toFixed(2));
    intVal.textContent = v + '%';
  }

  function updateButtons(){ const none = cards.length === 0; playBtn.disabled = none; document.getElementById('obsBtn').disabled = none; }

  const smooth = x => x*x*(3-2*x);          // suavizado sin tirones
  const smoother = x => x*x*x*(x*(x*6-15)+10);

  // pose de flotar: suma de ondas con fases aleatorias -> movimiento orgánico, nunca repetido igual
  function floatPose(t){
    const ry = 13*Math.sin(t*0.85+ph[0]) + 4*Math.sin(t*1.63+ph[1]);
    // rotateX positivo = la parte de abajo se acerca; va alternando arriba/abajo con sesgo hacia abajo
    const rx = 2 + 4.5*Math.sin(t*0.61+ph[2]) + 1.8*Math.sin(t*1.37+ph[3]);
    const rz = ry*0.12 + 0.8*Math.sin(t*0.47+ph[4]);
    const ty = -4 - 3.5*Math.sin(t*0.73+ph[5]);
    return {rx, ry, rz, ty};
  }

  function frame(now){
    const t = (now - t0)/1000;
    amp = Math.min(1, amp + 0.02); // arranca desde reposo de forma suave

    let flipAngle = 0;
    let damp = 1;

    if(phase==='show'){
      if(cards.length>1 && now - phaseStart >= SHOW_MS){
        phase = 'flip'; phaseStart = now; swapped = false;
        pendingIndex = (current+1)%cards.length;
      } else if(cards.length===1 && now - phaseStart >= SHOW_MS){
        phase = 'flip'; phaseStart = now; swapped = false;
        pendingIndex = current;
      }
    }
    if(phase==='flip'){
      const p = Math.min(1, (now - phaseStart)/FLIP_MS);
      flipAngle = 360*smoother(p);
      damp = 1 - 0.55*Math.sin(Math.PI*p); // el flotar se calma un poco durante la vuelta, sin cortarse
      if(!swapped && flipAngle >= 180){
        setFront(pendingIndex); // la cara delantera está oculta ahora mismo
        swapped = true;
      }
      if(p>=1){
        current = pendingIndex;
        setBack(current);
        renderThumbs();
        phase = 'show'; phaseStart = now;
        flipAngle = 0;
      }
    }

    // el precio se desvanece mientras la carta enseña el reverso y cambia a mitad de vuelta
    // zoom: el precio se encoge al empezar la vuelta y crece (con un pequeño rebote) con la carta nueva
    let ps = 1;
    if(phase==='flip'){
      const f = flipAngle/360;
      const pt = Math.min(1, (now - phaseStart)/FLIP_MS);   // tiempo real de la vuelta
      if(f < 0.5){
        // salida tipo cartoon: se infla de golpe y luego sale disparado hacia dentro
        const POP = 0.07, OUT = 0.34, BIG = 1.32;
        if(pt < POP){ const t = pt/POP; ps = 1 + (BIG-1)*(1-(1-t)*(1-t)); }
        else if(pt < OUT){ const t = (pt-POP)/(OUT-POP); ps = BIG*(1 - t*t*t); }
        else ps = 0;
      }
      else { const t = (f-0.5)*2, c1 = 1.70158, c3 = c1 + 1; ps = 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2); }
    }
    priceTag.style.transform = 'scale(' + Math.max(0, ps).toFixed(3) + ')';
    const k = amp*damp;
    const pose = floatPose(t);
    card.style.transform =
      'translateY('+(pose.ty*k).toFixed(2)+'px) rotateX('+(pose.rx*k).toFixed(2)+'deg) rotateY('+(pose.ry*k + flipAngle).toFixed(2)+'deg) rotateZ('+(pose.rz*k).toFixed(2)+'deg)';

    setLight(pose.rx*k, pose.ry*k);

    rafId = requestAnimationFrame(frame);
  }

  function startPlaying(){
    if(!cards.length || playing) return;
    playing = true;
    stage.classList.add('autoplay');
    playBtn.textContent = 'Pausar';
    card.style.transition = 'none';
    amp = 0;
    t0 = performance.now();
    phase = 'show'; phaseStart = t0;
    setFaces(current, current);
    rafId = requestAnimationFrame(frame);
  }
  function stopPlaying(){
    playing = false;
    stage.classList.remove('autoplay');
    playBtn.textContent = 'Reproducir';
    if(rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if(phase==='flip'){ current = pendingIndex; phase='show'; }
    setFaces(current, current);
    renderThumbs();
    card.style.transition = 'transform .6s ease';
    card.style.transform = 'translateY(0) rotateX(0deg) rotateY(0deg) rotateZ(0deg)';
    setLight(0,0);
  }

  playBtn.addEventListener('click', ()=> playing ? stopPlaying() : startPlaying());

  // ---- Enlace para OBS: esta misma página con la configuración actual; OBS consulta los datos al cargarla ----
  const obsBtn = document.getElementById('obsBtn');
  const obsNote = document.getElementById('obsNote');
  const obsLink = document.getElementById('obsLink');
  const isDefaultBack = b => !b || b === BACK_NORMAL || b === BACK_LEADER || Object.values(GAME_BACKS).includes(b);
  function obsUrl(){
    const p = new URLSearchParams({obs: '1', juego: game, exp: activeSet, n: String(limit), brillo: card.dataset.holo, relieve: card.dataset.relieve, int: intRange.value, moneda: currency});
    return location.origin + location.pathname + '?' + p;
  }
  obsBtn.addEventListener('click', async ()=>{
    if(!activeSet) return;
    const url = obsUrl();
    obsLink.value = url;
    obsLink.focus(); obsLink.select();
    const note = copied => obsNote.textContent = (copied ? 'Enlace copiado. ' : 'Copia el enlace. ') +
      'En OBS: Fuente → Navegador → pégalo en «URL» (por ejemplo, 1080 × 1080).' +
      (cards.some(c=>!isDefaultBack(c.back)) ? ' Los reversos que hayas cambiado no van en el enlace: en OBS salen los de por defecto.' : '');
    note(false);
    // el portapapeles puede no contestar nunca (permisos): no se le espera para dar las instrucciones
    try{ await Promise.race([navigator.clipboard.writeText(url), new Promise((_, no)=>setTimeout(no, 2000))]); note(true); }catch(err){}
  });

  // ---- Selector de expansión ----
  function showDeck(list, code){
    if(playing) stopPlaying();
    selected.clear(); selectMode = false;
    cards = list; activeSet = code; current = 0; phase = 'show';
    setSelect.value = code;
    setFaces(0, 0); updateButtons(); renderThumbs();
    if(cards.length) startPlaying();
  }
  // cada expansión se consulta una vez por visita; al refrescar la página se vuelve a consultar
  async function fetchSet(code){
    const key = game + '/' + code;
    let pr = setCache.get(key);
    if(!pr){
      pr = Consulta.cartas(game, code).then(r=>Object.assign(r, {at: new Date()}));
      setCache.set(key, pr);
      pr.catch(()=>setCache.delete(key));
    }
    return pr;
  }
  const fmtDay = iso => iso.split('-').reverse().join('/');
  // precio medio en $ entre las fuentes que tengan la carta (Cardmarket va en € y se pasa a $)
  function avgPrice(p){
    const v = [p.tcgplayer];
    if(p.cardmarket) v.push(p.cardmarket / EUR_RATE);
    return v.reduce((a, b)=>a + b, 0) / v.length;
  }
  const fmtEur = v => v.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' €';
  function sourcesText(c){
    if(!c.precios) return '';
    let t = 'TCGplayer ' + '$' + c.precios.tcgplayer.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
    if(c.precios.cardmarket) t += ' · Cardmarket ' + fmtEur(c.precios.cardmarket);
    return t;
  }
  function statusText(n){
    const withCm = cards.filter(c=>c.precios && c.precios.cardmarket).length;
    let t = 'Top ' + n + ' de ' + GAME_NAMES[game] + ' en inglés. ';
    if(withCm) t += 'Precio medio entre TCGplayer' + (priceDate ? ' (' + fmtDay(priceDate) + ')' : '') + ' y Cardmarket (hoy' + (withCm < n ? ', ' + withCm + ' de ' + n + ' cartas; el resto solo TCGplayer' : '') + ')';
    else t += 'Precio de mercado en TCGplayer' + (priceDate ? ' del ' + fmtDay(priceDate) : '') + (game === 'op' ? ' (no hay otra fuente gratuita para One Piece)' : '');
    t += ', consultado el ' + (queriedAt ? fmtDate(queriedAt) : '…');
    if(currency === 'EUR') t += ', pasado a euros (1 $ = ' + EUR_RATE.toLocaleString('de-DE',{maximumFractionDigits:4}) + ' €' + (rateDate ? ', cambio del ' + fmtDay(rateDate) : '') + ')';
    return t + '.';
  }
  async function selectSet(code){
    const token = ++setToken;
    if(!code) return -1;
    const meta = gameSets(game).find(x=>x.code===code);
    setStatus.classList.remove('error');
    setStatus.textContent = 'Cargando ' + (meta ? meta.label.split(':')[0] : code) + '…';
    showSkeleton(limit);
    try{
      const r = await fetchSet(code);
      const list = r.list.slice(0, limit);
      // las otras fuentes se consultan solo para las cartas que se van a mostrar
      await Promise.all([Consulta.otrosPrecios(list), rateReady]);
      if(token !== setToken) return -1;
      queriedAt = r.at; priceDate = r.date;
      // copia nueva cada vez: los reversos por defecto según sea líder o no
      const backFor = c => game === 'op' ? (c.leader ? BACK_LEADER : BACK_NORMAL) : (GAME_BACKS[game] || null);
      const deck = list.map(c=>({front:c.front, thumb:c.thumb, back: backFor(c), name:c.name, id:c.id, precios:Object.assign({}, c.precios), price: avgPrice(c.precios)}));
      deck.sort((a, b)=>b.price - a.price);
      showDeck(deck, code);
      setStatus.textContent = list.length ? statusText(list.length) + (limit > list.length ? ' Esta expansión solo tiene ' + list.length + ' cartas con precio.' : '')
                                          : 'Esta expansión aún no tiene cartas con precio en TCGplayer.';
      return list.length;
    }catch(err){
      if(token !== setToken) return -1;
      setSelect.value = activeSet;
      renderThumbs();
      setStatus.textContent = 'No se pudieron cargar las cartas de ' + (meta ? meta.label.split(':')[0] : code) + ' (' + (err && err.message || err) + '). Elige la expansión otra vez para reintentarlo.';
      setStatus.classList.add('error');
      return -1;
    }
  }
  const gameSelect = document.getElementById('gameSelect');
  async function loadGame(g, autoOpen){
    // al cambiar de juego se abre la expansión más reciente
    const token = ++setToken;
    game = g;
    setSelect.innerHTML = '';
    if(!SETS_BY_GAME[g]){
      setStatus.classList.remove('error');
      setStatus.textContent = 'Consultando las expansiones de ' + GAME_NAMES[g] + '…';
      try{ SETS_BY_GAME[g] = await Consulta.expansiones(g); }
      catch(err){
        if(token !== setToken) return;
        setStatus.textContent = 'No se pudieron consultar las expansiones de ' + GAME_NAMES[g] + ' (' + (err && err.message || err) + '). Refresca la página para reintentarlo.';
        setStatus.classList.add('error');
        return;
      }
      if(token !== setToken) return;
    }
    let parent = setSelect, lastGroup = null;
    gameSets(g).forEach(x=>{
      if(x.group && x.group !== lastGroup){
        parent = document.createElement('optgroup'); parent.label = x.group; setSelect.appendChild(parent); lastGroup = x.group;
      }
      const o = document.createElement('option');
      o.value = x.code; o.textContent = x.label;
      parent.appendChild(o);
    });
    setStatus.textContent = ''; setStatus.classList.remove('error');
    if(!autoOpen) return;
    // las expansiones recién salidas pueden no tener precios aún: se abre la más reciente que sí los tenga
    for(const x of gameSets(g).slice(0, 8)){
      const n = await selectSet(x.code);
      if(n !== 0 || game !== g || setSelect.value !== x.code) break;
    }
  }
  gameSelect.addEventListener('change', ()=>loadGame(gameSelect.value, true));
  setSelect.addEventListener('change', ()=>selectSet(setSelect.value));

  // ---- Moneda ----
  const curSeg = document.getElementById('curSeg');
  curSeg.addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b || b.dataset.cur === currency) return;
    currency = b.dataset.cur;
    curSeg.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed', x===b ? 'true' : 'false'));
    renderThumbs();
    if(phase!=='flip') setPriceTag(current);
    if(activeSet && !setStatus.classList.contains('error')) setStatus.textContent = statusText(cards.length);
  });

  // ---- Número de cartas ----
  const limitSelect = document.getElementById('limitSelect');
  const limitCustom = document.getElementById('limitCustom');
  const limitHint = document.getElementById('limitHint');
  function setLimit(n){
    n = Math.max(1, Math.min(MAX_CARDS, Math.round(Number(n) || 10)));
    if(n === limit) return;
    limit = n;
    if(activeSet) selectSet(activeSet);
  }
  limitSelect.addEventListener('change', ()=>{
    const custom = limitSelect.value === 'custom';
    limitCustom.hidden = !custom; limitHint.hidden = !custom;
    if(custom){ limitCustom.value = limit; limitCustom.focus(); limitCustom.select(); }
    else setLimit(limitSelect.value);
  });
  function applyCustom(){
    const n = Math.max(1, Math.min(MAX_CARDS, Math.round(Number(limitCustom.value) || limit)));
    limitCustom.value = n;
    setLimit(n);
  }
  limitCustom.addEventListener('change', applyCustom);
  limitCustom.addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); applyCustom(); } });

  // arrastre manual en pausa
  let dragging=false, sx=0, sy=0;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function down(x,y){ if(playing) return; dragging=true; sx=x; sy=y; card.style.transition='none'; }
  function move(x,y){
    if(!dragging) return;
    const ry = clamp((x-sx)*0.35,-22,22);
    const rx = clamp(-(y-sy)*0.35,-22,22);
    card.style.transform='rotateX('+rx+'deg) rotateY('+ry+'deg)';
    setLight(rx*0.4, ry*0.8);
  }
  function up(){
    if(!dragging) return;
    dragging=false;
    card.style.transition='transform .4s ease';
    card.style.transform='rotateX(0deg) rotateY(0deg)';
    setLight(0,0);
  }
  stage.addEventListener('mousedown', e=>down(e.clientX,e.clientY));
  window.addEventListener('mousemove', e=>move(e.clientX,e.clientY));
  window.addEventListener('mouseup', up);
  stage.addEventListener('touchstart', e=>{const t=e.touches[0];down(t.clientX,t.clientY);},{passive:true});
  stage.addEventListener('touchmove', e=>{const t=e.touches[0];move(t.clientX,t.clientY);},{passive:true});
  stage.addEventListener('touchend', up);

  updateButtons();
  renderThumbs();
  setFaces(0,0);

  if(OBS){
    document.documentElement.classList.add('obs');
    document.body.classList.add('obs');
    const g = GAME_NAMES[PARAMS.get('juego')] ? PARAMS.get('juego') : 'op';
    if(PARAMS.get('moneda') === 'USD') currency = 'USD';
    const n = Number(PARAMS.get('n')); if(n >= 1) limit = Math.min(MAX_CARDS, Math.round(n));
    if(PARAMS.has('brillo')) setHolo(PARAMS.get('brillo'));
    if(PARAMS.has('relieve')) setRelief(PARAMS.get('relieve'));
    if(PARAMS.has('int')) setIntensity(Math.max(0, Math.min(300, Number(PARAMS.get('int')) || 0)));
    gameSelect.value = g;
    // si la expansión del enlace ya no existe, se abre la más reciente
    loadGame(g, false).then(()=>{
      const exp = PARAMS.get('exp');
      if(exp && gameSets(g).some(x=>x.code === exp)) selectSet(exp); else loadGame(g, true);
    });
    // se vuelve a cargar cada 6 horas para coger los precios nuevos sin tocar OBS
    setTimeout(()=>location.reload(), 6 * 3600 * 1000);
  } else loadGame('op', true);
})();
