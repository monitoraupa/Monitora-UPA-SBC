/* ============================================================
   CONFIGURAÇÃO DO SUPABASE
   Troque pelos dados do seu projeto em:
   Supabase > Project Settings > API
   ============================================================ */
const SUPABASE_URL = 'https://zxepgwlrhcqddgiopnsh.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_krLbkRQAASCCZrIGyUTpeA_GNgtluwc';

/* ------------------------------------------------------------
   ID do dispositivo — precisa existir ANTES de criar o client,
   pois é enviado em todo request via header (usado pelas
   policies de RLS para saber quem pode dar checkout).
   ------------------------------------------------------------ */
function getOrCreateDeviceId() {
  let id = localStorage.getItem('monitora_upa_device_id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    localStorage.setItem('monitora_upa_device_id', id);
  }
  return id;
}

const DEVICE_ID = getOrCreateDeviceId();

let sb = null;
try {
  if (window.supabase && SUPABASE_URL.indexOf('SEU-PROJETO') === -1) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { 'x-device-id': DEVICE_ID } }
    });
  }
} catch (e) {
  console.warn('Supabase ainda não configurado:', e);
}

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho',
                'agosto','setembro','outubro','novembro','dezembro'];

const pad = n => String(n).padStart(2, '0');

const horaAtual = (date = new Date()) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const dataAtual = (date = new Date()) =>
  `${DIAS[date.getDay()]}, ${date.getDate()} de ${MESES[date.getMonth()]}`;

function formatarDuracao(minutosTotais) {
  if (minutosTotais === null || minutosTotais === undefined || isNaN(minutosTotais)) return 'Sem dados nas últimas 2hrs';
  const h = Math.floor(minutosTotais / 60);
  const m = Math.round(minutosTotais % 60);
  return h === 0 ? `${m} min` : `${h}h ${pad(m)} min`;
}

function corPelaEspera(minutos) {
  if (minutos === null) return 'wait-gray';
  if (minutos < 60) return 'wait-green';
  if (minutos < 90) return 'wait-yellow';
  return 'wait-red';
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ============================================================
   CÁLCULO DO TEMPO MÉDIO DE ESPERA
   ------------------------------------------------------------
   Em vez de "resetar" a média em horários fixos (o que gera
   buracos/dados vazios), usamos:

   1) Janela deslizante curta (2h) — se tiver poucas amostras,
      cai pra uma janela de 6h só pra não mostrar "sem dados".
   2) Peso por recência (decaimento exponencial, meia-vida de
      30min) — um atendimento finalizado há 5min pesa muito
      mais que um finalizado há 1h50.
   3) Sinal ao vivo — usa quem está com status 'em_andamento'
      agora (chegou, ainda não fez check-out) pra captar
      mudanças de fluxo que ainda não geraram nenhum check-out.
   ============================================================ */
const JANELA_CURTA_MS = 2 * 60 * 60 * 1000;  // 2h
const JANELA_LONGA_MS = 6 * 60 * 60 * 1000;  // 6h (fallback se tiver poucos dados)
const MEIA_VIDA_MIN = 30;                     // peso cai pela metade a cada 30min
const MIN_AMOSTRAS = 3;                       // abaixo disso, tenta a janela maior

function pesoPorRecencia(minutosAtras) {
  return Math.pow(0.5, minutosAtras / MEIA_VIDA_MIN);
}

function mediaPonderadaFinalizados(lista, agora, janelaMs) {
  const limite = agora.getTime() - janelaMs;
  const validos = lista.filter(a =>
    a.tempo_permanencia_minutos !== null &&
    new Date(a.horario_saida).getTime() >= limite
  );
  if (validos.length === 0) return null;

  let somaPesos = 0;
  let somaPonderada = 0;
  validos.forEach(a => {
    const minutosAtras = (agora.getTime() - new Date(a.horario_saida).getTime()) / 60000;
    const peso = pesoPorRecencia(minutosAtras);
    somaPesos += peso;
    somaPonderada += peso * a.tempo_permanencia_minutos;
  });

  return { media: somaPonderada / somaPesos, amostras: validos.length, pesoTotal: somaPesos };
}

