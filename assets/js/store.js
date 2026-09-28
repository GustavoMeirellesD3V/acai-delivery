/* =========================================================
   Açaí Mais Chantilly — utilidades
   Formatação, PIX copia e cola, links e textos do WhatsApp.
   Sem estado: os dados vivem no Supabase (ver db.js).
   ========================================================= */

const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);
const digits = (s) => String(s || '').replace(/\D/g, '');
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function formatarTelefone(t) {
  const n = digits(t).replace(/^55/, '');
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return t;
}

/* ---------- PIX copia e cola (BR Code / padrão EMV) ---------- */
function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const campoEMV = (id, valor) => id + String(valor.length).padStart(2, '0') + valor;

function pixCopiaECola({ chave, beneficiario, cidade, valor, txid }) {
  const nome = semAcento(beneficiario || 'LOJA').toUpperCase().slice(0, 25);
  const cid = semAcento(cidade || 'BRASIL').toUpperCase().slice(0, 15);
  const id = semAcento(txid || '***').toUpperCase().replace(/[^A-Z0-9*]/g, '').slice(0, 25) || '***';

  let p = '';
  p += campoEMV('00', '01');
  p += campoEMV('26', campoEMV('00', 'br.gov.bcb.pix') + campoEMV('01', String(chave || '').trim()));
  p += campoEMV('52', '0000');
  p += campoEMV('53', '986');
  if (valor > 0) p += campoEMV('54', Number(valor).toFixed(2));
  p += campoEMV('58', 'BR');
  p += campoEMV('59', nome);
  p += campoEMV('60', cid);
  p += campoEMV('62', campoEMV('05', id));
  p += '6304';
  return p + crc16(p);
}

/* ---------- WhatsApp ---------- */
function waLink(telefone, texto) {
  let n = digits(telefone);
  if (n.length <= 11) n = '55' + n;
  return 'https://wa.me/' + n + '?text=' + encodeURIComponent(texto);
}

const aplicarTemplate = (txt, vars) =>
  String(txt || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));

/* ---------- pedido em texto ---------- */
const LABEL_PAGAMENTO = { pix: 'PIX', cartao: 'Cartão (na entrega)', dinheiro: 'Dinheiro' };

function enderecoTexto(p) {
  if (p.tipo !== 'entrega') return 'Retirada no balcão';
  const e = p.endereco || {};
  return [
    [e.rua, e.numero].filter(Boolean).join(', '),
    e.bairro,
    e.complemento,
    e.referencia ? 'Ref.: ' + e.referencia : ''
  ].filter(Boolean).join(' — ');
}

function itemTexto(item) {
  let t = `• ${item.qtd}x ${item.produtoNome} ${item.tamanhoNome}`;
  if (item.sabor) t += ` (sabor ${item.sabor})`;
  t += ` — ${brl(item.preco * item.qtd)}`;
  if (item.complementos && item.complementos.length) t += `\n   ➕ ${item.complementos.join(', ')}`;
  if (item.obs) t += `\n   📝 ${item.obs}`;
  return t;
}

function pedidoParaTexto(pedido, config) {
  const L = [];
  L.push(`*NOVO PEDIDO #${pedido.numero}* — ${config.nomeLoja}`);
  L.push('──────────────');
  L.push(`👤 ${pedido.cliente.nome}`);
  L.push(`📱 ${pedido.cliente.telefone}`);
  L.push('');
  L.push('*ITENS*');
  pedido.itens.forEach((i) => L.push(itemTexto(i)));
  L.push('');
  L.push(`Subtotal: ${brl(pedido.subtotal)}`);
  if (pedido.taxa > 0) L.push(`Taxa de entrega: ${brl(pedido.taxa)}`);
  L.push(`*TOTAL: ${brl(pedido.total)}*`);
  L.push('');
  L.push(`💳 Pagamento: ${LABEL_PAGAMENTO[pedido.pagamento] || pedido.pagamento}`);
  if (pedido.pagamento === 'dinheiro' && pedido.troco) L.push(`💵 Troco para: ${brl(pedido.troco)}`);
  L.push(pedido.tipo === 'entrega' ? `🛵 Entrega: ${enderecoTexto(pedido)}` : '🏪 Retirada no balcão');
  if (pedido.observacao) { L.push(''); L.push(`📝 Observação: ${pedido.observacao}`); }
  return L.join('\n');
}

