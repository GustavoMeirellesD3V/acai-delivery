/* =========================================================
   Gerador de QR Code — sem dependência externa
   Modo byte, níveis L/M/Q/H, versões 1 a 40.
   Uso: QR.desenhar(elemento, texto, { tamanho: 148, nivel: 'M' })
   ========================================================= */

(function (raiz) {
  'use strict';

  // Códigos de correção por bloco, por nível e versão (1..40)
  const EC_POR_BLOCO = {
    L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  };

  const BLOCOS = {
    L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  };

  const BITS_NIVEL = { L: 1, M: 0, Q: 3, H: 2 };

  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  /* ---- geometria ---- */
  function modulosBrutos(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }
  const totalCodewords = (v) => Math.floor(modulosBrutos(v) / 8);

  function posAlinhamento(v) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2;
    const passo = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n - 1) / 2) * 2;
    const r = [6];
    for (let p = v * 4 + 10; r.length < n; p -= passo) r.splice(1, 0, p);
    return r;
  }

  /* ---- Reed-Solomon em GF(256) ---- */
  function gfMul(a, b) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((b >>> i) & 1) * a;
    }
    return z & 0xff;
  }

  function divisorRS(grau) {
    const d = new Uint8Array(grau);
    d[grau - 1] = 1;
    let raizDoGrau = 1;
    for (let i = 0; i < grau; i++) {
      for (let j = 0; j < grau; j++) {
        d[j] = gfMul(d[j], raizDoGrau);
        if (j + 1 < grau) d[j] ^= d[j + 1];
      }
      raizDoGrau = gfMul(raizDoGrau, 0x02);
    }
    return d;
  }

  function restoRS(dados, divisor) {
    const r = new Uint8Array(divisor.length);
    for (const b of dados) {
      const fator = b ^ r[0];
      r.copyWithin(0, 1);
      r[r.length - 1] = 0;
      for (let i = 0; i < divisor.length; i++) r[i] ^= gfMul(divisor[i], fator);
    }
    return r;
  }

  /* ---- texto → bytes UTF-8 ---- */
  function paraBytes(txt) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(txt));
    const out = [];
    for (const ch of unescape(encodeURIComponent(txt))) out.push(ch.charCodeAt(0));
    return out;
  }

  /* ---- montagem dos codewords ---- */
  function bitsContagem(v) { return v <= 9 ? 8 : 16; }

  function escolherVersao(nBytes, nivel) {
    for (let v = 1; v <= 40; v++) {
      const cap = (totalCodewords(v) - EC_POR_BLOCO[nivel][v - 1] * BLOCOS[nivel][v - 1]) * 8;
      if (4 + bitsContagem(v) + nBytes * 8 <= cap) return v;
    }
    throw new Error('Conteúdo longo demais para um QR Code');
  }

  function montarDados(bytes, v, nivel) {
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };

    push(4, 4);                       // modo byte
    push(bytes.length, bitsContagem(v));
    bytes.forEach((b) => push(b, 8));

    const cap = (totalCodewords(v) - EC_POR_BLOCO[nivel][v - 1] * BLOCOS[nivel][v - 1]) * 8;
    push(0, Math.min(4, cap - bits.length));      // terminador
    push(0, (8 - bits.length % 8) % 8);           // alinha em byte

    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      cw.push(b);
    }
    for (let pad = 0xec; cw.length < cap / 8; pad ^= 0xec ^ 0x11) cw.push(pad);
    return cw;
  }

  function intercalar(dados, v, nivel) {
    const nBlocos = BLOCOS[nivel][v - 1];
    const ecLen = EC_POR_BLOCO[nivel][v - 1];
    const bruto = totalCodewords(v);
    const curtos = nBlocos - bruto % nBlocos;
    const lenCurto = Math.floor(bruto / nBlocos);
    const divisor = divisorRS(ecLen);

    const blocos = [];
    let k = 0;
    for (let i = 0; i < nBlocos; i++) {
      const tam = lenCurto - ecLen + (i < curtos ? 0 : 1);
      const dat = dados.slice(k, k + tam);
      k += tam;
      const ecc = Array.from(restoRS(dat, divisor));
      if (i < curtos) dat.push(0); // espaço fantasma, removido na intercalação
      blocos.push(dat.concat(ecc));
    }

    const saida = [];
    for (let i = 0; i < blocos[0].length; i++) {
      for (let j = 0; j < blocos.length; j++) {
        if (i !== lenCurto - ecLen || j >= curtos) saida.push(blocos[j][i]);
      }
    }
    return saida;
  }

  /* ---- matriz ---- */
  function novaMatriz(v, nivel, dados) {
    const size = v * 4 + 17;
    const mod = [], fun = [];
    for (let y = 0; y < size; y++) { mod.push(new Array(size).fill(false)); fun.push(new Array(size).fill(false)); }

    const set = (x, y, cor) => { mod[y][x] = cor; fun[y][x] = true; };

    // temporização
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }

    // localizadores
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    // alinhamento
    const pos = posAlinhamento(v);
    for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }

    // versão (7+)
    if (v >= 7) {
      let rem = v;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (v << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const cor = bit(bits, i), a = size - 11 + i % 3, b = Math.floor(i / 3);
        set(a, b, cor); set(b, a, cor);
      }
    }

    const formato = (mask) => {
      const d = (BITS_NIVEL[nivel] << 3) | mask;
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((d << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
      set(8, 7, bit(bits, 6));
      set(8, 8, bit(bits, 7));
      set(7, 8, bit(bits, 8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
      set(8, size - 8, true);
    };
    formato(0);

    // dados em zigue-zague
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const subindo = ((right + 1) & 2) === 0;
          const y = subindo ? size - 1 - vert : vert;
          if (!fun[y][x] && i < dados.length * 8) {
            mod[y][x] = bit(dados[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }

    return { size, mod, fun, formato };
  }

  const MASCARAS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
  ];

  function aplicarMascara(m, mask) {
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) {
      if (!m.fun[y][x] && MASCARAS[mask](x, y)) m.mod[y][x] = !m.mod[y][x];
    }
  }

  function penalidade(m) {
    const n = m.size;
    let p = 0;

    const linha = (get) => {
      for (let a = 0; a < n; a++) {
        let cor = get(a, 0), run = 1;
        const hist = [];
        for (let b = 1; b < n; b++) {
          const c = get(a, b);
          if (c === cor) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; }
          else { hist.push(run); cor = c; run = 1; }
        }
        hist.push(run);
        // padrão 1:1:3:1:1 (finder falso)
        for (let k = 0; k + 4 < hist.length; k++) {
          const [a1, b1, c1, d1, e1] = hist.slice(k, k + 5);
          if (b1 === a1 && c1 === a1 * 3 && d1 === a1 && e1 === a1) p += 40;
        }
      }
    };
    linha((a, b) => m.mod[a][b]);
    linha((a, b) => m.mod[b][a]);

    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const c = m.mod[y][x];
      if (c === m.mod[y][x + 1] && c === m.mod[y + 1][x] && c === m.mod[y + 1][x + 1]) p += 3;
    }

    let escuros = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m.mod[y][x]) escuros++;
    const total = n * n;
    p += Math.ceil(Math.abs(escuros * 20 - total * 10) / total) * 10;
    return p;
  }

  /* ---- API ---- */
  function matriz(texto, nivel) {
    nivel = nivel || 'M';
    const bytes = paraBytes(texto);
    const v = escolherVersao(bytes.length, nivel);
    const dados = intercalar(montarDados(bytes, v, nivel), v, nivel);
    const m = novaMatriz(v, nivel, dados);

    let melhor = -1, melhorNota = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      m.formato(mask);
      aplicarMascara(m, mask);
      const nota = penalidade(m);
      if (nota < melhorNota) { melhorNota = nota; melhor = mask; }
      aplicarMascara(m, mask); // desfaz
    }
    m.formato(melhor);
    aplicarMascara(m, melhor);
    return { tamanho: m.size, versao: v, mascara: melhor, modulos: m.mod };
  }

  function desenhar(alvo, texto, opts) {
    opts = opts || {};
    const q = matriz(texto, opts.nivel || 'M');
    const margem = opts.margem == null ? 2 : opts.margem;
    const lado = q.tamanho + margem * 2;
    const px = Math.max(1, Math.floor((opts.tamanho || 148) / lado));
    const dim = px * lado;

    const cv = document.createElement('canvas');
    const escala = (raiz.devicePixelRatio || 1);
    cv.width = dim * escala;
    cv.height = dim * escala;
    cv.style.width = dim + 'px';
    cv.style.height = dim + 'px';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'QR Code para pagamento PIX');

    const ctx = cv.getContext('2d');
    ctx.scale(escala, escala);
    ctx.fillStyle = opts.fundo || '#ffffff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = opts.cor || '#000000';
    for (let y = 0; y < q.tamanho; y++) {
      for (let x = 0; x < q.tamanho; x++) {
        if (q.modulos[y][x]) ctx.fillRect((x + margem) * px, (y + margem) * px, px, px);
      }
    }

    alvo.innerHTML = '';
    alvo.appendChild(cv);
    return q;
  }

  raiz.QR = { matriz, desenhar };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.QR;
})(typeof window !== 'undefined' ? window : globalThis);
