/* ============================================================
   PLAYMAX — script.js
   ============================================================ */

const STORAGE_KEYS = {
  progressoSeries: 'playmax_progresso_series', // ultimo ep visto por serie
  continuarLista: 'playmax_continuar',         // lista geral (filmes+series) p/ "continuar assistindo"
};

let FILMES = [];
let SERIES = [];
let ytPlayer = null;
let ytReady = false;
let currentPlayback = null; // { tipo, id, titulo, youtubeId, temporada, episodio }

/* ---------------- Utilitários de armazenamento ---------------- */
function getProgressoSeries(){
  try{ return JSON.parse(localStorage.getItem(STORAGE_KEYS.progressoSeries)) || {}; }
  catch(e){ return {}; }
}
function setProgressoSerie(serieId, temporada, episodio){
  const dados = getProgressoSeries();
  dados[serieId] = { temporada, episodio, quando: Date.now() };
  localStorage.setItem(STORAGE_KEYS.progressoSeries, JSON.stringify(dados));
}

function getContinuar(){
  try{ return JSON.parse(localStorage.getItem(STORAGE_KEYS.continuarLista)) || []; }
  catch(e){ return []; }
}
function marcarContinuar(item){
  // item: { tipo:'filme'|'serie', id, quando }
  let lista = getContinuar().filter(i => !(i.tipo === item.tipo && i.id === item.id));
  lista.unshift({ ...item, quando: Date.now() });
  lista = lista.slice(0, 12);
  localStorage.setItem(STORAGE_KEYS.continuarLista, JSON.stringify(lista));
}

/* ---------------- Carregamento dos dados ---------------- */
async function carregarDados(){
  // Usa os dados embutidos em data.js (funciona mesmo abrindo o index.html direto,
  // sem precisar de servidor). Se por algum motivo não estiverem disponíveis,
  // tenta buscar os arquivos .json (útil quando o site está hospedado num servidor).
  if(typeof FILMES_DATA !== 'undefined' && typeof SERIES_DATA !== 'undefined'){
    FILMES = FILMES_DATA;
    SERIES = SERIES_DATA;
  }else{
    try{
      const [rFilmes, rSeries] = await Promise.all([
        fetch('filmes.json'),
        fetch('series.json')
      ]);
      FILMES = await rFilmes.json();
      SERIES = await rSeries.json();
    }catch(e){
      console.error('Erro ao carregar catálogo:', e);
      FILMES = []; SERIES = [];
    }
  }
  montarHero();
  montarLinhaFilmes();
  montarLinhaSeries();
  montarLinhaContinuar();
  montarLinhaRecomendados();
}

/* ---------------- HERO ---------------- */
function montarHero(){
  const destaque = SERIES[0] || FILMES[0];
  if(!destaque) return;
  const isSerie = !!destaque.temporadas;

  document.getElementById('heroBg').style.backgroundImage = `url('${destaque.capa}')`;
  document.getElementById('heroTag').textContent = isSerie ? 'SÉRIE EM DESTAQUE' : 'FILME EM DESTAQUE';
  document.getElementById('heroTitle').textContent = destaque.titulo;
  document.getElementById('heroDesc').textContent = destaque.descricao;

  const meta = document.getElementById('heroMeta');
  meta.innerHTML = '';
  if(!isSerie){
    meta.innerHTML = `<span class="meta-badge">${destaque.tempo}</span><span class="meta-badge age">${destaque.classificacao}</span>`;
  }else{
    meta.innerHTML = `<span class="meta-badge">${destaque.temporadas.length} temporada(s)</span><span class="meta-badge age">${destaque.classificacao}</span>`;
  }

  document.getElementById('heroPlayBtn').onclick = () => {
    if(isSerie){
      const s = destaque.temporadas[0];
      const e = s.episodios[0];
      abrirPlayer({ tipo:'serie', item: destaque, temporada: s.numero, episodio: e.numero, ep: e });
    }else{
      abrirPlayer({ tipo:'filme', item: destaque });
    }
  };
  document.getElementById('heroInfoBtn').onclick = () => abrirModalDetalhes(destaque, isSerie);
}

