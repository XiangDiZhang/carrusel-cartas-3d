// ---- Consultas en vivo: se hacen cada vez que se carga (o refresca) la página ----
// Precios de mercado de TCGplayer: One Piece desde optcgapi.com y Pokémon desde pokemontcg.io.
// Cambio $ → € del día desde Frankfurter (Banco Central Europeo).
window.Consulta = (function(){
  const OPCG = 'https://optcgapi.com/api/';
  // optcgapi tarda unos días en tener las imágenes de las expansiones nuevas: mientras, se usan las de Limitless TCG
  const limitless = id => 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/' + id.split('-')[0] + '/' + id + '_EN.webp';
  const PTCG ='https://api.pokemontcg.io/v2/';
  const CAMBIO = 'https://api.frankfurter.dev/v1/latest?from=USD&to=EUR';

  // no-store: siempre datos nuevos, nunca los de la caché del navegador.
  // pokemontcg.io falla a menudo (500/502/503 al instante): se reintenta hasta 6 veces.
  async function pedirJson(url, intentos = 6){
    let ultimoError = null;
    for(let k = 0; k < intentos; k++){
      if(k) await new Promise(r=>setTimeout(r, 400 * k));
      try{
        const r = await fetch(url, {cache: 'no-store'});
        if(!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      }catch(err){ ultimoError = err; }
    }
    throw ultimoError;
  }

  async function tipoCambio(){
    const data = await pedirJson(CAMBIO);
    return {rate: data.rates.EUR, date: data.date};
  }

  // expansiones de la más reciente a la más antigua
  async function expansiones(game){
    if(game === 'op'){
      const data = await pedirJson(OPCG + 'allSets/');
      const lista = data.slice().reverse().map(s=>({code: s.set_id, label: s.set_id + ': ' + s.set_name}));
      // la lista de optcgapi tarda en incluir las expansiones nuevas aunque sus cartas ya estén:
      // se prueban las dos siguientes de cada serie y se ponen arriba las que ya tengan cartas
      const max = {OP: 0, EB: 0, PRB: 0};
      data.forEach(s=>{ for(const m of s.set_id.matchAll(/(OP|EB|PRB)-?(\d+)/g)) max[m[1]] = Math.max(max[m[1]], +m[2]); });
      const pruebas = [];
      Object.keys(max).forEach(serie=>{ for(let k = 1; k <= 2; k++) pruebas.push(serie + '-' + String(max[serie] + k).padStart(2, '0')); });
      const nuevas = await Promise.all(pruebas.map(code=>
        pedirJson(OPCG + 'sets/' + code + '/', 1).then(cs=>cs.length ? {code, label: code + ': ' + cs[0].set_name} : null).catch(()=>null)));
      return nuevas.filter(Boolean).concat(lista);
    }
    // Pokémon: las 3 primeras en «Más recientes», el resto agrupadas por año
    const data = await pedirJson(PTCG + 'sets?pageSize=250&select=id,name,releaseDate');
    return data.data
      .sort((a, b)=>b.releaseDate.localeCompare(a.releaseDate))
      .map((s, i)=>({code: s.id, label: s.name, group: i < 3 ? 'Más recientes' : s.releaseDate.slice(0, 4)}));
  }

  // cartas de una expansión ordenadas por precio de mercado (sin precio = fuera del ranking)
  // devuelve también la fecha en que la fuente tomó los precios
  async function cartas(game, code){
    if(game === 'op'){
      const data = await pedirJson(OPCG + 'sets/' + encodeURIComponent(code) + '/');
      // en las expansiones recién salidas varias versiones comparten código: se distinguen también por el nombre
      const vistas = new Set();
      const clave = c=>c.card_image_id + '|' + c.card_name;
      const list = data
        .filter(c=>c.market_price != null && c.card_image_id && !vistas.has(clave(c)) && vistas.add(clave(c)))
        .map(c=>({front: c.card_image || limitless(c.card_image_id), name: c.card_name, id: c.card_image_id, price: c.market_price, leader: c.card_type === 'Leader', date: c.date_scraped}));
      return {list: list.sort((a, b)=>b.price - a.price), date: ultimaFecha(list)};
    }
    // Pokémon: hasta 250 por página
    let todas = [];
    for(let page = 1; ; page++){
      const data = await pedirJson(PTCG + 'cards?q=set.id:' + encodeURIComponent(code) + '&pageSize=250&page=' + page + '&select=id,name,number,images,tcgplayer');
      todas = todas.concat(data.data);
      if(!data.data.length || todas.length >= data.totalCount) break;
    }
    const list = [];
    todas.forEach(c=>{
      const precios = c.tcgplayer && c.tcgplayer.prices;
      if(!precios || !c.images) return;
      // una carta puede tener varios acabados (normal, holo, reverse…): se queda el más caro
      const max = Math.max(...Object.values(precios).map(p=>p.market || 0));
      if(max > 0) list.push({front: c.images.large || c.images.small, name: c.name, id: c.id, price: max, leader: false, date: c.tcgplayer.updatedAt.replace(/\//g, '-')});
    });
    return {list: list.sort((a, b)=>b.price - a.price), date: ultimaFecha(list)};
  }
  const ultimaFecha = list => list.reduce((m, c)=>c.date && c.date > m ? c.date : m, '');

  return {tipoCambio, expansiones, cartas};
})();