function calcularTempoMedioUpa(finalizadosDaUpa, emAndamentoDaUpa, agora) {
  let resultado = mediaPonderadaFinalizados(finalizadosDaUpa, agora, JANELA_CURTA_MS);
  let janela = '2h';

  if (!resultado || resultado.amostras < MIN_AMOSTRAS) {
    const resultadoLongo = mediaPonderadaFinalizados(finalizadosDaUpa, agora, JANELA_LONGA_MS);
    if (resultadoLongo) { resultado = resultadoLongo; janela = '6h'; }
  }

  const esperasAoVivo = emAndamentoDaUpa.map(a =>
    (agora.getTime() - new Date(a.horario_chegada).getTime()) / 60000
  );
  const mediaAoVivo = esperasAoVivo.length
    ? esperasAoVivo.reduce((a, b) => a + b, 0) / esperasAoVivo.length
    : null;
  const maiorEsperaAoVivo = esperasAoVivo.length ? Math.max(...esperasAoVivo) : null;

  if (!resultado && mediaAoVivo === null) {
    return { tempoMedio: null, confiabilidade: 'sem_dados' };
  }
  if (!resultado) {
    return { tempoMedio: mediaAoVivo, confiabilidade: 'baixa' };
  }

  let tempoFinal = resultado.media;
  let confiabilidade = resultado.amostras >= MIN_AMOSTRAS ? 'alta' : 'media';

  if (mediaAoVivo !== null) {
    // Combina o histórico recente com quem está esperando agora.
    // O sinal "ao vivo" recebe peso extra por pessoa, pois é o
    // dado mais atual que existe (ainda nem terminou, mas já
    // mostra pra onde a fila está indo).
    const pesoFinalizados = resultado.pesoTotal;
    const pesoAoVivo = esperasAoVivo.length * 1.5;
    tempoFinal = (resultado.media * pesoFinalizados + mediaAoVivo * pesoAoVivo) / (pesoFinalizados + pesoAoVivo);

    // Se alguém já está esperando mais tempo do que a estimativa
    // combinada, isso é sinal de piora recente — usamos como piso
    // (sem pular direto pro máximo, só suaviza pra cima).
    if (maiorEsperaAoVivo !== null && maiorEsperaAoVivo > tempoFinal) {
      tempoFinal = (tempoFinal + maiorEsperaAoVivo) / 2;
    }
  }

  return { tempoMedio: tempoFinal, amostras: resultado.amostras, janela, confiabilidade };
}

/* ============================================================
   COMPONENTE DE APRENDIZADO DE MÁQUINA
   ------------------------------------------------------------
   Regressão linear simples (mínimos quadrados ordinários),
   treinada a cada carregamento a partir do histórico real de
   atendimentos de cada UPA:

     tempo_permanencia_min  ~  a + b * hora_do_dia

   Este é o modelo supervisionado descrito no trabalho científico
   (linha "IA & Tecnologia — Aprendizado de Máquina aplicado à
   tomada de decisão"): aprende os coeficientes a e b a partir
   dos dados observados, em vez de usar apenas constantes fixas.

   Não substitui a heurística de recência/sinal ao vivo acima —
   ela continua sendo o sinal mais confiável no curtíssimo prazo.
   O modelo entra como reforço quando há POUCOS dados recentes
   (poucas amostras nas últimas 2h/6h), usando o padrão histórico
   por horário do dia para não cair em "sem dados".
   ============================================================ */
const MIN_PONTOS_REGRESSAO = 5; // abaixo disso, o modelo não é confiável o suficiente pra usar

function regressaoLinearSimples(pontosXY) {
  const n = pontosXY.length;
  if (n < MIN_PONTOS_REGRESSAO) return null;

  let somaX = 0, somaY = 0, somaXY = 0, somaXX = 0;
  pontosXY.forEach(([x, y]) => {
    somaX += x; somaY += y; somaXY += x * y; somaXX += x * x;
  });

  const denominador = n * somaXX - somaX * somaX;
  if (denominador === 0) return null; // todos os pontos no mesmo horário — não dá pra ajustar reta

  const b = (n * somaXY - somaX * somaY) / denominador;
  const a = (somaY - b * somaX) / n;

  // R² — o quanto o horário do dia explica a variação do tempo de espera.
  // Reportar isso na banca é mais honesto do que só apresentar a previsão.
  const media = somaY / n;
  let ssTot = 0, ssRes = 0;
  pontosXY.forEach(([x, y]) => {
    const previsto = a + b * x;
    ssTot += (y - media) ** 2;
    ssRes += (y - previsto) ** 2;
  });
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { a, b, n, r2 };
}

