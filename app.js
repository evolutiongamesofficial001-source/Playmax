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
let currentDetalheItem = null; // id do item aberto no momento no modal de detalhes

/* ============================================================
   CONTAS (e-mail/senha) + AVALIAÇÕES — Firebase Realtime Database
   ============================================================
   Duas instâncias separadas do RTDB são usadas via REST puro (sem SDK/API
   key), então as regras dessas bases precisam permitir leitura/escrita
   pública (".read": true, ".write": true) — não existe uma camada de
   segurança de servidor aqui além disso. As senhas são guardadas com hash
   SHA-256 (nunca em texto puro), mas isso NÃO substitui o Firebase
   Authentication de verdade: qualquer pessoa com a URL do banco consegue ler
   os registros. Para um produto real, o ideal é migrar para o Firebase
   Authentication (com apiKey) + regras de segurança no RTDB.
   ============================================================ */
const AUTH_DB_URL = 'https://conta-free-default-rtdb.firebaseio.com';
const RATINGS_DB_URL = 'https://qwertyuiop-d7693-default-rtdb.firebaseio.com';
const SESSAO_KEY = 'playmax_sessao';

let usuarioAtual = null; // { email, chave }
let AVALIACOES = {};     // { itemId: { chaveUsuario: { nota, quando } } }

function chaveFirebase(texto){
  // RTDB não aceita . # $ [ ] em chaves
  return texto.toLowerCase().trim().replace(/[.#$\[\]]/g, '_');
}

async function sha256Hex(texto){
  const buffer = new TextEncoder().encode(texto);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getSessao(){
  try{ return JSON.parse(localStorage.getItem(SESSAO_KEY)); }
  catch(e){ return null; }
}
function setSessao(sessao){
  if(sessao) localStorage.setItem(SESSAO_KEY, JSON.stringify(sessao));
  else localStorage.removeItem(SESSAO_KEY);
}

async function cadastrarUsuario(email, senha){
  const chave = chaveFirebase(email);
  const resExistente = await fetch(`${AUTH_DB_URL}/usuarios/${chave}.json`);
  if(!resExistente.ok) throw new Error('Não foi possível conectar à base de contas (verifique as regras do Realtime Database).');
  const existente = await resExistente.json();
  if(existente) throw new Error('Já existe uma conta com esse e-mail.');

  const senhaHash = await sha256Hex(senha);
  const registro = { email: email.trim(), senhaHash, criadoEm: Date.now() };
  const res = await fetch(`${AUTH_DB_URL}/usuarios/${chave}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(registro)
  });
  if(!res.ok) throw new Error(res.status === 401 || res.status === 403
    ? 'O banco de contas está recusando a escrita (regras de segurança bloqueando gravação pública).'
    : 'Não foi possível criar a conta agora. Tente novamente.');
  return { email: registro.email, chave };
}

async function entrarUsuario(email, senha){
  const chave = chaveFirebase(email);
  const res = await fetch(`${AUTH_DB_URL}/usuarios/${chave}.json`);
  if(!res.ok) throw new Error('Não foi possível conectar à conta agora.');
  const registro = await res.json();
  if(!registro) throw new Error('E-mail ou senha inválidos.');
  const senhaHash = await sha256Hex(senha);
  if(senhaHash !== registro.senhaHash) throw new Error('E-mail ou senha inválidos.');
  return { email: registro.email, chave, apelido: registro.apelido || null };
}

function aplicarSessaoNaUI(){
  const avatar = document.getElementById('accountAvatar');
  const label = document.getElementById('accountLabel');
  const navConta = document.getElementById('navConta');
  if(usuarioAtual){
    const nome = usuarioAtual.apelido || usuarioAtual.email.split('@')[0];
    avatar.textContent = nome[0];
    label.textContent = nome;
    navConta.style.display = '';
  }else{
    avatar.textContent = '?';
    label.textContent = 'Entrar';
    navConta.style.display = 'none';
    if(document.getElementById('contaSection').style.display !== 'none') fecharPaginaConta();
  }
}

function iniciarSessao(usuario){
  usuarioAtual = { ...usuario, desde: usuario.desde || Date.now() };
  setSessao(usuarioAtual);
  aplicarSessaoNaUI();
}
function encerrarSessao(){
  usuarioAtual = null;
  setSessao(null);
  aplicarSessaoNaUI();
}

/* ---------------- Avaliações (estrelas) ---------------- */
async function carregarAvaliacoes(){
  try{
    const res = await fetch(`${RATINGS_DB_URL}/avaliacoes.json`);
    if(!res.ok){
      console.error('Firebase (avaliações) recusou a leitura — status', res.status, '— verifique as regras do Realtime Database (precisam permitir leitura pública).');
      AVALIACOES = {};
      return;
    }
    const dados = await res.json();
    AVALIACOES = (dados && typeof dados === 'object') ? dados : {};
  }catch(e){
    console.error('Erro ao carregar avaliações:', e);
    AVALIACOES = {};
  }
}

function mediaAvaliacoes(itemId){
  const registros = AVALIACOES[itemId];
  if(!registros) return { media: 0, total: 0, notaUsuario: 0 };
  const notas = Object.values(registros).map(r => r.nota);
  const total = notas.length;
  const media = total ? notas.reduce((a,b) => a+b, 0) / total : 0;
  const notaUsuario = usuarioAtual && registros[usuarioAtual.chave] ? registros[usuarioAtual.chave].nota : 0;
  return { media, total, notaUsuario };
}

async function avaliarItem(itemId, nota){
  if(!usuarioAtual){ abrirAuthModal('login'); return; }
  const notaAnterior = AVALIACOES[itemId]?.[usuarioAtual.chave];
  if(!AVALIACOES[itemId]) AVALIACOES[itemId] = {};
  AVALIACOES[itemId][usuarioAtual.chave] = { nota, quando: Date.now() };
  // Atualiza a UI otimisticamente enquanto salva
  renderStarsInput(itemId);
  renderAllStarDisplays();
  try{
    const res = await fetch(`${RATINGS_DB_URL}/avaliacoes/${itemId}/${usuarioAtual.chave}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nota, quando: Date.now() })
    });
    if(!res.ok){
      throw new Error(res.status === 401 || res.status === 403
        ? 'O banco de dados de avaliações está recusando a escrita (regras de segurança bloqueando gravação pública).'
        : `Falha ao salvar (status ${res.status}).`);
    }
  }catch(e){
    console.error('Erro ao salvar avaliação:', e);
    // Desfaz a mudança otimista, já que não foi salva de verdade
    if(notaAnterior) AVALIACOES[itemId][usuarioAtual.chave] = notaAnterior;
    else delete AVALIACOES[itemId][usuarioAtual.chave];
    renderStarsInput(itemId);
    renderAllStarDisplays();
    mostrarErroAvaliacao(e.message);
    return;
  }
  // Atualiza qualquer UI de avaliação visível no momento
  renderStarsInput(itemId);
  renderAllStarDisplays();
  if(currentDetalheItem === itemId){
    const { media, total } = mediaAvaliacoes(itemId);
    document.getElementById('modalRatingCount').textContent = total ? `${media.toFixed(1)} · ${total} avaliação${total===1?'':'ões'}` : 'Ainda sem avaliações';
  }
}

