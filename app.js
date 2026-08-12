/* ============================================================
   PLAYMAX — script.js
   ============================================================ */

const STORAGE_KEYS = {
  progressoSeries: 'playmax_progresso_series', // ultimo ep visto por serie
  continuarLista: 'playmax_continuar',         // lista geral (filmes+series) p/ "continuar assistindo"
  buscasLista: 'playmax_buscas',               // itens abertos a partir de uma busca (p/ destaque)
};

let FILMES = [];
let SERIES = [];
let ytPlayer = null;
let ytReady = false;
let currentPlayback = null; // { tipo, id, titulo, youtubeId, temporada, episodio }

/* ---------------- Estado dos filtros ---------------- */
let filtroTipo = 'todos';           // 'todos' | 'filme' | 'serie'
let filtrosGenero = new Set();      // tags selecionadas
let ordenacao = 'padrao';           // 'padrao' | 'az' | 'za'
let termoBusca = '';

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

function getBuscas(){
  try{ return JSON.parse(localStorage.getItem(STORAGE_KEYS.buscasLista)) || []; }
  catch(e){ return []; }
}
function marcarBusca(item){
  // item: { tipo:'filme'|'serie', id, quando } — registrado quando o item é aberto a partir de uma busca
  let lista = getBuscas().filter(i => !(i.tipo === item.tipo && i.id === item.id));
  lista.unshift({ ...item, quando: Date.now() });
  lista = lista.slice(0, 20);
  localStorage.setItem(STORAGE_KEYS.buscasLista, JSON.stringify(lista));
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
  montarChipsGenero();
  aplicarFiltros();
  montarLinhaContinuar();
  montarLinhaRecomendados();
}

/* ---------------- HERO ---------------- */
function escolherDestaque(){
  // Destaque é sempre um filme: prioriza o mais recente entre "assistido" e "buscado".
  if(FILMES.length){
    const assistidos = getContinuar().filter(i => i.tipo === 'filme');
    const buscados = getBuscas().filter(i => i.tipo === 'filme');
    const combinados = [...assistidos, ...buscados].sort((a,b) => b.quando - a.quando);

    for(const registro of combinados){
      const filme = FILMES.find(f => f.id === registro.id);
      if(filme){
        const origem = assistidos.includes(registro) ? 'assistido' : 'buscado';
        return { item: filme, isSerie: false, origem };
      }
    }
    return { item: FILMES[0], isSerie: false, origem: 'padrao' };
  }
  // fallback apenas se não houver nenhum filme no catálogo
  if(SERIES.length) return { item: SERIES[0], isSerie: true, origem: 'padrao' };
  return null;
}