/**
 * Treina um modelo por UPA usando TODO o histórico de atendimentos
 * finalizados (não só a janela curta), pois a regressão precisa de
 * volume de dados para captar o padrão por horário do dia.
 */
function treinarModelosPorHorario(finalizadosPorUpa) {
  const modelos = {};
  Object.keys(finalizadosPorUpa).forEach(upaId => {
    const pontos = finalizadosPorUpa[upaId]
      .filter(a => a.tempo_permanencia_minutos !== null && a.horario_saida)
      .map(a => [new Date(a.horario_saida).getHours(), a.tempo_permanencia_minutos]);
    modelos[upaId] = regressaoLinearSimples(pontos);
  });
  return modelos;
}

function preverPorRegressao(modelo, horaAtualNum) {
  if (!modelo) return null;
  const previsto = modelo.a + modelo.b * horaAtualNum;
  return Math.max(0, previsto); // tempo de espera não pode ser negativo
}

function parseHoraParaData(textoHHMM, base = new Date()) {
  const [hh, mm] = textoHHMM.split(':').map(Number);
  const d = new Date(base);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

/* ============================================================
   RELÓGIO (atualiza em todas as telas que têm data-clock-time)
   ============================================================ */
function atualizarRelogios() {
  const agora = new Date();
  document.querySelectorAll('[data-clock-time]').forEach(el => el.textContent = horaAtual(agora));
  document.querySelectorAll('[data-clock-date]').forEach(el => el.textContent = dataAtual(agora));
  atualizarBannerAtivo(agora);
}
atualizarRelogios();
setInterval(atualizarRelogios, 1000);

/* ============================================================
   BANNER "ATENDIMENTO EM ANDAMENTO" (tela Início)
   ============================================================ */
function atualizarBannerAtivo(agora = new Date()) {
  const banner = document.getElementById('active-banner');
  const ativoStr = localStorage.getItem('monitora_upa_atendimento_ativo');

  if (!ativoStr) {
    banner.style.display = 'none';
    return;
  }

  const ativo = JSON.parse(ativoStr);
  const minutos = Math.max(0, Math.round((agora - new Date(ativo.horarioChegada)) / 60000));
  const cor = corPelaEspera(minutos);

  banner.className = `active-banner ${cor === 'wait-gray' ? 'wait-green' : cor}`;
  banner.style.display = 'flex';
  document.getElementById('active-banner-text').textContent =
    `Atendimento em andamento: ${minutos} min`;
}

document.getElementById('active-banner').addEventListener('click', () => {
  carregarCheckout();
});

/* ============================================================
   NAVEGAÇÃO ENTRE TELAS
   ============================================================ */
function mostrarTela(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
const state = {
  deviceId: DEVICE_ID,
  upaSelecionada: null,
  upasCache: [],
  ordenarPor: 'tempo',
  posicaoUsuario: null,
};

/* ============================================================
   TELA INICIAL — LISTA DE UPAS
   ============================================================ */
async function obterLocalizacao() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 }
    );
  });
}