function mostrarErroAvaliacao(msg){
  const bloco = document.getElementById('modalRatingBlock');
  if(!bloco) return;
  let erroEl = bloco.querySelector('.rating-erro');
  if(!erroEl){
    erroEl = document.createElement('p');
    erroEl.className = 'rating-erro';
    bloco.appendChild(erroEl);
  }
  erroEl.textContent = `Não foi possível salvar sua avaliação: ${msg}`;
  clearTimeout(erroEl._t);
  erroEl._t = setTimeout(() => erroEl.remove(), 7000);
}

async function removerAvaliacao(itemId){
  if(!usuarioAtual || !AVALIACOES[itemId]?.[usuarioAtual.chave]) return;
  const anterior = AVALIACOES[itemId][usuarioAtual.chave];
  delete AVALIACOES[itemId][usuarioAtual.chave];
  renderAllStarDisplays();
  if(currentDetalheItem === itemId) renderStarsInput(itemId);
  montarPaginaConta();
  try{
    const res = await fetch(`${RATINGS_DB_URL}/avaliacoes/${itemId}/${usuarioAtual.chave}.json`, { method: 'DELETE' });
    if(!res.ok) throw new Error(`status ${res.status}`);
  }catch(e){
    console.error('Erro ao remover avaliação:', e);
    AVALIACOES[itemId][usuarioAtual.chave] = anterior;
    renderAllStarDisplays();
    if(currentDetalheItem === itemId) renderStarsInput(itemId);
    montarPaginaConta();
  }
}

async function apagarConta(){
  if(!usuarioAtual) return;
  const res = await fetch(`${AUTH_DB_URL}/usuarios/${usuarioAtual.chave}.json`, { method: 'DELETE' });
  if(!res.ok) throw new Error('Não foi possível apagar a conta agora.');
  encerrarSessao();
}

async function salvarApelido(apelido){
  if(!usuarioAtual) return;
  const res = await fetch(`${AUTH_DB_URL}/usuarios/${usuarioAtual.chave}.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apelido })
  });
  if(!res.ok) throw new Error('Não foi possível salvar o apelido agora.');
  usuarioAtual.apelido = apelido;
  setSessao(usuarioAtual);
  aplicarSessaoNaUI();
}

/* HTML de estrelas "somente leitura" (média) usado nos cards, hero e modal */
function starsDisplayHTML(itemId, { comContagem = true } = {}){
  const { media, total } = mediaAvaliacoes(itemId);
  if(total === 0 && !comContagem) return '';
  const pct = Math.round((media / 5) * 100);
  return `
    <span class="stars-display" data-item-rating="${itemId}">
      <span class="stars-fill" style="width:${pct}%"></span>
    </span>
    ${comContagem ? `<span class="rating-count">${total ? `${media.toFixed(1)} · ${total} avaliação${total===1?'':'ões'}` : 'Ainda sem avaliações'}</span>` : ''}
  `;
}

function renderAllStarDisplays(){
  document.querySelectorAll('[data-rerender-rating]').forEach(el => {
    const itemId = el.dataset.rerenderRating;
    el.innerHTML = starsDisplayHTML(itemId, { comContagem: el.dataset.comContagem !== 'false' });
  });
}

function renderStarsInput(itemId){
  const wrap = document.getElementById('modalStarsInput');
  if(!wrap) return;
  const { notaUsuario } = mediaAvaliacoes(itemId);
  wrap.innerHTML = '';
  if(!usuarioAtual){
    const hint = document.createElement('button');
    hint.type = 'button';
    hint.className = 'rating-login-hint';
    hint.style.background = 'none';
    hint.style.color = 'var(--blue-light)';
    hint.style.fontWeight = '700';
    hint.textContent = 'Entrar para avaliar';
    hint.onclick = () => abrirAuthModal('login');
    wrap.appendChild(hint);
    return;
  }
  for(let i = 1; i <= 5; i++){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '★';
    btn.className = i <= notaUsuario ? 'filled' : '';
    btn.onclick = () => avaliarItem(itemId, i);
    wrap.appendChild(btn);
  }
}

async function alterarSenha(senhaAtual, novaSenha){
  if(!usuarioAtual) throw new Error('Você precisa estar logado.');
  const res = await fetch(`${AUTH_DB_URL}/usuarios/${usuarioAtual.chave}.json`);
  const registro = await res.json();
  if(!registro) throw new Error('Conta não encontrada.');
  const hashAtual = await sha256Hex(senhaAtual);
  if(hashAtual !== registro.senhaHash) throw new Error('Senha atual incorreta.');
  const novoHash = await sha256Hex(novaSenha);
  const resUp = await fetch(`${AUTH_DB_URL}/usuarios/${usuarioAtual.chave}.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senhaHash: novoHash })
  });
  if(!resUp.ok) throw new Error('Não foi possível salvar a nova senha agora.');
}