const STATUS = [
  { id: 'novo', label: 'Novo', msg: 'recebido', cor: 'azul' },
  { id: 'preparo', label: 'Em preparo', msg: 'preparo', cor: 'amarelo' },
  { id: 'saiu', label: 'Saiu para entrega', msg: 'saiu', cor: 'roxo' },
  { id: 'pronto', label: 'Pronto p/ retirada', msg: 'pronto', cor: 'roxo' },
  { id: 'entregue', label: 'Concluído', msg: 'entregue', cor: 'verde' },
  { id: 'cancelado', label: 'Cancelado', msg: 'cancelado', cor: 'vermelho' }
];

function mensagemStatus(pedido, statusId, config) {
  const st = STATUS.find((s) => s.id === statusId);
  if (!st) return '';
  return aplicarTemplate(config.mensagens[st.msg], {
    nome: pedido.cliente.nome.split(' ')[0],
    numero: pedido.numero,
    total: brl(pedido.total),
    pagamento: LABEL_PAGAMENTO[pedido.pagamento] || pedido.pagamento,
    endereco: enderecoTexto(pedido),
    enderecoLoja: config.endereco,
    loja: config.nomeLoja
  });
}

/* =========================================================
   Horário de funcionamento

   A loja abre e fecha sozinha pelo horário da semana.
   O cálculo é sempre no fuso de São Paulo — um cliente
   acessando de outro fuso vê o status certo da loja.
   ========================================================= */

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const FUSO = 'America/Sao_Paulo';

/* "14:30" → 870 minutos. Devolve null se o formato não servir. */
function paraMinutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const paraHora = (min) =>
  String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');

/* Momento atual no fuso da loja, independente de onde o cliente está. */
function agoraNaLoja(quando) {
  const d = quando || new Date();
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d);

  const p = {};
  partes.forEach((x) => { p[x.type] = x.value; });

  const semana = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hora = p.hour === '24' ? 0 : +p.hour;   // alguns ambientes devolvem 24 à meia-noite
  return { dia: semana[p.weekday], minutos: hora * 60 + (+p.minute) };
}

const horarioDoDia = (config, dia) => (config.horarios || {})[String(dia)] || null;

/* A loja está dentro de um turno neste instante?
   Trata turno que vira a madrugada (ex.: 18:00 → 02:00). */
function dentroDoTurno(config, dia, minutos) {
  const h = horarioDoDia(config, dia);
  if (!h || h.fechado) return false;
  const abre = paraMinutos(h.abre), fecha = paraMinutos(h.fecha);
  if (abre == null || fecha == null) return false;
  if (fecha > abre) return minutos >= abre && minutos < fecha;
  if (fecha < abre) return minutos >= abre;        // até a meia-noite; a madrugada é do dia seguinte
  return false;                                     // abre == fecha: dia sem expediente
}

/* O turno de ontem ainda está rolando? (aberto 18:00 → 02:00, agora 01:00) */
function sobraDeOntem(config, dia, minutos) {
  const ontem = (dia + 6) % 7;
  const h = horarioDoDia(config, ontem);
  if (!h || h.fechado) return false;
  const abre = paraMinutos(h.abre), fecha = paraMinutos(h.fecha);
  if (abre == null || fecha == null || fecha >= abre) return false;
  return minutos < fecha;
}

/* Quando abre de novo: varre os próximos 7 dias. */
function proximaAbertura(config, dia, minutos) {
  for (let i = 0; i < 8; i++) {
    const d = (dia + i) % 7;
    const h = horarioDoDia(config, d);
    if (!h || h.fechado) continue;
    const abre = paraMinutos(h.abre);
    if (abre == null) continue;
    if (i === 0 && minutos >= abre) continue;      // hoje já passou do horário de abrir
    return { dia: d, hora: h.abre, ehHoje: i === 0, ehAmanha: i === 1 };
  }
  return null;
}