async function carregarUpas() {
  const lista = document.getElementById('upa-list');

  if (!sb) {
    lista.innerHTML = '<p class="loading-msg">Configure SUPABASE_URL e SUPABASE_ANON_KEY em app.js para carregar as UPAs.</p>';
    return;
  }

  lista.innerHTML = '<p class="loading-msg">Carregando UPAs...</p>';

  const { data: upas, error } = await sb.from('upas').select('*');
  if (error) {
    lista.innerHTML = '<p class="loading-msg">Erro ao carregar UPAs. Veja o console.</p>';
    console.error(error);
    return;
  }

  const agora = new Date();
  const desde = new Date(agora.getTime() - JANELA_LONGA_MS).toISOString();

  // Busca os finalizados dentro da janela mais longa (6h) — a função
  // de cálculo decide sozinha se usa só os últimos 2h ou recorre aos 6h.
  const { data: finalizados } = await sb
    .from('atendimentos')
    .select('upa_id, tempo_permanencia_minutos, horario_saida')
    .eq('status', 'finalizado')
    .gte('horario_saida', desde);

  // Busca quem está esperando agora (sinal ao vivo).
  const { data: emAndamento } = await sb
    .from('atendimentos')
    .select('upa_id, horario_chegada')
    .eq('status', 'em_andamento');

  // Busca um histórico mais longo (30 dias) exclusivamente para TREINAR
  // o modelo de regressão por horário do dia — precisa de mais volume
  // e de mais variação de horário do que a janela curta usada acima.
  const desdeRegressao = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: finalizadosHistorico } = await sb
    .from('atendimentos')
    .select('upa_id, tempo_permanencia_minutos, horario_saida')
    .eq('status', 'finalizado')
    .gte('horario_saida', desdeRegressao);

  const finalizadosPorUpa = {};
  (finalizados || []).forEach(a => { (finalizadosPorUpa[a.upa_id] ??= []).push(a); });

  const emAndamentoPorUpa = {};
  (emAndamento || []).forEach(a => { (emAndamentoPorUpa[a.upa_id] ??= []).push(a); });

  const finalizadosHistPorUpa = {};
  (finalizadosHistorico || []).forEach(a => { (finalizadosHistPorUpa[a.upa_id] ??= []).push(a); });

  const modelosRegressao = treinarModelosPorHorario(finalizadosHistPorUpa);

  const upasComDados = (upas || []).map(u => {
    const resultado = calcularTempoMedioUpa(
      finalizadosPorUpa[u.id] || [],
      emAndamentoPorUpa[u.id] || [],
      agora
    );

    let tempoMedio = resultado.tempoMedio;
    let confiabilidade = resultado.confiabilidade;
    let origemEstimativa = 'heuristica';

    // Componente de aprendizado de máquina: só entra em ação quando a
    // heurística de curto prazo tem pouco ou nenhum dado — é o reforço
    // baseado no padrão histórico aprendido por horário do dia.
    const modelo = modelosRegressao[u.id];
    if (modelo && (tempoMedio === null || confiabilidade === 'baixa' || confiabilidade === 'sem_dados')) {
      const previsao = preverPorRegressao(modelo, agora.getHours());
      if (previsao !== null) {
        tempoMedio = tempoMedio === null ? previsao : (tempoMedio + previsao) / 2;
        confiabilidade = 'media';
        origemEstimativa = 'regressao';
      }
    }

    const distanciaKm = state.posicaoUsuario
      ? haversineKm(state.posicaoUsuario.lat, state.posicaoUsuario.lng, u.latitude, u.longitude)
      : null;
    return {
      ...u,
      tempoMedio,
      confiabilidade,
      origemEstimativa,
      modeloR2: modelo ? modelo.r2 : null,
      distanciaKm
    };
  });

  state.upasCache = upasComDados;
  renderizarLista(upasComDados);
}