/* ---------------- Cards ---------------- */
function criarCardFilme(filme){
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-img-wrap">
      <img src="${filme.capa}" alt="${filme.titulo}" loading="lazy">
      <div class="card-play-icon">
        <svg width="42" height="42" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(4,6,12,0.55)" stroke="rgba(255,255,255,0.5)"/><path d="M10 8l6 4-6 4V8z" fill="#fff"/></svg>
      </div>
    </div>
    <div class="card-info">
      <h3>${filme.titulo}</h3>
      <div class="card-sub"><span class="card-badge">${filme.classificacao}</span><span>${filme.tempo}</span></div>
    </div>`;
  card.onclick = () => abrirModalDetalhes(filme, false);
  return card;
}

function criarCardSerie(serie){
  const prog = getProgressoSeries()[serie.id];
  let pctTxt = '';
  if(prog){
    const totalEps = serie.temporadas.reduce((acc,s)=>acc+s.episodios.length,0);
    let vistos = 0;
    for(const s of serie.temporadas){
      if(s.numero < prog.temporada) vistos += s.episodios.length;
      else if(s.numero === prog.temporada) vistos += prog.episodio;
    }
    pctTxt = `T${prog.temporada}:E${prog.episodio}`;
    var pct = Math.min(100, Math.round((vistos/totalEps)*100));
  }

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-img-wrap">
      <img src="${serie.capa}" alt="${serie.titulo}" loading="lazy">
      <div class="card-play-icon">
        <svg width="42" height="42" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(4,6,12,0.55)" stroke="rgba(255,255,255,0.5)"/><path d="M10 8l6 4-6 4V8z" fill="#fff"/></svg>
      </div>
      ${prog ? `<div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>` : ''}
    </div>
    <div class="card-info">
      <h3>${serie.titulo}</h3>
      <div class="card-sub"><span class="card-badge">${serie.classificacao}</span>${prog ? `<span>Continuar ${pctTxt}</span>` : `<span>${serie.temporadas.length} temporada(s)</span>`}</div>
    </div>`;
  card.onclick = () => abrirModalDetalhes(serie, true);
  return card;
}

function montarLinhaFilmes(){
  const track = document.getElementById('rowFilmes');
  track.innerHTML = '';
  FILMES.forEach(f => track.appendChild(criarCardFilme(f)));
}
function montarLinhaSeries(){
  const track = document.getElementById('rowSeries');
  track.innerHTML = '';
  SERIES.forEach(s => track.appendChild(criarCardSerie(s)));
}

function montarLinhaContinuar(){
  const lista = getContinuar();
  const section = document.getElementById('continuarSection');
  const track = document.getElementById('rowContinuar');
  track.innerHTML = '';
  if(lista.length === 0){ section.style.display = 'none'; return; }

  lista.forEach(item => {
    const fonte = item.tipo === 'filme' ? FILMES : SERIES;
    const obj = fonte.find(x => x.id === item.id);
    if(!obj) return;
    track.appendChild(item.tipo === 'filme' ? criarCardFilme(obj) : criarCardSerie(obj));
  });
  section.style.display = track.children.length ? 'block' : 'none';
}

function montarLinhaRecomendados(){
  const track = document.getElementById('rowRecomendados');
  track.innerHTML = '';

  // Recomendação simples baseada em tags dos itens já vistos (continuar assistindo)
  const vistos = getContinuar();
  const tagsVistas = new Set();
  vistos.forEach(v => {
    const fonte = v.tipo === 'filme' ? FILMES : SERIES;
    const obj = fonte.find(x => x.id === v.id);
    (obj?.tags || []).forEach(t => tagsVistas.add(t));
  });

  const todos = [...FILMES.map(f=>({...f, _tipo:'filme'})), ...SERIES.map(s=>({...s, _tipo:'serie'}))];
  let recomendados;
  if(tagsVistas.size){
    recomendados = todos.filter(item => item.tags?.some(t => tagsVistas.has(t)));
  }
  if(!recomendados || recomendados.length === 0){
    recomendados = todos; // fallback: mostra tudo
  }

  recomendados.slice(0, 10).forEach(item => {
    track.appendChild(item._tipo === 'filme' ? criarCardFilme(item) : criarCardSerie(item));
  });
}