/* ---------------- Página "Minha conta" ---------------- */
function montarPaginaConta(){
  if(!usuarioAtual) return;
  const nome = usuarioAtual.apelido || usuarioAtual.email.split('@')[0];
  document.getElementById('contaAvatar').textContent = nome[0];
  document.getElementById('contaEmail').textContent = usuarioAtual.email;
  const apelidoInput = document.getElementById('apelidoInput');
  if(apelidoInput && document.activeElement !== apelidoInput) apelidoInput.value = usuarioAtual.apelido || '';

  const sessao = getSessao();
  const desde = sessao?.desde ? new Date(sessao.desde) : null;

  const todos = [...FILMES.map(f => ({...f, _tipo:'filme'})), ...SERIES.map(s => ({...s, _tipo:'serie'}))];

  // Avaliações do usuário
  const minhasAvaliacoes = [];
  Object.entries(AVALIACOES).forEach(([itemId, registros]) => {
    const meuRegistro = registros[usuarioAtual.chave];
    if(meuRegistro){
      const item = todos.find(i => i.id === itemId);
      if(item) minhasAvaliacoes.push({ item, nota: meuRegistro.nota, quando: meuRegistro.quando });
    }
  });
  minhasAvaliacoes.sort((a,b) => b.quando - a.quando);

  const assistidos = getContinuar();

  // Gêneros favoritos = tags mais frequentes entre assistidos + avaliados (peso maior p/ nota alta)
  const pontuacaoTags = {};
  assistidos.forEach(a => {
    const item = todos.find(i => i.id === a.id);
    (item?.tags || []).forEach(t => pontuacaoTags[t] = (pontuacaoTags[t] || 0) + 1);
  });
  minhasAvaliacoes.forEach(({ item, nota }) => {
    (item.tags || []).forEach(t => pontuacaoTags[t] = (pontuacaoTags[t] || 0) + nota);
  });
  const generosFavoritos = Object.entries(pontuacaoTags).sort((a,b) => b[1]-a[1]).slice(0, 6).map(([t]) => t);

  document.getElementById('contaDesde').textContent = desde ? `Sessão iniciada em ${desde.toLocaleDateString('pt-BR')}` : 'Bem-vindo(a)!';

  document.getElementById('contaStats').innerHTML = `
    <div class="account-stat"><div class="num">${minhasAvaliacoes.length}</div><div class="label">Avaliações feitas</div></div>
    <div class="account-stat"><div class="num">${assistidos.length}</div><div class="label">Em "continuar assistindo"</div></div>
    <div class="account-stat"><div class="num">${FILMES.length + SERIES.length}</div><div class="label">Títulos no catálogo</div></div>
  `;

  // Gêneros favoritos
  const generosWrap = document.getElementById('contaGeneros');
  generosWrap.innerHTML = generosFavoritos.length
    ? generosFavoritos.map(g => `<span class="tag-pill">${g}</span>`).join('')
    : '<p class="account-empty">Assista ou avalie títulos para descobrirmos seus gêneros favoritos.</p>';

  // Continuar assistindo
  const contListEl = document.getElementById('contaContinuarList');
  if(assistidos.length === 0){
    contListEl.innerHTML = '<p class="account-empty">Nada por aqui ainda.</p>';
  }else{
    contListEl.innerHTML = '';
    assistidos.forEach(a => {
      const item = todos.find(i => i.id === a.id);
      if(!item) return;
      const div = document.createElement('div');
      div.className = 'account-avaliacao-item';
      div.innerHTML = `
        <img src="${item.capa}" alt="${item.titulo}">
        <div class="info">
          <h4>${item.titulo}</h4>
          <span class="rating-count">${item._tipo === 'serie' ? 'Série' : 'Filme'}</span>
        </div>
        <button type="button" class="account-remove-btn" title="Remover">&times;</button>`;
      div.querySelector('.info').onclick = () => abrirModalDetalhes(item, item._tipo === 'serie');
      div.querySelector('img').onclick = () => abrirModalDetalhes(item, item._tipo === 'serie');
      div.querySelector('.account-remove-btn').onclick = (e) => {
        e.stopPropagation();
        removerContinuar(a.tipo, a.id);
        montarPaginaConta();
        montarLinhaContinuar();
      };
      contListEl.appendChild(div);
    });
  }

  // Avaliações
  const lista = document.getElementById('contaAvaliacoesList');
  if(minhasAvaliacoes.length === 0){
    lista.innerHTML = '<p class="account-empty">Você ainda não avaliou nenhum título.</p>';
  }else{
    lista.innerHTML = '';
    minhasAvaliacoes.forEach(({ item, nota }) => {
      const div = document.createElement('div');
      div.className = 'account-avaliacao-item';
      div.innerHTML = `
        <img src="${item.capa}" alt="${item.titulo}">
        <div class="info">
          <h4>${item.titulo}</h4>
          <span class="stars-display"><span class="stars-fill" style="width:${(nota/5)*100}%"></span></span>
        </div>
        <button type="button" class="account-remove-btn" title="Remover avaliação">&times;</button>`;
      div.querySelector('.info').onclick = () => abrirModalDetalhes(item, item._tipo === 'serie');
      div.querySelector('img').onclick = () => abrirModalDetalhes(item, item._tipo === 'serie');
      div.querySelector('.account-remove-btn').onclick = (e) => {
        e.stopPropagation();
        removerAvaliacao(item.id);
      };
      lista.appendChild(div);
    });
  }
}