function renderizarLista(upas) {
  const ordenadas = [...upas].sort((a, b) => {
    if (state.ordenarPor === 'distancia') {
      if (a.distanciaKm === null) return 1;
      if (b.distanciaKm === null) return -1;
      return a.distanciaKm - b.distanciaKm;
    }
    if (a.tempoMedio === null) return 1;
    if (b.tempoMedio === null) return -1;
    return a.tempoMedio - b.tempoMedio;
  });

  const lista = document.getElementById('upa-list');
  lista.innerHTML = '';

  if (ordenadas.length === 0) {
    lista.innerHTML = '<p class="loading-msg">Nenhuma UPA cadastrada ainda. Rode o supabase-schema.sql.</p>';
    return;
  }

  ordenadas.forEach(u => {
    const corClasse = corPelaEspera(u.tempoMedio);
    let avisoConfianca = '';
    if (u.origemEstimativa === 'regressao') {
      avisoConfianca = '<div class="upa-confidence">estimativa por padrão histórico do horário</div>';
    } else if (u.confiabilidade === 'media' || u.confiabilidade === 'baixa') {
      avisoConfianca = '<div class="upa-confidence">baseado em poucos dados</div>';
    }
    const card = document.createElement('div');
    card.className = `upa-card ${corClasse}`;
    card.innerHTML = `
      <div>
        <div class="upa-name">${u.nome}</div>
        <div class="upa-distance">${u.distanciaKm !== null ? u.distanciaKm.toFixed(1).replace('.', ',') + ' km' : 'distância indisponível'}</div>
        ${avisoConfianca}
      </div>
      <div class="upa-wait ${corClasse}">${formatarDuracao(u.tempoMedio)}</div>
    `;
    card.addEventListener('click', () => iniciarCheckin(u));
    lista.appendChild(card);
  });
}

function preencherSelectsDeUpas() {
  const opts = [...state.upasCache]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map(u => `<option value="${u.id}">${u.nome}</option>`)
    .join('');
  ['checkin-upa-select', 'retro-upa-select'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const valorAtual = sel.value;
    sel.innerHTML = '<option value="" selected disabled>selecione</option>' + opts;
    if (valorAtual) sel.value = valorAtual;
  });
}

document.querySelectorAll('.pill-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill-toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.ordenarPor = btn.dataset.sort;
    renderizarLista(state.upasCache);
  });
});

/* ============================================================
   TELA DE CHECK-IN (chegada)
   ============================================================ */
let respostaSelecionada = null;

function iniciarCheckin(upa) {
  respostaSelecionada = upa ? 'sim' : null;
  state.upaSelecionada = upa || null;

  const campoHora = document.getElementById('checkin-time');
  campoHora.textContent = horaAtual();
  campoHora.contentEditable = 'false';

  document.querySelectorAll('#screen-checkin [data-response]').forEach(b => b.classList.remove('selected'));

  const select = document.getElementById('checkin-upa-select');
  if (upa) {
    select.value = upa.id;
    document.querySelector('#screen-checkin [data-response="sim"]').classList.add('selected');
  } else {
    select.value = '';
  }

  mostrarTela('screen-checkin');
}

document.getElementById('checkin-upa-select').addEventListener('change', (e) => {
  const upa = state.upasCache.find(u => u.id === e.target.value);
  if (!upa) return;
  state.upaSelecionada = upa;
  respostaSelecionada = 'sim';
  document.querySelectorAll('#screen-checkin [data-response]').forEach(b => b.classList.remove('selected'));
  document.querySelector('#screen-checkin [data-response="sim"]').classList.add('selected');
});

document.querySelectorAll('#screen-checkin [data-response]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#screen-checkin [data-response]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    respostaSelecionada = btn.dataset.response;
  });
});

document.getElementById('btn-corrigir-chegada').addEventListener('click', () => {
  const campo = document.getElementById('checkin-time');
  campo.contentEditable = 'true';
  campo.focus();
});

document.getElementById('btn-confirmar-chegada').addEventListener('click', async () => {
  if (!respostaSelecionada) {
    alert('Toque em "Sim", "Não" ou "Sou funcionário" antes de confirmar.');
    return;
  }
  if (respostaSelecionada === 'nao') {
    mostrarTela('screen-home');
    return;
  }
  if (respostaSelecionada === 'funcionario') {
    alert('Obrigado! Check-ins de funcionários não entram no tempo médio.');
    mostrarTela('screen-home');
    return;
  }
  if (!state.upaSelecionada) {
    alert('Selecione a UPA no menu acima.');
    return;
  }
  if (!sb) {
    alert('Configure o Supabase em app.js para salvar o check-in.');
    return;
  }

  const horario = parseHoraParaData(document.getElementById('checkin-time').textContent);

  const { data, error } = await sb.from('atendimentos').insert({
    upa_id: state.upaSelecionada.id,
    dispositivo_id: state.deviceId,
    horario_chegada: horario.toISOString(),
    status: 'em_andamento'
  }).select().single();

  if (error) {
    alert('Não foi possível registrar a chegada.');
    console.error(error);
    return;
  }

  localStorage.setItem('monitora_upa_atendimento_ativo', JSON.stringify({
    id: data.id,
    upaId: state.upaSelecionada.id,
    upaNome: state.upaSelecionada.nome,
    horarioChegada: horario.toISOString()
  }));

  alert('Chegada registrada! Toque em "Check-out" quando for embora.');
  mostrarTela('screen-home');
});