/* ---------------- Modal de detalhes ---------------- */
function abrirModalDetalhes(item, isSerie){
  const modal = document.getElementById('detailModal');
  document.getElementById('modalBanner').style.backgroundImage = `url('${item.capa}')`;
  document.getElementById('modalTitle').textContent = item.titulo;
  document.getElementById('modalDesc').textContent = item.descricao;

  const meta = document.getElementById('modalMeta');
  meta.innerHTML = isSerie
    ? `<span class="meta-badge">${item.temporadas.length} temporada(s)</span><span class="meta-badge age">${item.classificacao}</span>`
    : `<span class="meta-badge">${item.tempo}</span><span class="meta-badge age">${item.classificacao}</span>`;

  const tagsWrap = document.getElementById('modalTags');
  tagsWrap.innerHTML = (item.tags || []).map(t => `<span class="tag-pill">${t}</span>`).join('');

  const playBtn = document.getElementById('modalPlayBtn');
  const seasonsWrap = document.getElementById('seasonsWrap');

  if(isSerie){
    seasonsWrap.style.display = 'block';
    const prog = getProgressoSeries()[item.id];
    const temporadaInicial = prog ? prog.temporada : item.temporadas[0].numero;
    montarSeletorTemporadas(item, temporadaInicial);

    playBtn.textContent = prog ? `Continuar T${prog.temporada}:E${prog.episodio}` : 'Assistir agora';
    playBtn.querySelector?.('svg')?.remove();
    playBtn.onclick = () => {
      const t = prog ? prog.temporada : item.temporadas[0].numero;
      const temporada = item.temporadas.find(s => s.numero === t) || item.temporadas[0];
      const epNum = prog ? prog.episodio : temporada.episodios[0].numero;
      const ep = temporada.episodios.find(e => e.numero === epNum) || temporada.episodios[0];
      abrirPlayer({ tipo:'serie', item, temporada: temporada.numero, episodio: ep.numero, ep });
    };
  }else{
    seasonsWrap.style.display = 'none';
    playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 5v14l11-7z" fill="currentColor"/></svg> Assistir agora`;
    playBtn.onclick = () => abrirPlayer({ tipo:'filme', item });
  }

  modal.classList.add('open');
}

function montarSeletorTemporadas(serie, temporadaAtiva){
  const seletor = document.getElementById('seasonSelector');
  seletor.innerHTML = '';
  serie.temporadas.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'season-btn' + (s.numero === temporadaAtiva ? ' active' : '');
    btn.textContent = `Temporada ${s.numero}`;
    btn.onclick = () => {
      seletor.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      montarListaEpisodios(serie, s);
    };
    seletor.appendChild(btn);
  });
  const temporadaObj = serie.temporadas.find(s => s.numero === temporadaAtiva) || serie.temporadas[0];
  montarListaEpisodios(serie, temporadaObj);
}

function montarListaEpisodios(serie, temporada){
  const lista = document.getElementById('episodeList');
  lista.innerHTML = '';
  const prog = getProgressoSeries()[serie.id];

  temporada.episodios.forEach(ep => {
    const jaVisto = prog && prog.temporada === temporada.numero && prog.episodio >= ep.numero;
    const div = document.createElement('div');
    div.className = 'episode-item' + (jaVisto ? ' watched' : '');
    div.innerHTML = `
      <div class="episode-thumb">
        <img src="https://img.youtube.com/vi/${ep.youtubeId}/mqdefault.jpg" alt="${ep.titulo}">
        <span class="episode-num">E${ep.numero}</span>
      </div>
      <div class="episode-meta">
        <h4>${ep.titulo}</h4>
        <p>${ep.duracao} • ${ep.descricao}</p>
      </div>
      ${jaVisto ? '<span class="episode-check">✔</span>' : ''}
    `;
    div.onclick = () => abrirPlayer({ tipo:'serie', item: serie, temporada: temporada.numero, episodio: ep.numero, ep });
    lista.appendChild(div);
  });
}

document.getElementById('closeDetailModal').onclick = () => {
  document.getElementById('detailModal').classList.remove('open');
};
document.getElementById('detailModal').addEventListener('click', (e) => {
  if(e.target.id === 'detailModal') e.currentTarget.classList.remove('open');
});