function montarHero(){
  const destaque = escolherDestaque();
  if(!destaque) return;
  const { item, isSerie, origem } = destaque;

  const tags = {
    assistido: 'CONTINUE ASSISTINDO',
    buscado: 'EM ALTA NA BUSCA',
    padrao: isSerie ? 'SÉRIE EM DESTAQUE' : 'FILME EM DESTAQUE',
  };

  document.getElementById('heroBg').style.backgroundImage = `url('${item.capa}')`;
  document.getElementById('heroTag').textContent = tags[origem];
  document.getElementById('heroTitle').textContent = item.titulo;
  document.getElementById('heroDesc').textContent = item.descricao;

  const meta = document.getElementById('heroMeta');
  meta.innerHTML = '';
  if(!isSerie){
    meta.innerHTML = `<span class="meta-badge">${item.tempo}</span><span class="meta-badge age">${item.classificacao}</span>`;
  }else{
    meta.innerHTML = `<span class="meta-badge">${item.temporadas.length} temporada(s)</span><span class="meta-badge age">${item.classificacao}</span>`;
  }

  document.getElementById('heroPlayBtn').onclick = () => {
    if(isSerie){
      const s = item.temporadas[0];
      const e = s.episodios[0];
      abrirPlayer({ tipo:'serie', item, temporada: s.numero, episodio: e.numero, ep: e });
    }else{
      abrirPlayer({ tipo:'filme', item });
    }
  };
  document.getElementById('heroInfoBtn').onclick = () => abrirModalDetalhes(item, isSerie);
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
      <div class="card-sub"><span class="card-badge">${filme.classificacao}</span><span>${filme.tempo}</span>${filme.tags && filme.tags[0] ? `<span class="card-tag">${filme.tags[0]}</span>` : ''}</div>
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
      <div class="card-sub"><span class="card-badge">${serie.classificacao}</span>${prog ? `<span>Continuar ${pctTxt}</span>` : `<span>${serie.temporadas.length} temporada(s)</span>`}${serie.tags && serie.tags[0] ? `<span class="card-tag">${serie.tags[0]}</span>` : ''}</div>
    </div>`;
  card.onclick = () => abrirModalDetalhes(serie, true);
  return card;
}

function montarLinhaFilmes(){
  aplicarFiltros();
}
function montarLinhaSeries(){
  aplicarFiltros();
}

/* ---------------- Filtros, ordenação e busca ---------------- */
function montarChipsGenero(){
  const generos = new Set();
  [...FILMES, ...SERIES].forEach(item => (item.tags || []).forEach(t => generos.add(t)));
  const wrap = document.getElementById('filterGenres');
  if(!wrap) return;
  wrap.innerHTML = '';
  [...generos].sort((a,b) => a.localeCompare(b, 'pt-BR')).forEach(genero => {
    const chip = document.createElement('button');
    chip.className = 'genre-chip';
    chip.type = 'button';
    chip.textContent = genero;
    chip.onclick = () => {
      chip.classList.toggle('active');
      if(chip.classList.contains('active')) filtrosGenero.add(genero);
      else filtrosGenero.delete(genero);
      aplicarFiltros();
    };
    wrap.appendChild(chip);
  });
}

function ordenarLista(lista){
  if(ordenacao === 'az') return [...lista].sort((a,b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
  if(ordenacao === 'za') return [...lista].sort((a,b) => b.titulo.localeCompare(a.titulo, 'pt-BR'));
  return lista;
}

function passaFiltros(item){
  if(filtrosGenero.size && !(item.tags || []).some(t => filtrosGenero.has(t))) return false;
  if(termoBusca && !item.titulo.toLowerCase().includes(termoBusca)) return false;
  return true;
}

function atualizarMensagemVazia(track, temResultados){
  const anterior = track.parentElement.querySelector('.empty-msg');
  if(anterior) anterior.remove();
  if(!temResultados){
    const msg = document.createElement('p');
    msg.className = 'empty-msg';
    msg.textContent = 'Nenhum título encontrado com esses filtros.';
    track.after(msg);
  }
}

function aplicarFiltros(){
  const filmesSection = document.getElementById('filmesSection');
  const seriesSection = document.getElementById('seriesSection');
  const trackF = document.getElementById('rowFilmes');
  const trackS = document.getElementById('rowSeries');

  const mostraFilmes = filtroTipo === 'todos' || filtroTipo === 'filme';
  const mostraSeries = filtroTipo === 'todos' || filtroTipo === 'serie';

  filmesSection.style.display = mostraFilmes ? '' : 'none';
  seriesSection.style.display = mostraSeries ? '' : 'none';

  if(mostraFilmes){
    const lista = ordenarLista(FILMES.filter(passaFiltros));
    trackF.innerHTML = '';
    lista.forEach(f => trackF.appendChild(criarCardFilme(f)));
    filmesSection.querySelector('.row-title-text').textContent = termoBusca ? `Filmes — resultados para "${termoBusca}"` : 'Filmes';
    document.getElementById('countFilmes').textContent = `${lista.length} título${lista.length === 1 ? '' : 's'}`;
    atualizarMensagemVazia(trackF, lista.length > 0);
  }
  if(mostraSeries){
    const lista = ordenarLista(SERIES.filter(passaFiltros));
    trackS.innerHTML = '';
    lista.forEach(s => trackS.appendChild(criarCardSerie(s)));
    seriesSection.querySelector('.row-title-text').textContent = termoBusca ? `Séries — resultados para "${termoBusca}"` : 'Séries';
    document.getElementById('countSeries').textContent = `${lista.length} título${lista.length === 1 ? '' : 's'}`;
    atualizarMensagemVazia(trackS, lista.length > 0);
  }
}

document.querySelectorAll('#filterTypes .filter-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#filterTypes .filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filtroTipo = btn.dataset.tipo;
    aplicarFiltros();
  });
});

document.getElementById('sortSelect').addEventListener('change', (e) => {
  ordenacao = e.target.value;
  aplicarFiltros();
});

document.getElementById('filterClear').addEventListener('click', () => {
  filtroTipo = 'todos';
  filtrosGenero.clear();
  ordenacao = 'padrao';
  termoBusca = '';

  document.getElementById('searchInput').value = '';
  document.getElementById('sortSelect').value = 'padrao';
  document.querySelectorAll('#filterTypes .filter-pill').forEach(b => b.classList.toggle('active', b.dataset.tipo === 'todos'));
  document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));

  aplicarFiltros();
});

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
  document.getElementById('countContinuar').textContent = `${track.children.length} título${track.children.length === 1 ? '' : 's'}`;
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
  document.getElementById('countRecomendados').textContent = `${track.children.length} título${track.children.length === 1 ? '' : 's'}`;
}

/* ---------------- Modal de detalhes ---------------- */
function abrirModalDetalhes(item, isSerie){
  if(termoBusca){
    marcarBusca({ tipo: isSerie ? 'serie' : 'filme', id: item.id });
    montarHero();
  }

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
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange
    }
  });
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

function onPlayerReady(){
  mostrarCarregando(false);
}

function onPlayerStateChange(event){
  // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
  if(event.data === YT.PlayerState.PLAYING){
    mostrarCarregando(false);
  }
  if(event.data === YT.PlayerState.BUFFERING){
    mostrarCarregando(true);
  }
  // Quando o vídeo termina (0), avança progresso de série
  if(event.data === YT.PlayerState.ENDED && currentPlayback?.tipo === 'serie'){
    avancarEpisodio();
  }
}

function mostrarCarregando(mostrar){
  const loading = document.getElementById('playerLoading');
  if(loading) loading.classList.toggle('show', !!mostrar);
}

function abrirPlayer({ tipo, item, temporada, episodio, ep }){
  const overlay = document.getElementById('playerOverlay');
  const titleEl = document.getElementById('playerTitle');
  document.getElementById('detailModal').classList.remove('open');

  // No celular, entra automaticamente em tela cheia deitada já aqui, dentro do
  // mesmo gesto de clique do usuário (exigido pelas APIs de Fullscreen/Orientation).
  // No desktop mantemos o comportamento manual (botão de tela cheia).
  if(isMobileDevice()) entrarModoCine();

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
  document.body.classList.add('player-open');
  mostrarCarregando(true);
  mostrarControles();

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
  montarHero();
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
  document.body.classList.remove('player-open');
  if(ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  sairModoCine();
  currentPlayback = null;
}
document.getElementById('playerBack').onclick = fecharPlayer;

/* ---------------- Tela cheia + rotação (mobile) ---------------- */
const playerOverlay = document.getElementById('playerOverlay');
const frameWrap = document.getElementById('playerFrameWrap');
const rotateHint = document.getElementById('playerRotateHint');
let telaCheiaAtiva = false; // controlada por nós (true assim que o player abre no celular)

function isMobileDevice(){
  const uaMovel = /Android|iPhone|iPad|iPod|Mobile|webOS/i.test(navigator.userAgent);
  const telaEstreita = Math.min(window.innerWidth, window.innerHeight) <= 900;
  const semMouse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return uaMovel || (semMouse && telaEstreita);
}

function pedirElementoFullscreen(el){
  const metodo = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitEnterFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if(metodo) return metodo.call(el);
  return Promise.reject(new Error('Fullscreen API indisponível'));
}

function sairFullscreenNativo(){
  const sair = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if(sair && (document.fullscreenElement || document.webkitFullscreenElement)) return sair.call(document);
  return Promise.resolve();
}

// Chamada assim que o player abre (dentro do gesto de clique do usuário) para tentar
// deixar a experiência em tela cheia e deitada automaticamente, sem depender do
// usuário tocar num botão extra. Cobre Android (Fullscreen API + Orientation Lock)
// e cai num fallback via CSS quando o navegador não suporta essas APIs (ex: iOS Safari).
async function entrarModoCine(){
  telaCheiaAtiva = true;
  atualizarIconeFullscreen();

  try{
    await pedirElementoFullscreen(playerOverlay);
  }catch(e){ /* navegador não suporta (ex: iOS Safari) — segue com o fallback CSS abaixo */ }

  if(isMobileDevice() && screen.orientation && screen.orientation.lock){
    try{ await screen.orientation.lock('landscape'); }
    catch(e){ /* navegador recusou (ex: fora de PWA) — o fallback CSS cobre isso */ }
  }

  aplicarRotacaoForcada();
}

async function sairModoCine(){
  telaCheiaAtiva = false;
  atualizarIconeFullscreen();
  await sairFullscreenNativo().catch(()=>{});
  if(screen.orientation && screen.orientation.unlock){
    try{ screen.orientation.unlock(); }catch(e){}
  }
  playerOverlay.classList.remove('forced-landscape');
  rotateHint.classList.remove('show');
}

// Fallback: quando o celular ficou em pé e não temos Fullscreen/Orientation nativos
// funcionando (ex: iOS Safari), giramos o próprio player via CSS para simular a
// tela cheia deitada.
function aplicarRotacaoForcada(){
  if(!isMobileDevice() || !playerOverlay.classList.contains('open')){
    playerOverlay.classList.remove('forced-landscape');
    rotateHint.classList.remove('show');
    return;
  }
  const emPe = window.innerHeight > window.innerWidth;
  const conseguiuNativo = !!(document.fullscreenElement || document.webkitFullscreenElement) &&
                           !!(screen.orientation && /landscape/i.test(screen.orientation.type || ''));

  if(emPe && !conseguiuNativo){
    playerOverlay.classList.add('forced-landscape');
    if(!rotateHint.classList.contains('show')){
      rotateHint.classList.add('show');
      clearTimeout(rotateHint._timer);
      rotateHint._timer = setTimeout(() => rotateHint.classList.remove('show'), 4000);
    }
  }else{
    playerOverlay.classList.remove('forced-landscape');
    rotateHint.classList.remove('show');
  }
}

function atualizarIconeFullscreen(){
  const btn = document.getElementById('playerFullscreen');
  if(!btn) return;
  btn.innerHTML = telaCheiaAtiva
    ? `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

async function alternarTelaCheia(){
  if(!telaCheiaAtiva){
    await entrarModoCine();
  }else{
    await sairModoCine();
  }
}
document.getElementById('playerFullscreen').onclick = alternarTelaCheia;

window.addEventListener('resize', () => aplicarRotacaoForcada());
window.addEventListener('orientationchange', () => setTimeout(aplicarRotacaoForcada, 150));

document.addEventListener('fullscreenchange', () => {
  const emFullscreenNativo = !!document.fullscreenElement;
  aplicarRotacaoForcada();
  // No celular, se o usuário saiu da tela cheia nativa por fora (ex: botão de
  // voltar do sistema/navegador no Android), encerramos o player por completo —
  // no desktop apenas voltamos ao modo janela sem fechar o player.
  if(!emFullscreenNativo && telaCheiaAtiva && isMobileDevice() && playerOverlay.classList.contains('open')){
    fecharPlayer();
  }else if(!emFullscreenNativo){
    telaCheiaAtiva = false;
    atualizarIconeFullscreen();
  }
});

/* ---------------- Auto-ocultar controles do player ---------------- */
let ocultarControlesTimer = null;
function mostrarControles(){
  playerOverlay.classList.remove('controls-hidden');
  clearTimeout(ocultarControlesTimer);
  ocultarControlesTimer = setTimeout(() => {
    playerOverlay.classList.add('controls-hidden');
  }, 3200);
}
frameWrap.addEventListener('click', mostrarControles);
frameWrap.addEventListener('touchstart', mostrarControles, { passive: true });

document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && playerOverlay.classList.contains('open')){
    fecharPlayer();
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
  termoBusca = e.target.value.trim().toLowerCase();
  aplicarFiltros();
});

/* ---------------- Init ---------------- */
carregarDados();