/* Estado completo da loja agora. */
function estadoDaLoja(config, quando) {
  const { dia, minutos } = agoraNaLoja(quando);

  // interruptor manual: fecha na hora, independente do horário
  if (config.fechadoManual) {
    const prox = proximaAbertura(config, dia, minutos);
    return { aberta: false, motivo: 'manual', proxima: prox,
             texto: 'Fechada no momento', detalhe: textoProxima(prox) };
  }

  // sem horários configurados: cai no interruptor antigo
  if (!config.horarios || !Object.keys(config.horarios).length) {
    return { aberta: config.aberta !== false, motivo: 'sem-horario',
             texto: config.aberta !== false ? 'Aberta agora' : 'Fechada', detalhe: '' };
  }

  if (dentroDoTurno(config, dia, minutos)) {
    const fecha = horarioDoDia(config, dia).fecha;
    const faltam = (paraMinutos(fecha) - minutos + 1440) % 1440;
    return {
      aberta: true, motivo: 'horario', texto: 'Aberta agora',
      detalhe: faltam <= 60 ? `fecha às ${fecha} (em ${faltam} min)` : `até às ${fecha}`
    };
  }

  if (sobraDeOntem(config, dia, minutos)) {
    const fecha = horarioDoDia(config, (dia + 6) % 7).fecha;
    return { aberta: true, motivo: 'horario', texto: 'Aberta agora', detalhe: `até às ${fecha}` };
  }

  const prox = proximaAbertura(config, dia, minutos);
  return { aberta: false, motivo: 'horario', proxima: prox,
           texto: 'Fechada agora', detalhe: textoProxima(prox) };
}

function textoProxima(prox) {
  if (!prox) return 'sem horário definido';
  if (prox.ehHoje) return `abre hoje às ${prox.hora}`;
  if (prox.ehAmanha) return `abre amanhã às ${prox.hora}`;
  return `abre ${DIAS[prox.dia]} às ${prox.hora}`;
}

/* Resumo da semana em linguagem humana, agrupando dias iguais.
   "Seg a Sex 14:00–23:00 · Sáb e Dom 13:00–00:00 · Ter fechado" */
function resumoSemana(config) {
  const h = config.horarios;
  if (!h || !Object.keys(h).length) return config.horario || '';

  const ordem = [1, 2, 3, 4, 5, 6, 0];   // segunda → domingo
  const chave = (d) => {
    const x = h[String(d)];
    if (!x || x.fechado) return 'fechado';
    return x.abre + '–' + x.fecha;
  };

  const blocos = [];
  ordem.forEach((d) => {
    const k = chave(d);
    const ult = blocos[blocos.length - 1];
    if (ult && ult.k === k) ult.dias.push(d);
    else blocos.push({ k, dias: [d] });
  });

  return blocos.map((b) => {
    const nomes = b.dias.length === 1 ? DIAS_CURTO[b.dias[0]]
      : b.dias.length === 2 ? `${DIAS_CURTO[b.dias[0]]} e ${DIAS_CURTO[b.dias[1]]}`
      : `${DIAS_CURTO[b.dias[0]]} a ${DIAS_CURTO[b.dias[b.dias.length - 1]]}`;
    return b.k === 'fechado' ? `${nomes} fechado` : `${nomes} ${b.k}`;
  }).join(' · ');
}

const HORARIOS_PADRAO = {
  '0': { abre: '14:00', fecha: '23:00', fechado: false },
  '1': { abre: '14:00', fecha: '23:00', fechado: false },
  '2': { abre: '14:00', fecha: '23:00', fechado: false },
  '3': { abre: '14:00', fecha: '23:00', fechado: false },
  '4': { abre: '14:00', fecha: '23:00', fechado: false },
  '5': { abre: '14:00', fecha: '23:00', fechado: false },
  '6': { abre: '14:00', fecha: '23:00', fechado: false }
};