/* ---------------- YouTube Player ---------------- */
function onYouTubeIframeAPIReady(){
  ytReady = true;
  ytPlayer = new YT.Player('ytPlayer', {
    playerVars: {
      autoplay: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1
    },
    events: {
      onStateChange: onPlayerStateChange
    }
  });
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

function onPlayerStateChange(event){
  // Quando o vídeo termina (0), avança progresso de série
  if(event.data === YT.PlayerState.ENDED && currentPlayback?.tipo === 'serie'){
    avancarEpisodio();
  }
}

function abrirPlayer({ tipo, item, temporada, episodio, ep }){
  const overlay = document.getElementById('playerOverlay');
  const titleEl = document.getElementById('playerTitle');
  document.getElementById('detailModal').classList.remove('open');

  let youtubeId, titulo;
  if(tipo === 'filme'){
    youtubeId = item.youtubeId;
    titulo = item.titulo;
    marcarContinuar({ tipo:'filme', id: item.id });
  }else{
    youtubeId = ep.youtubeId;
    titulo = `${item.titulo} — T${temporada}:E${episodio} ${ep.titulo}`;
    setProgressoSerie(item.id, temporada, episodio);
    marcarContinuar({ tipo:'serie', id: item.id });
  }

  currentPlayback = { tipo, item, temporada, episodio, youtubeId };
  titleEl.textContent = titulo;
  overlay.classList.add('open');

  const tentarCarregar = () => {
    if(ytReady && ytPlayer && ytPlayer.loadVideoById){
      ytPlayer.loadVideoById(youtubeId);
    }else{
      setTimeout(tentarCarregar, 200);
    }
  };
  tentarCarregar();

  montarLinhaContinuar();
  montarLinhaRecomendados();
  if(tipo === 'serie') montarLinhaSeries();
}

function avancarEpisodio(){
  const { item, temporada, episodio } = currentPlayback;
  const temporadaObj = item.temporadas.find(s => s.numero === temporada);
  const proxEp = temporadaObj.episodios.find(e => e.numero === episodio + 1);
  if(proxEp){
    abrirPlayer({ tipo:'serie', item, temporada, episodio: proxEp.numero, ep: proxEp });
    return;
  }
  const proxTemporada = item.temporadas.find(s => s.numero === temporada + 1);
  if(proxTemporada){
    const primeiroEp = proxTemporada.episodios[0];
    abrirPlayer({ tipo:'serie', item, temporada: proxTemporada.numero, episodio: primeiroEp.numero, ep: primeiroEp });
  }
}

function fecharPlayer(){
  document.getElementById('playerOverlay').classList.remove('open');
  if(ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  sairTelaCheia();
  currentPlayback = null;
}
document.getElementById('playerBack').onclick = fecharPlayer;

/* ---------------- Tela cheia + rotação (mobile) ---------------- */
const frameWrap = document.getElementById('playerFrameWrap');

async function alternarTelaCheia(){
  if(!document.fullscreenElement){
    try{
      await frameWrap.requestFullscreen();
      // Tenta deitar a tela automaticamente em celulares
      if(screen.orientation && screen.orientation.lock){
        try{ await screen.orientation.lock('landscape'); }catch(e){ /* alguns navegadores negam fora de PWA */ }
      }
    }catch(e){ console.warn('Não foi possível entrar em tela cheia:', e); }
  }else{
    await document.exitFullscreen();
  }
}
document.getElementById('playerFullscreen').onclick = alternarTelaCheia;

function sairTelaCheia(){
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
}

document.addEventListener('fullscreenchange', () => {
  if(!document.fullscreenElement && screen.orientation && screen.orientation.unlock){
    screen.orientation.unlock();
  }
});

/* ---------------- Header scroll + menu mobile ---------------- */
window.addEventListener('scroll', () => {
  document.getElementById('header').classList.toggle('scrolled', window.scrollY > 30);
});

document.getElementById('menuToggle').onclick = () => {
  document.getElementById('mainNav').classList.toggle('open');
};

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    document.getElementById('mainNav').classList.remove('open');

    const alvo = link.dataset.target;
    const mapa = {
      home: 'hero',
      filmes: 'filmesSection',
      series: 'seriesSection',
      continuar: 'continuarSection',
      recomendados: 'recomendadosSection'
    };
    const el = document.getElementById(mapa[alvo]);
    if(el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  });
});

/* ---------------- Busca ---------------- */
document.getElementById('searchInput').addEventListener('input', (e) => {
  const termo = e.target.value.trim().toLowerCase();
  const filtrarFilmes = termo ? FILMES.filter(f => f.titulo.toLowerCase().includes(termo)) : FILMES;
  const filtrarSeries = termo ? SERIES.filter(s => s.titulo.toLowerCase().includes(termo)) : SERIES;

  const trackF = document.getElementById('rowFilmes');
  const trackS = document.getElementById('rowSeries');
  trackF.innerHTML = ''; trackS.innerHTML = '';
  filtrarFilmes.forEach(f => trackF.appendChild(criarCardFilme(f)));
  filtrarSeries.forEach(s => trackS.appendChild(criarCardSerie(s)));

  if(termo){
    trackF.parentElement.querySelector('.row-title').textContent = `Filmes — resultados para "${termo}"`;
    trackS.parentElement.querySelector('.row-title').textContent = `Séries — resultados para "${termo}"`;
  }else{
    trackF.parentElement.querySelector('.row-title').textContent = 'Filmes';
    trackS.parentElement.querySelector('.row-title').textContent = 'Séries';
  }
});

/* ---------------- Init ---------------- */
carregarDados();