/* ---------------- Alternância entre Home / Catálogo / Conta ---------------- */
function mostrarHome(){
  document.getElementById('contaSection').style.display = 'none';
  document.getElementById('catalogoSection').style.display = 'none';
  document.getElementById('hero').style.display = '';
  document.getElementById('continuarSection').style.display = '';
  document.getElementById('rowsHome').style.display = '';
  montarHero();
  montarLinhaContinuar();
  montarRowsHome();
}

function abrirCatalogo(opts){
  const tipo = opts && opts.tipo;
  document.getElementById('contaSection').style.display = 'none';
  document.getElementById('hero').style.display = 'none';
  document.getElementById('continuarSection').style.display = 'none';
  document.getElementById('rowsHome').style.display = 'none';
  document.getElementById('catalogoSection').style.display = 'block';
  if(tipo){
    filtroTipo = tipo;
    document.querySelectorAll('#filterTypes .filter-pill').forEach(b => b.classList.toggle('active', b.dataset.tipo === tipo));
  }
  aplicarFiltrosCatalogo();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function abrirPaginaConta(){
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('navConta').classList.add('active');
  montarPaginaConta();
  document.getElementById('hero').style.display = 'none';
  document.getElementById('continuarSection').style.display = 'none';
  document.getElementById('rowsHome').style.display = 'none';
  document.getElementById('catalogoSection').style.display = 'none';
  document.getElementById('contaSection').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function fecharPaginaConta(){
  mostrarHome();
}
function abrirAuthModal(aba = 'login', { avisoIdade = false } = {}){
  const modal = document.getElementById('authModal');
  mostrarAbaAuth(usuarioAtual ? 'perfil' : aba);
  const aviso = document.getElementById('authAgeNotice');
  if(aviso) aviso.style.display = avisoIdade ? 'block' : 'none';
  modal.classList.add('open');
}
function fecharAuthModal(){
  document.getElementById('authModal').classList.remove('open');
  document.getElementById('loginErro').textContent = '';
  document.getElementById('cadErro').textContent = '';
  const aviso = document.getElementById('authAgeNotice');
  if(aviso) aviso.style.display = 'none';
}
function mostrarAbaAuth(aba){
  const tabs = document.querySelector('.auth-tabs');
  document.getElementById('painelLogin').style.display = aba === 'login' ? 'block' : 'none';
  document.getElementById('painelCadastro').style.display = aba === 'cadastro' ? 'block' : 'none';
  document.getElementById('painelPerfil').style.display = aba === 'perfil' ? 'block' : 'none';
  tabs.style.display = aba === 'perfil' ? 'none' : 'flex';
  document.getElementById('tabLogin').classList.toggle('active', aba === 'login');
  document.getElementById('tabCadastro').classList.toggle('active', aba === 'cadastro');
  if(aba === 'perfil' && usuarioAtual){
    document.getElementById('perfilEmail').textContent = usuarioAtual.email;
    document.getElementById('perfilAvatar').textContent = usuarioAtual.email[0];
  }
}

function atualizarViewsAposAuth(){
  renderAllStarDisplays();
  if(currentDetalheItem) renderStarsInput(currentDetalheItem);
  montarLinhaContinuar();
  if(document.getElementById('rowsHome').style.display !== 'none') montarRowsHome();
  if(document.getElementById('catalogoSection').style.display !== 'none') aplicarFiltrosCatalogo();
}

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
function removerContinuar(tipo, id){
  const lista = getContinuar().filter(i => !(i.tipo === tipo && i.id === id));
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
  montarLinhaContinuar();
  montarRowsHome();
  aplicarFiltrosCatalogo();
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

  const heroRating = document.getElementById('heroRating');
  heroRating.dataset.rerenderRating = item.id;
  heroRating.innerHTML = starsDisplayHTML(item.id);

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
  const bloqueado = classificacaoAdulta(filme.classificacao) && !usuarioAtual;
  card.innerHTML = `
    <div class="card-img-wrap">
      <img src="${filme.capa}" alt="${filme.titulo}" loading="lazy">
      ${bloqueado ? `<div class="card-lock" title="Entre para assistir"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg> +18</div>` : ''}
      <div class="card-play-icon">
        <svg width="42" height="42" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(4,6,12,0.55)" stroke="rgba(255,255,255,0.5)"/><path d="M10 8l6 4-6 4V8z" fill="#fff"/></svg>
      </div>
    </div>
    <div class="card-info">
      <h3>${filme.titulo}</h3>
      <div class="card-sub"><span class="card-badge">${filme.classificacao}</span><span>${filme.tempo}</span>${filme.tags && filme.tags[0] ? `<span class="card-tag">${filme.tags[0]}</span>` : ''}</div>
      <div class="card-rating" data-rerender-rating="${filme.id}">${starsDisplayHTML(filme.id)}</div>
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
  const bloqueado = classificacaoAdulta(serie.classificacao) && !usuarioAtual;
  card.innerHTML = `
    <div class="card-img-wrap">
      <img src="${serie.capa}" alt="${serie.titulo}" loading="lazy">
      ${bloqueado ? `<div class="card-lock" title="Entre para assistir"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg> +18</div>` : ''}
      <div class="card-play-icon">
        <svg width="42" height="42" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(4,6,12,0.55)" stroke="rgba(255,255,255,0.5)"/><path d="M10 8l6 4-6 4V8z" fill="#fff"/></svg>
      </div>
      ${prog ? `<div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>` : ''}
    </div>
    <div class="card-info">
      <h3>${serie.titulo}</h3>
      <div class="card-sub"><span class="card-badge">${serie.classificacao}</span>${prog ? `<span>Continuar ${pctTxt}</span>` : `<span>${serie.temporadas.length} temporada(s)</span>`}${serie.tags && serie.tags[0] ? `<span class="card-tag">${serie.tags[0]}</span>` : ''}</div>
      <div class="card-rating" data-rerender-rating="${serie.id}">${starsDisplayHTML(serie.id)}</div>
    </div>`;
  card.onclick = () => abrirModalDetalhes(serie, true);
  return card;
}

/* ---------------- Restrição de idade (+18 exige login) ---------------- */
function classificacaoAdulta(classificacao){
  if(!classificacao) return false;
  const num = parseInt(classificacao.toString().replace(/\D/g, ''), 10);
  return !isNaN(num) && num >= 18;
}

/* ---------------- Linhas dinâmicas da home (estilo Netflix) ---------------- */
function classificacaoFamilia(classificacao){
  if(!classificacao) return false;
  const c = classificacao.toString().toLowerCase();
  if(c.includes('livre')) return true;
  const num = parseInt(c.replace(/\D/g, ''), 10);
  if(isNaN(num)) return false;
  return num <= 10;
}

function criarRowGenerica(titulo, itens, { id } = {}){
  if(!itens || itens.length === 0) return null;
  const section = document.createElement('section');
  section.className = 'row-section';
  if(id) section.id = id;
  section.innerHTML = `
    <h2 class="row-title">
      <span class="row-title-text">${titulo}</span>
      <span class="row-count">${itens.length} título${itens.length === 1 ? '' : 's'}</span>
    </h2>
    <div class="row-track"></div>
  `;
  const track = section.querySelector('.row-track');
  itens.forEach(item => track.appendChild(item._tipo === 'serie' ? criarCardSerie(item) : criarCardFilme(item)));
  return section;
}

function montarRowsHome(){
  const wrap = document.getElementById('rowsHome');
  if(!wrap) return;
  wrap.innerHTML = '';

  const todos = todosItensCatalogo();
  if(todos.length === 0) return;

  const assistidos = getContinuar();
  const idsVistos = new Set(assistidos.map(a => a.id));
  const tagsVistas = new Set();
  assistidos.forEach(v => {
    const obj = todos.find(x => x.id === v.id && x._tipo === v.tipo);
    (obj?.tags || []).forEach(t => tagsVistas.add(t));
  });
  if(usuarioAtual){
    Object.entries(AVALIACOES).forEach(([itemId, registros]) => {
      const meuRegistro = registros[usuarioAtual.chave];
      if(meuRegistro && meuRegistro.nota >= 4){
        const obj = todos.find(x => x.id === itemId);
        (obj?.tags || []).forEach(t => tagsVistas.add(t));
      }
    });
  }

  const linhas = [];

  // "Talvez você goste" — baseado no que já foi assistido/bem avaliado
  if(tagsVistas.size){
    const parecidos = todos
      .filter(item => !idsVistos.has(item.id) && (item.tags || []).some(t => tagsVistas.has(t)))
      .sort((a, b) => {
        const scoreA = (a.tags || []).filter(t => tagsVistas.has(t)).length;
        const scoreB = (b.tags || []).filter(t => tagsVistas.has(t)).length;
        return scoreB - scoreA;
      });
    linhas.push(criarRowGenerica('Talvez você goste', parecidos.slice(0, 18), { id: 'rowTalvezGoste' }));
  }

  // "Para você" — mistura gêneros favoritos com os mais bem avaliados do catálogo
  const paraVoce = [...todos].sort((a, b) => {
    const pesoA = (a.tags || []).some(t => tagsVistas.has(t)) ? 1 : 0;
    const pesoB = (b.tags || []).some(t => tagsVistas.has(t)) ? 1 : 0;
    if(pesoA !== pesoB) return pesoB - pesoA;
    return mediaAvaliacoes(b.id).media - mediaAvaliacoes(a.id).media;
  });
  linhas.push(criarRowGenerica('Para você', paraVoce.slice(0, 18), { id: 'rowParaVoce' }));

  // "Para ver com a família" — títulos com classificação livre/baixa
  const familia = todos.filter(item => classificacaoFamilia(item.classificacao));
  linhas.push(criarRowGenerica('Para ver com a família', familia.slice(0, 18), { id: 'rowFamilia' }));

  // Linhas por gênero (ex: "Terror", "Comédia"...), na ordem de popularidade no catálogo
  const contagemGenero = {};
  todos.forEach(item => (item.tags || []).forEach(t => contagemGenero[t] = (contagemGenero[t] || 0) + 1));
  const generosOrdenados = Object.entries(contagemGenero)
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);

  generosOrdenados.forEach(genero => {
    const itensGenero = todos.filter(item => (item.tags || []).includes(genero));
    linhas.push(criarRowGenerica(genero, itensGenero.slice(0, 18)));
  });

  const linhasValidas = linhas.filter(Boolean);
  if(linhasValidas.length === 0){
    linhas.push(criarRowGenerica('Em alta no PLAYMAX', todos.slice(0, 18)));
  }

  linhas.filter(Boolean).forEach(secao => wrap.appendChild(secao));
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
      aplicarFiltrosCatalogo();
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

function aplicarFiltrosCatalogo(){
  const grid = document.getElementById('catalogGrid');
  if(!grid) return;
  const lista = ordenarLista(
    todosItensCatalogo().filter(item => {
      if(filtroTipo !== 'todos' && item._tipo !== filtroTipo) return false;
      return passaFiltros(item);
    })
  );
  grid.innerHTML = '';
  lista.forEach(item => grid.appendChild(item._tipo === 'serie' ? criarCardSerie(item) : criarCardFilme(item)));
  const countEl = document.getElementById('catalogCount');
  if(countEl){
    countEl.textContent = termoBusca
      ? `${lista.length} resultado${lista.length === 1 ? '' : 's'} para "${termoBusca}"`
      : `${lista.length} título${lista.length === 1 ? '' : 's'}`;
  }
  atualizarMensagemVazia(grid, lista.length > 0);
}

function resetarFiltros(limparBusca){
  filtroTipo = 'todos';
  filtrosGenero.clear();
  ordenacao = 'padrao';
  if(limparBusca){
    termoBusca = '';
    document.getElementById('searchInput').value = '';
  }
  document.getElementById('sortSelect').value = 'padrao';
  document.querySelectorAll('#filterTypes .filter-pill').forEach(b => b.classList.toggle('active', b.dataset.tipo === 'todos'));
  document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
}

document.querySelectorAll('#filterTypes .filter-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#filterTypes .filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filtroTipo = btn.dataset.tipo;
    aplicarFiltrosCatalogo();
  });
});

document.getElementById('sortSelect').addEventListener('change', (e) => {
  ordenacao = e.target.value;
  aplicarFiltrosCatalogo();
});

document.getElementById('filterClear').addEventListener('click', () => {
  resetarFiltros(true);
  aplicarFiltrosCatalogo();
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

/* ---------------- Modal de detalhes ---------------- */
function todosItensCatalogo(){
  return [...FILMES.map(f => ({ ...f, _tipo: 'filme' })), ...SERIES.map(s => ({ ...s, _tipo: 'serie' }))];
}

function itensSemelhantes(item){
  const tags = new Set(item.tags || []);
  if(!tags.size) return [];
  return todosItensCatalogo()
    .filter(o => o.id !== item.id && (o.tags || []).some(t => tags.has(t)))
    .sort((a, b) => {
      const scoreA = (a.tags || []).filter(t => tags.has(t)).length;
      const scoreB = (b.tags || []).filter(t => tags.has(t)).length;
      if(scoreB !== scoreA) return scoreB - scoreA;
      return mediaAvaliacoes(b.id).media - mediaAvaliacoes(a.id).media;
    })
    .slice(0, 12);
}

function abrirModalDetalhes(item, isSerie){
  if(termoBusca){
    marcarBusca({ tipo: isSerie ? 'serie' : 'filme', id: item.id });
    montarHero();
  }

  currentDetalheItem = item.id;
  const modal = document.getElementById('detailModal');
  document.getElementById('modalBanner').style.backgroundImage = `url('${item.capa}')`;
  document.getElementById('modalTag').textContent = isSerie ? 'SÉRIE' : 'FILME';
  document.getElementById('modalTitle').textContent = item.titulo;
  document.getElementById('modalDesc').textContent = item.descricao;

  const { media, total } = mediaAvaliacoes(item.id);
  document.getElementById('modalStarsAvg').dataset.rerenderRating = item.id;
  document.getElementById('modalStarsAvg').dataset.comContagem = 'false';
  document.getElementById('modalStarsAvg').innerHTML = starsDisplayHTML(item.id, { comContagem: false });
  document.getElementById('modalRatingCount').textContent = total ? `${media.toFixed(1)} · ${total} avaliação${total===1?'':'ões'}` : 'Ainda sem avaliações';
  renderStarsInput(item.id);

  const meta = document.getElementById('modalMeta');
  meta.innerHTML = isSerie
    ? `<span class="meta-badge">${item.temporadas.length} temporada(s)</span><span class="meta-badge age">${item.classificacao}</span>`
    : `<span class="meta-badge">${item.tempo}</span><span class="meta-badge age">${item.classificacao}</span>`;

  const tagsWrap = document.getElementById('modalTags');
  tagsWrap.innerHTML = (item.tags || []).map(t => `<span class="tag-pill">${t}</span>`).join('');

  const infoList = document.getElementById('modalInfoList');
  const totalEpisodios = isSerie ? item.temporadas.reduce((acc, s) => acc + s.episodios.length, 0) : null;
  infoList.innerHTML = `
    <dt>Tipo</dt><dd>${isSerie ? 'Série' : 'Filme'}</dd>
    <dt>Classificação</dt><dd>${item.classificacao}</dd>
    ${isSerie
      ? `<dt>Temporadas</dt><dd>${item.temporadas.length}</dd><dt>Episódios</dt><dd>${totalEpisodios}</dd>`
      : `<dt>Duração</dt><dd>${item.tempo}</dd>`}
    <dt>Gêneros</dt><dd>${(item.tags || []).join(', ') || '—'}</dd>
    <dt>Avaliação</dt><dd>${total ? `${media.toFixed(1)} / 5 (${total})` : 'Sem avaliações'}</dd>
  `;

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

  const semelhantes = itensSemelhantes({ ...item, _tipo: isSerie ? 'serie' : 'filme' });
  const simWrap = document.getElementById('modalSimilarWrap');
  const simTrack = document.getElementById('modalSimilarTrack');
  simTrack.innerHTML = '';
  if(semelhantes.length){
    semelhantes.forEach(s => simTrack.appendChild(s._tipo === 'serie' ? criarCardSerie(s) : criarCardFilme(s)));
    simWrap.style.display = 'block';
  }else{
    simWrap.style.display = 'none';
  }

  modal.classList.add('open');
  modal.querySelector('.modal-box').scrollTop = 0;
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
    // youtube-nocookie.com = modo de privacidade avançada do próprio YouTube:
    // reduz cookies/rastreamento de terceiros. Não existe forma legítima de
    // bloquear os anúncios que o YouTube insere nos vídeos monetizados — quem
    // controla isso é o YouTube/o dono do vídeo, não o player incorporado.
    // O que dá para controlar (e já está aplicado abaixo) é remover elementos
    // que atrapalham a experiência: sugestões de outros canais, anotações,
    // legendas automáticas indesejadas e o botão de fullscreen nativo (usamos
    // o nosso, customizado).
    host: 'https://www.youtube-nocookie.com',
    playerVars: {
      autoplay: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      iv_load_policy: 3,
      fs: 0,
      cc_load_policy: 0,
      disablekb: 0,
      origin: window.location.origin
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    }
  });
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

/* ---------------- Letterbox do player (sem esticar, sem cortar) ----------------
   O iframe do YouTube é redimensionado via JS para caber inteiro dentro da área
   disponível mantendo a proporção 16:9 (igual a um "object-fit: contain"),
   ficando centralizado com barras pretas quando sobra espaço — nunca esticado
   e nunca cortado, e sempre no maior tamanho possível dentro da tela. */
function ajustarTamanhoPlayer(){
  const el = document.getElementById('ytPlayer');
  if(!el || !frameWrap) return;
  // offsetWidth/offsetHeight refletem o box "antes" de qualquer transform CSS
  // (ex: a rotação forçada em .forced-landscape), que é exatamente a área que
  // queremos preencher visualmente.
  const larguraDisp = frameWrap.offsetWidth;
  const alturaDisp = frameWrap.offsetHeight;
  if(!larguraDisp || !alturaDisp) return;

  const proporcaoAlvo = 16 / 9;
  let w, h;
  if(larguraDisp / alturaDisp > proporcaoAlvo){
    h = alturaDisp;
    w = h * proporcaoAlvo;
  }else{
    w = larguraDisp;
    h = w / proporcaoAlvo;
  }
  el.style.width = `${Math.round(w)}px`;
  el.style.height = `${Math.round(h)}px`;
  el.style.left = `${Math.round((larguraDisp - w) / 2)}px`;
  el.style.top = `${Math.round((alturaDisp - h) / 2)}px`;
}
let resizeObserverPlayer = null;
if(typeof ResizeObserver !== 'undefined'){
  resizeObserverPlayer = new ResizeObserver(() => ajustarTamanhoPlayer());
}

function onPlayerError(){
  // ID inválido/indisponível — para de girar e avisa em vez de travar pra sempre.
  mostrarCarregando(false, true);
}

function onPlayerReady(){
  mostrarCarregando(false);
  // Garante legendas desligadas mesmo se o navegador do usuário tiver a opção
  // "sempre mostrar legendas" ativada nas configurações do YouTube — o
  // cc_load_policy:0 nem sempre é suficiente sozinho nesse caso.
  try{ ytPlayer.unloadModule('captions'); }catch(e){}
  try{ ytPlayer.setOption('captions', 'reload', false); }catch(e){}
}

function onPlayerStateChange(event){
  const St = YT.PlayerState;
  // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
  if(event.data === St.BUFFERING){
    mostrarCarregando(true);
  }else if(event.data === St.PLAYING || event.data === St.PAUSED || event.data === St.CUED){
    // PAUSED/CUED cobre o caso comum no celular em que o autoplay é bloqueado
    // pelo navegador: o vídeo fica pronto/pausado esperando o toque do usuário
    // no próprio player do YouTube, mas nosso spinner precisa sumir mesmo assim.
    mostrarCarregando(false);
  }
  // Quando o vídeo termina (0), avança progresso de série
  if(event.data === St.ENDED && currentPlayback?.tipo === 'serie'){
    avancarEpisodio();
  }
}

let cargaFallbackTimer = null;
function mostrarCarregando(mostrar, erro){
  const loading = document.getElementById('playerLoading');
  if(!loading) return;
  loading.classList.toggle('show', !!mostrar || !!erro);
  loading.classList.toggle('is-error', !!erro);
  loading.querySelector('span').textContent = erro
    ? 'Não foi possível carregar este vídeo.'
    : 'Carregando...';
  clearTimeout(cargaFallbackTimer);
  if(mostrar && !erro){
    // Rede à parte com timeout de segurança: se por qualquer motivo o player
    // não avisar que carregou (ex: iframe travado, autoplay bloqueado sem
    // disparar evento), o spinner some sozinho depois de alguns segundos em
    // vez de ficar girando pra sempre.
    cargaFallbackTimer = setTimeout(() => {
      loading.classList.remove('show');
    }, 7000);
  }
}

function abrirPlayer({ tipo, item, temporada, episodio, ep }){
  if(classificacaoAdulta(item.classificacao) && !usuarioAtual){
    document.getElementById('detailModal').classList.remove('open');
    abrirAuthModal('login', { avisoIdade: true });
    return;
  }

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
  mostrarCarregando(true, false);
  mostrarControles();
  ajustarTamanhoPlayer();
  if(resizeObserverPlayer) resizeObserverPlayer.observe(frameWrap);

  const tentarCarregar = () => {
    if(ytReady && ytPlayer && ytPlayer.loadVideoById){
      ytPlayer.loadVideoById(youtubeId);
      try{ ytPlayer.unloadModule('captions'); }catch(e){}
    }else{
      setTimeout(tentarCarregar, 200);
    }
  };
  tentarCarregar();

  montarLinhaContinuar();
  if(document.getElementById('rowsHome').style.display !== 'none') montarRowsHome();
  if(document.getElementById('catalogoSection').style.display !== 'none') aplicarFiltrosCatalogo();
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
  if(resizeObserverPlayer) resizeObserverPlayer.unobserve(frameWrap);
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
  // Espera o navegador aplicar a classe (que pode mudar largura/altura via
  // rotate 90°) antes de recalcular o tamanho do vídeo.
  requestAnimationFrame(ajustarTamanhoPlayer);
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
  }, 4200);
}
frameWrap.addEventListener('click', mostrarControles);
frameWrap.addEventListener('touchstart', mostrarControles, { passive: true });
frameWrap.addEventListener('mousemove', mostrarControles);
document.getElementById('playerTapCatcher').addEventListener('click', mostrarControles);

// O iframe do YouTube é de outra origem: cliques/toques feitos diretamente
// nele nunca chegam aos listeners acima. Quando o foco do navegador migra pro
// iframe (o que só acontece por causa de um clique/toque do usuário nele),
// a janela principal recebe "blur" — usamos isso pra reexibir os controles
// mesmo quando o toque aconteceu dentro do vídeo.
window.addEventListener('blur', () => {
  if(!playerOverlay.classList.contains('open')) return;
  setTimeout(() => {
    if(document.activeElement && document.activeElement.tagName === 'IFRAME'){
      mostrarControles();
    }
  }, 0);
});

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

    if(alvo === 'conta'){
      if(!usuarioAtual){ abrirAuthModal('login'); return; }
      abrirPaginaConta();
      return;
    }
    if(alvo === 'catalogo'){
      resetarFiltros(true);
      abrirCatalogo();
      return;
    }
    if(alvo === 'filmes' || alvo === 'series'){
      resetarFiltros(true);
      abrirCatalogo({ tipo: alvo === 'filmes' ? 'filme' : 'serie' });
      return;
    }

    buscaAbriuCatalogo = false;
    mostrarHome();
    const idParaRolar = alvo === 'recomendados'
      ? (document.getElementById('rowTalvezGoste') ? 'rowTalvezGoste' : 'rowParaVoce')
      : (alvo === 'continuar' ? 'continuarSection' : 'hero');
    requestAnimationFrame(() => {
      const el = document.getElementById(idParaRolar);
      if(el) el.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  });
});

/* ---------------- Busca ---------------- */
let buscaAbriuCatalogo = false;
document.getElementById('searchInput').addEventListener('input', (e) => {
  termoBusca = e.target.value.trim().toLowerCase();
  if(termoBusca){
    if(document.getElementById('catalogoSection').style.display === 'none'){
      buscaAbriuCatalogo = true;
      abrirCatalogo();
    }else{
      aplicarFiltrosCatalogo();
    }
  }else{
    if(buscaAbriuCatalogo){
      buscaAbriuCatalogo = false;
      mostrarHome();
    }else{
      aplicarFiltrosCatalogo();
    }
  }
});

/* ---------------- Conta / Login (eventos) ---------------- */
document.getElementById('accountBtn').onclick = () => {
  if(usuarioAtual) abrirPaginaConta();
  else abrirAuthModal('login');
};
document.getElementById('closeAuthModal').onclick = fecharAuthModal;
document.getElementById('authModal').addEventListener('click', (e) => {
  if(e.target.id === 'authModal') fecharAuthModal();
});
document.getElementById('tabLogin').onclick = () => mostrarAbaAuth('login');
document.getElementById('tabCadastro').onclick = () => mostrarAbaAuth('cadastro');

document.getElementById('formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erroEl = document.getElementById('loginErro');
  const btn = document.getElementById('loginSubmitBtn');
  erroEl.textContent = '';
  const email = document.getElementById('loginEmail').value;
  const senha = document.getElementById('loginSenha').value;
  btn.disabled = true; btn.textContent = 'Entrando...';
  try{
    const usuario = await entrarUsuario(email, senha);
    iniciarSessao(usuario);
    fecharAuthModal();
    atualizarViewsAposAuth();
  }catch(err){
    erroEl.textContent = err.message;
  }finally{
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});

document.getElementById('formCadastro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erroEl = document.getElementById('cadErro');
  const btn = document.getElementById('cadSubmitBtn');
  erroEl.textContent = '';
  const email = document.getElementById('cadEmail').value;
  const senha = document.getElementById('cadSenha').value;
  const confirma = document.getElementById('cadSenhaConfirma').value;
  if(senha !== confirma){ erroEl.textContent = 'As senhas não coincidem.'; return; }
  if(senha.length < 6){ erroEl.textContent = 'A senha precisa ter ao menos 6 caracteres.'; return; }
  btn.disabled = true; btn.textContent = 'Criando...';
  try{
    const usuario = await cadastrarUsuario(email, senha);
    iniciarSessao(usuario);
    fecharAuthModal();
    atualizarViewsAposAuth();
  }catch(err){
    erroEl.textContent = err.message;
  }finally{
    btn.disabled = false; btn.textContent = 'Criar conta';
  }
});

document.getElementById('logoutBtn').onclick = () => {
  encerrarSessao();
  fecharAuthModal();
  atualizarViewsAposAuth();
};
document.getElementById('contaLogoutBtn').onclick = () => {
  encerrarSessao();
  atualizarViewsAposAuth();
};

document.getElementById('formSenha').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erroEl = document.getElementById('senhaErro');
  const sucessoEl = document.getElementById('senhaSucesso');
  const btn = document.getElementById('senhaSubmitBtn');
  erroEl.textContent = ''; sucessoEl.textContent = '';
  const atual = document.getElementById('senhaAtual').value;
  const nova = document.getElementById('senhaNova').value;
  btn.disabled = true; btn.textContent = 'Salvando...';
  try{
    await alterarSenha(atual, nova);
    sucessoEl.textContent = 'Senha alterada com sucesso!';
    document.getElementById('formSenha').reset();
  }catch(err){
    erroEl.textContent = err.message;
  }finally{
    btn.disabled = false; btn.textContent = 'Salvar nova senha';
  }
});

document.getElementById('formApelido').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erroEl = document.getElementById('apelidoErro');
  const sucessoEl = document.getElementById('apelidoSucesso');
  const btn = document.getElementById('apelidoSubmitBtn');
  erroEl.textContent = ''; sucessoEl.textContent = '';
  const apelido = document.getElementById('apelidoInput').value.trim();
  btn.disabled = true; btn.textContent = 'Salvando...';
  try{
    await salvarApelido(apelido);
    sucessoEl.textContent = 'Apelido salvo!';
  }catch(err){
    erroEl.textContent = err.message;
  }finally{
    btn.disabled = false; btn.textContent = 'Salvar apelido';
  }
});

document.getElementById('apagarContaBtn').onclick = async () => {
  if(!confirm('Tem certeza que quer apagar sua conta? Essa ação não pode ser desfeita.')) return;
  const btn = document.getElementById('apagarContaBtn');
  btn.disabled = true; btn.textContent = 'Apagando...';
  try{
    await apagarConta();
    fecharPaginaConta();
    renderAllStarDisplays();
  }catch(err){
    alert(err.message);
  }finally{
    btn.disabled = false; btn.textContent = 'Apagar minha conta';
  }
};

/* ---------------- Init ---------------- */
(async function iniciarSessaoSalva(){
  const sessao = getSessao();
  if(sessao) { usuarioAtual = sessao; aplicarSessaoNaUI(); }
})();
carregarAvaliacoes().then(() => renderAllStarDisplays());
carregarDados();