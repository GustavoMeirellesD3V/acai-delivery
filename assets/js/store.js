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