/* ============================================================
   TELA DE CHECK-OUT (saída)
   ============================================================ */
function carregarCheckout() {
  const cardNormal = document.getElementById('checkout-card-normal');
  const cardRetro = document.getElementById('checkout-card-retroativo');
  const ativoStr = localStorage.getItem('monitora_upa_atendimento_ativo');

  if (ativoStr) {
    cardNormal.style.display = '';
    cardRetro.style.display = 'none';

    const ativo = JSON.parse(ativoStr);
    const chegada = new Date(ativo.horarioChegada);
    const agora = new Date();
    const minutos = Math.max(0, Math.round((agora - chegada) / 60000));

    document.getElementById('checkout-upa-nome').textContent = ativo.upaNome;
    document.getElementById('permanencia-valor').textContent = formatarDuracao(minutos);

    const campoHora = document.getElementById('checkout-time');
    campoHora.textContent = horaAtual(agora);
    campoHora.contentEditable = 'false';
  } else {
    cardNormal.style.display = 'none';
    cardRetro.style.display = '';
    prepararCheckoutRetroativo();
  }

  mostrarTela('screen-checkout');
}

/* ------------------------------------------------------------
   Variante retroativa — pessoa não fez check-in neste aparelho,
   mas quer registrar um atendimento das últimas 2 horas.
   ------------------------------------------------------------ */
function prepararCheckoutRetroativo() {
  const agora = new Date();
  const chegadaPadrao = new Date(agora.getTime() - 30 * 60000); // sugestão: chegou há 30min

  document.getElementById('retro-upa-select').value = '';
  document.getElementById('retro-chegada-time').textContent = horaAtual(chegadaPadrao);
  document.getElementById('retro-saida-time').textContent = horaAtual(agora);
  atualizarPermanenciaRetro();
}

function atualizarPermanenciaRetro() {
  const chegada = parseHoraParaData(document.getElementById('retro-chegada-time').textContent);
  const saida = parseHoraParaData(document.getElementById('retro-saida-time').textContent);
  let minutos = Math.round((saida - chegada) / 60000);
  if (isNaN(minutos) || minutos < 0) minutos = null;
  document.getElementById('retro-permanencia-valor').textContent =
    minutos === null ? '--' : formatarDuracao(minutos);
}

['retro-chegada-time', 'retro-saida-time'].forEach(id => {
  const campo = document.getElementById(id);
  campo.addEventListener('input', atualizarPermanenciaRetro);
  campo.addEventListener('blur', atualizarPermanenciaRetro);
});

document.getElementById('btn-retro-confirmar').addEventListener('click', async () => {
  const upaId = document.getElementById('retro-upa-select').value;
  if (!upaId) {
    alert('Selecione a unidade onde você foi atendido.');
    return;
  }
  if (!sb) {
    alert('Configure o Supabase em app.js para salvar o atendimento.');
    return;
  }

  const chegada = parseHoraParaData(document.getElementById('retro-chegada-time').textContent);
  const saida = parseHoraParaData(document.getElementById('retro-saida-time').textContent);
  const minutos = Math.round((saida - chegada) / 60000);

  if (isNaN(minutos) || minutos < 0) {
    alert('Verifique os horários: a saída precisa ser depois da chegada.');
    return;
  }
  if (minutos > 120) {
    const continuar = confirm('Esse período passa de 2 horas. Registrar mesmo assim?');
    if (!continuar) return;
  }

  const { error } = await sb.from('atendimentos').insert({
    upa_id: upaId,
    dispositivo_id: state.deviceId,
    horario_chegada: chegada.toISOString(),
    horario_saida: saida.toISOString(),
    tempo_permanencia_minutos: minutos,
    status: 'finalizado'
  });

  if (error) {
    alert('Não foi possível registrar o atendimento.');
    console.error(error);
    return;
  }

  alert('Atendimento registrado. Obrigado por ajudar!');
  mostrarTela('screen-home');
  carregarUpas();
});

