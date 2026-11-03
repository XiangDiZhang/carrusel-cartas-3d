// ---- Consultas: se hacen cada vez que se carga (o refresca) la página, y solo de la expansión elegida ----
// TCGplayer: precios de mercado de TCGCSV (copia diaria de TCGplayer). El navegador no puede pedírselos a TCGCSV
//   directamente, así que la tarea diaria de GitHub (.github/workflows/datos.yml) los deja en la rama «datos».
// Cardmarket (solo Pokémon): se consulta en vivo a TCGdex, carta a carta, solo para las cartas que se muestran.
// Cambio $ → € del día desde Frankfurter (Banco Central Europeo).
window.Consulta = (function(){
  // en local (localhost) se leen de la carpeta datos/, generada con herramientas/actualizar-datos.ps1
  const DATOS = location.hostname === 'localhost' ? 'datos/' : 'https://raw.githubusercontent.com/XiangDiZhang/carrusel-cartas-3d/datos/';
  const TCGDEX = 'https://api.tcgdex.net/v2/en/cards/';
  const CAMBIO = 'https://api.frankfurter.dev/v1/latest?from=USD&to=EUR';
  const IMG = 'https://tcgplayer-cdn.tcgplayer.com/product/';
  const PTCG_IMG = 'https://images.pokemontcg.io/';

  // no-store: siempre datos nuevos, nunca los de la caché del navegador
  async function pedirJson(url, intentos = 3){
    let ultimoError = null;
    for(let k = 0; k < intentos; k++){
      if(k) await new Promise(r=>setTimeout(r, 500 * k));
      try{
        const r = await fetch(url, {cache: 'no-store'});
        if(r.status === 404) throw Object.assign(new Error('HTTP 404'), {final: true});
        if(!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      }catch(err){ ultimoError = err; if(err.final) break; }
    }
    throw ultimoError;
  }

  async function tipoCambio(){
    const data = await pedirJson(CAMBIO);
    return {rate: data.rates.EUR, date: data.date};
  }

  let info = null;
  // fecha en que TCGCSV tomó los precios de TCGplayer
  const fechaTcgplayer = () => (info || (info = pedirJson(DATOS + 'info.json').then(d=>d.fecha.slice(0, 10)).catch(()=>''))) ;

  // expansiones de la más reciente a la más antigua: las 3 primeras en «Más recientes», el resto por año
  async function expansiones(game){
    const data = await pedirJson(DATOS + game + '.json');
    return data.expansiones.map((s, i)=>({code: s.code, label: s.label, group: i < 3 ? 'Más recientes' : String(s.year)}));
  }

  // las 50 cartas más caras en TCGplayer de una expansión; cada versión (alternativa, manga, SP…) es un producto
  // distinto con su propia imagen y su propio precio
  async function cartas(game, code){
    const [data, date] = await Promise.all([pedirJson(DATOS + game + '/' + code + '.json'), fechaTcgplayer()]);
    // Pokémon: si el generador comprobó la carta en pokemontcg.io (mismo número y nombre), su imagen grande
    // (733 × 1024) en vez de la de TCGplayer (600 × 838); si no carga, se vuelve a la de TCGplayer (alt)
    const grande = c => c.s ? PTCG_IMG + c.s + '_hires.png' : null;
    const list = data.cartas.map(c=>({
      front: grande(c) || IMG + c.p + '_in_1000x1000.jpg', alt: grande(c) ? IMG + c.p + '_in_1000x1000.jpg' : null,
      thumb: IMG + c.p + '_200w.jpg',
      name: c.n, id: c.id, productId: c.p, leader: !!c.l, tcgdex: c.t || null,
      precios: {tcgplayer: c.v}   // en $; cardmarket (en €) se añade con otrosPrecios()
    }));
    return {list, date};
  }

  // Cardmarket vía TCGdex, solo para las cartas que se van a mostrar. Se comprueba que TCGdex habla del mismo
  // producto de TCGplayer; si no coincide (otra versión de la carta), ese precio no se usa.
  const cmCache = new Map();
  function cardmarket(c){
    if(!c.tcgdex) return Promise.resolve(null);
    if(!cmCache.has(c.tcgdex)){
      cmCache.set(c.tcgdex, pedirJson(TCGDEX + c.tcgdex).then(d=>{
        const p = d.pricing || {};
        const tp = p.tcgplayer || {};
        const mismo = Object.values(tp).some(v=>v && v.productId === c.productId);
        const cm = p.cardmarket;
        if(!mismo || !cm) return null;
        // igual que en TCGplayer, el acabado más caro (normal u holo)
        const v = Math.max(cm.trend || 0, cm['trend-holo'] || 0);
        return v > 0 ? {eur: v, date: (cm.updated || '').slice(0, 10)} : null;
      }).catch(()=>null));
    }
    return cmCache.get(c.tcgdex);
  }
  async function otrosPrecios(list){
    const r = await Promise.all(list.map(cardmarket));
    r.forEach((cm, i)=>{ if(cm){ list[i].precios.cardmarket = cm.eur; list[i].cmDate = cm.date; } });
  }

  return {tipoCambio, expansiones, cartas, otrosPrecios};
})();