document.getElementById('btn-retro-cancelar').addEventListener('click', () => {
  mostrarTela('screen-home');
});

document.getElementById('btn-corrigir-saida').addEventListener('click', () => {
  const campo = document.getElementById('checkout-time');
  campo.contentEditable = 'true';
  campo.focus();
});

async function finalizarAtendimento(status) {
  const ativoStr = localStorage.getItem('monitora_upa_atendimento_ativo');
  if (!ativoStr) { mostrarTela('screen-home'); return; }
  if (!sb) {
    alert('Configure o Supabase em app.js para salvar a saída.');
    return;
  }

  const ativo = JSON.parse(ativoStr);
  const saida = parseHoraParaData(document.getElementById('checkout-time').textContent);
  const chegada = new Date(ativo.horarioChegada);
  const minutos = Math.max(0, Math.round((saida - chegada) / 60000));

  const { error } = await sb.from('atendimentos').update({
    horario_saida: saida.toISOString(),
    tempo_permanencia_minutos: minutos,
    status
  }).eq('id', ativo.id);

  if (error) {
    alert('Não foi possível registrar a saída.');
    console.error(error);
    return;
  }

  localStorage.removeItem('monitora_upa_atendimento_ativo');
  mostrarTela('screen-home');
  carregarUpas();
}

document.getElementById('btn-finalizar').addEventListener('click', () => finalizarAtendimento('finalizado'));
document.getElementById('btn-desisti').addEventListener('click', () => finalizarAtendimento('desistiu'));

/* ============================================================
   BARRA DE PROTÓTIPO (navegação manual entre as 3 telas)
   ============================================================ */
document.querySelectorAll('.proto-nav [data-goto]').forEach(btn => {
  btn.addEventListener('click', () => {
    const alvo = btn.dataset.goto;
    if (alvo === 'screen-checkin') {
      const upa = state.upaSelecionada || state.upasCache[0];
      if (upa) iniciarCheckin(upa);
      else alert('Nenhuma UPA carregada ainda. Verifique o Supabase.');
      return;
    }
    if (alvo === 'screen-checkout') {
      carregarCheckout();
      return;
    }
    mostrarTela(alvo);
  });
});

/* ============================================================
   SUGESTÃO AUTOMÁTICA DE UPA POR PROXIMIDADE (check-in)
   ------------------------------------------------------------
   Isto NÃO é geofencing real (o navegador não avisa sozinho
   quando você chega) — é uma sugestão pré-selecionada com base
   na localização já obtida, que a pessoa ainda confirma ou troca.
   É importante descrever assim no trabalho científico: "sugestão
   automática por proximidade, com confirmação do usuário", e não
   "identificação automática de chegada" — isso ainda exigiria
   geofencing em segundo plano, que um site comum não faz.
   ============================================================ */
function sugerirUpaMaisProxima() {
  if (state.upaSelecionada) return; // já existe uma seleção manual, não sobrescreve
  const telaCheckin = document.getElementById('screen-checkin');
  if (!telaCheckin.classList.contains('active')) return;
  if (!state.posicaoUsuario) return;

  const comDistancia = state.upasCache.filter(u => u.distanciaKm !== null);
  if (comDistancia.length === 0) return;

  const maisProxima = comDistancia.reduce((a, b) => (a.distanciaKm < b.distanciaKm ? a : b));
  if (maisProxima.distanciaKm > 1.5) return; // longe demais pra sugerir com segurança

  iniciarCheckin(maisProxima);
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
(async function init() {
  const ativoStr = localStorage.getItem('monitora_upa_atendimento_ativo');
  if (ativoStr) { mostrarTela('screen-home'); } else { iniciarCheckin(null); }

  state.posicaoUsuario = await obterLocalizacao();
  await carregarUpas();
  preencherSelectsDeUpas();
  sugerirUpaMaisProxima();
  atualizarBannerAtivo();
})();
