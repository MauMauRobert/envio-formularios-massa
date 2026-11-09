import PDFDocument from 'pdfkit';
import { imageSize } from 'image-size';
import { parseNumero, fmtMoeda } from './template.js';

// Layout "Termo de Adesão": 5 seções numeradas em posições fixas (sempre
// 1 página). Rótulos fixos, valores dinâmicos via {{colunas}} da planilha.
const TEAL = '#00B894';
const DTEAL = '#009A7C';
const INK = '#1F2A30';
const GRAY = '#6B7A82';
const CARD1 = '#F4FBF9';
const CARD2 = '#E6F8F3';
const LINE = '#DCE5E3';
const SUB = '#D9F5EE';
const WARNBG = '#FFF6E0';
const WARNBAR = '#B7791F';
const W = 595.2756;
const MARCA = 'GAYA • Inove seu mundo.';

function temGlifo(fonte, ch) {
  try {
    return fonte.glyphForCodePoint(ch.codePointAt(0)).id !== 0;
  } catch {
    return false;
  }
}

function segmentar(FKS, str, base) {
  const runs = [];
  let cur = null;
  for (const ch of String(str)) {
    const fonte = (FKS[base] && !temGlifo(FKS[base], ch) && FKS.emoji && temGlifo(FKS.emoji, ch)) ? 'emoji' : base;
    if (!cur || cur.fonte !== fonte) {
      cur = { fonte, text: '' };
      runs.push(cur);
    }
    cur.text += ch;
  }
  return runs;
}

function imagemValida(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1], 'base64');
    const dim = imageSize(buf);
    if (!dim || !dim.width || !dim.height) return null;
    return { buf, w: dim.width, h: dim.height };
  } catch {
    return null;
  }
}

export function construirTermo(campanha, contato, opts = {}, filename, FONTES) {
  return new Promise((resolve, reject) => {
    const rascunho = !!opts.rascunho;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: true,
      info: { Title: `Formulário assinado — ${campanha.titulo}`, Author: 'Envio de formulários' },
    });
    let F = { normal: 'Helvetica', bold: 'Helvetica-Bold', preto: 'Helvetica-Bold', italico: 'Helvetica-Oblique', script: 'Helvetica-Oblique', emoji: 'Helvetica' };
    if (FONTES) {
      try {
        doc.registerFont('Texto', FONTES.arqs.normal);
        doc.registerFont('Texto-Negrito', FONTES.arqs.bold);
        doc.registerFont('Preto', FONTES.arqs.black || FONTES.arqs.bold);
        doc.registerFont('Italico', FONTES.arqs.italic || FONTES.arqs.normal);
        doc.registerFont('Manuscrita', FONTES.arqs.script);
        doc.registerFont('Emoji', FONTES.arqs.emoji);
        F = { normal: 'Texto', bold: 'Texto-Negrito', preto: 'Preto', italico: 'Italico', script: 'Manuscrita', emoji: 'Emoji' };
      } catch {
        F = { normal: 'Helvetica', bold: 'Helvetica-Bold', preto: 'Helvetica-Bold', italico: 'Helvetica-Oblique', script: 'Helvetica-Oblique', emoji: 'Helvetica' };
      }
    }
    const FKS = FONTES ? FONTES.fks : null;
    const escrever = (base, str, x, y, o = {}) => {
      const runs = FKS ? segmentar(FKS, str, base) : [{ fonte: base, text: String(str) }];
      runs.forEach((run, i) => {
        doc.font(F[run.fonte]);
        const opt = { ...o, continued: i < runs.length - 1 };
        if (i === 0) doc.text(run.text, x, y, opt);
        else doc.text(run.text, opt);
      });
    };
    const chunks = [];
    let totalPages = 0;
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), filename, pages: totalPages }));

    // Valores dinâmicos: linha da planilha, depois dados do grupo.
    const linha = (opts.linha && typeof opts.linha === 'object') ? opts.linha : {};
    const dadosG = (opts.dados && typeof opts.dados === 'object') ? opts.dados : {};
    const slot = (...nomes) => {
      for (const fonte of [linha, dadosG]) {
        const chaves = Object.keys(fonte);
        for (const n of nomes) {
          const k = chaves.find((c) => c.toLowerCase() === n.toLowerCase());
          const v = k !== undefined ? String(fonte[k] ?? '').trim() : '';
          if (v) return v;
        }
      }
      return '';
    };
    const num = parseNumero;
    const moedaFmt = fmtMoeda;
    const fatRaw = slot('VLR_TOTAL', 'FATURAMENTO', 'VALOR_TOTAL', 'VLR');
    const fatNum = num(fatRaw);
    const fatTxt = fatRaw ? (fatNum !== null ? moedaFmt(fatNum) : fatRaw) : '';
    const metaRaw = slot('META', 'VLR_META', 'VLR_NOVO', 'META_CLIENTE');
    const metaTxt = metaRaw ? (num(metaRaw) !== null ? moedaFmt(num(metaRaw)) : metaRaw)
      : (fatNum !== null ? moedaFmt(Math.round(fatNum * 1.1 * 100) / 100) : '');
    const cnpj = slot('CNPJ', 'CNPJ_MATRIZ');
    const rep = slot('REPRESENTANTE', 'REPRESENTANTE_GAYA', 'VENDEDOR');
    const mesRef = slot('MES_REF', 'MES_REFERENCIA') || 'NOVEMBRO/2025';
    const mesMeta = slot('MES_META') || 'NOVEMBRO/2026';
    const mesApur = slot('MES_APURACAO', 'APURACAO') || 'dezembro/2026';
    const periodo = slot('PERIODO') || '01 a 30 de novembro de 2026';
    const limite = slot('DATA_LIMITE', 'PRAZO') || '15/11/2026';
    const cashback = slot('CASHBACK') || '1%';
    const pct = slot('PCT_META', 'PERCENTUAL') || '+10%';
    const tagline = String(campanha.destaque || '').trim();
    const emailTxt = (contato.email || '').trim() || '(não informado)';
    const dataAss = rascunho ? '' : String(contato.assinado_em || '').slice(0, 10);

    const poly = (pts, fill, stroke, lw = 0.8) => {
      doc.save();
      doc.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) doc.lineTo(pts[i][0], pts[i][1]);
      doc.closePath();
      if (fill && stroke) doc.fillColor(fill).strokeColor(stroke).lineWidth(lw).fillAndStroke();
      else if (fill) doc.fillColor(fill).fill();
      else doc.strokeColor(stroke).lineWidth(lw).stroke();
      doc.restore();
    };
    const disc = (cx, cy, r, fill) => {
      doc.save();
      doc.fillColor(fill).circle(cx, cy, r).fill();
      doc.restore();
    };
    const t = (base, str, x, y, size, color) => {
      doc.fillColor(color).font(F[base]).fontSize(size);
      escrever(base, str, x, y);
    };
    const larguraDe = (str, font, size) => doc.font(font).fontSize(size).widthOfString(String(str));
    const ajusta = (str, w, size, font) => {
      let s = String(str ?? '');
      doc.font(font).fontSize(size);
      if (doc.widthOfString(s) <= w) return s;
      while (s.length > 1 && doc.widthOfString(s + '…') > w) s = s.slice(0, -1);
      return s + '…';
    };
    const fonteAuto = (str, w, max, min, font) => {
      let s = max;
      doc.font(font);
      while (s > min && doc.fontSize(s).widthOfString(String(str)) > w) s -= 0.5;
      return s;
    };
    const badge = (cx, cy, n) => {
      disc(cx, cy, 8.5, TEAL);
      doc.font(F.preto).fontSize(10);
      t('preto', String(n), cx - larguraDe(String(n), F.preto, 10) / 2, cy - 5, 10, '#ffffff');
    };
    const secao = (n, titulo, cy) => {
      badge(48.5, cy, n);
      t('preto', titulo, 65, cy - 8, 12, INK);
      const fim = 65 + larguraDe(titulo, F.preto, 12) + 8;
      doc.save().strokeColor(LINE).lineWidth(0.8).moveTo(fim, cy + 0.3).lineTo(555, cy + 0.3).stroke().restore();
    };
    const rotulo = (txt, x, y) => t('bold', txt, x, y, 7.5, GRAY);
    const valor = (txt, x, y, w, size = 11) => {
      const s = fonteAuto(txt, w, size, 6.5, F.bold);
      t('bold', ajusta(txt, w, s, F.bold), x, y, s, INK);
    };
    const linhaMista = (segs, x, y, size, maxW) => {
      let s = size;
      const total = () => segs.reduce((a, g) => a + larguraDe(g.texto, F[g.base], s), 0);
      while (s > 7 && total() > maxW) s -= 0.5;
      let cx = x;
      segs.forEach((g, i) => {
        let txt = g.texto;
        if (i === segs.length - 1 && total() > maxW) txt = ajusta(txt, Math.max(20, maxW - (cx - x)), s, F[g.base]);
        t(g.base, txt, cx, y, s, g.cor);
        cx += larguraDe(txt, F[g.base], s);
      });
    };

    // Cabeçalho
    doc.save().fillColor(TEAL).rect(0, 0, W, 104).fill().restore();
    doc.save().fillColor(DTEAL).rect(0, 100, W, 4).fill().restore();
    const logo = imagemValida(campanha.logo);
    if (logo) {
      poly([[47, 72], [95, 72], [102, 45], [47, 38], [40, 65]], '#ffffff', null);
      const k = Math.min(50 / logo.w, 24 / logo.h);
      const lw = logo.w * k;
      const lh = logo.h * k;
      try {
        doc.image(logo.buf, 46, 46 + (24 - lh) / 2, { width: lw, height: lh });
      } catch { /* ignora logo inválido */ }
    }
    t('preto', rascunho ? 'Formulário para assinatura' : 'Formulário assinado', 116, 29, 20, '#ffffff');
    t('normal', campanha.titulo, 117, 56, 10, SUB);
    if (tagline) {
      const tag = ajusta(tagline.toUpperCase(), 399, 8.5, F.bold);
      const sTag = fonteAuto(tag, 399, 8.5, 6.5, F.bold);
      const tw = larguraDe(tag, F.bold, sTag);
      const x0 = 124.5;
      const w = tw + 23.5;
      poly([[x0, 92], [x0 + w, 92], [x0 + w + 8.5, 83.5], [x0, 75], [x0 - 8.5, 83.5]], '#ffffff', LINE, 0.6);
      t('bold', tag, x0 + 3.5, 79, sTag, DTEAL);
    }

    // Banner (alinha como configurado; sem ele as seções sobem)
    const banner = imagemValida(campanha.imagem);
    const DY = banner ? 0 : -97;
    const Y = (v) => v + DY;
    if (banner) {
      const k = Math.min(483 / banner.w, 85 / banner.h);
      const w2 = banner.w * k;
      const h2 = banner.h * k;
      const bx = campanha.imagem_alinhamento === 'centro' ? 56 + (483 - w2) / 2 : campanha.imagem_alinhamento === 'direita' ? 56 + 483 - w2 : 56;
      try {
        doc.image(banner.buf, bx, 120, { width: w2, height: h2 });
      } catch { /* ignora imagem inválida */ }
    }

    // 1. Dados do cliente
    secao('1', 'Dados do cliente', Y(228.4));
    poly([[48, Y(295)], [547, Y(295)], [555, Y(253)], [48, Y(245)], [40, Y(287)]], CARD1, LINE);
    doc.save().strokeColor(LINE).lineWidth(0.8)
      .moveTo(268.3, Y(285)).lineTo(268.3, Y(255)).stroke()
      .moveTo(355.3, Y(285)).lineTo(355.3, Y(255)).stroke().restore();
    rotulo('CLIENTE', 56, Y(256));
    rotulo('CNPJ', 278.3, Y(256));
    rotulo('REPRESENTANTE GAYA', 365.3, Y(256));
    valor(contato.nome, 56, Y(270), 204);
    valor(cnpj, 278.3, Y(270), 69);
    valor(rep, 365.3, Y(270), 181);

    // 2. Meta do cliente
    secao('2', 'Meta do cliente', Y(318.2));
    poly([[48, Y(400)], [282, Y(400)], [290, Y(342)], [48, Y(334)], [40, Y(392)]], '#ffffff', LINE);
    poly([[312, Y(400)], [547, Y(400)], [555, Y(342)], [312, Y(334)], [304, Y(392)]], '#ffffff', LINE);
    rotulo('FATURAMENTO EM ' + mesRef, 56, Y(346));
    rotulo('META PARA ' + mesMeta, 320.6, Y(346));
    valor(fatTxt, 56, Y(360), 220, 20);
    valor(metaTxt, 320.6, Y(360), 175, 20);
    poly([[293.6, Y(362)], [302.6, Y(367)], [293.6, Y(372)]], TEAL, null);
    poly([[510, Y(358)], [536, Y(358)], [543, Y(351)], [510, Y(344)], [503, Y(351)]], '#ffffff', null);
    t('bold', pct, 513, Y(346), 8, DTEAL);

    // 3. Benefícios
    secao('3', 'Ao atingir a meta, o cliente ganha', Y(423.2));
    poly([[48, Y(491)], [282, Y(491)], [290, Y(445)], [48, Y(437)], [40, Y(483)]], CARD2, LINE);
    poly([[312, Y(491)], [547, Y(491)], [555, Y(445)], [312, Y(437)], [304, Y(483)]], CARD2, LINE);
    disc(68, Y(463.7), 10, TEAL);
    doc.font(F.preto).fontSize(13);
    t('preto', '%', 68 - larguraDe('%', F.preto, 13) / 2, Y(457), 13, '#ffffff');
    t('bold', cashback + ' de cashback', 86, Y(448), 11, DTEAL);
    {
      const d1 = 'sobre o valor comprado em ' + mesMeta.toLowerCase() + ',';
      const d2 = 'desconto de duplicata.';
      const s = Math.min(fonteAuto(d1, 196, 8.5, 6.5, F.normal), fonteAuto(d2, 196, 8.5, 6.5, F.normal));
      t('normal', ajusta(d1, 196, s, F.normal), 86, Y(463), s, INK);
      t('normal', ajusta(d2, 196, s, F.normal), 86, Y(474), s, INK);
    }
    disc(332.6, Y(463.7), 10, TEAL);
    doc.save().fillColor('#ffffff').rect(323.1, Y(461.8), 13, 8.5).fill().rect(322.1, Y(457.7), 15, 3.5).fill().restore();
    doc.save().fillColor(TEAL).rect(328.6, Y(457.7), 2, 12.5).fill().restore();
    doc.save().strokeColor('#ffffff').lineWidth(1.4).moveTo(329.4, Y(455.7)).lineTo(334.4, Y(455.7)).stroke().restore();
    t('bold', 'Sorteio de um iPhone 17 Pro', 350.6, Y(448), 11, DTEAL);
    {
      const d1 = 'realizado em ' + mesApur + ', após a apuração dos';
      const d2 = 'resultados.';
      const s = Math.min(fonteAuto(d1, 196, 8.5, 6.5, F.normal), fonteAuto(d2, 196, 8.5, 6.5, F.normal));
      t('normal', ajusta(d1, 196, s, F.normal), 350.6, Y(463), s, INK);
      t('normal', ajusta(d2, 196, s, F.normal), 350.6, Y(474), s, INK);
    }

    // 4. Condições
    secao('4', 'Condições', Y(514.2));
    linhaMista([
      { texto: 'Vale o faturado de ', base: 'normal', cor: INK },
      { texto: periodo, base: 'bold', cor: INK },
    ], 56, Y(530), 9.5, 499);
    poly([[46, Y(576)], [549, Y(576)], [555, Y(556)], [46, Y(550)], [40, Y(570)]], WARNBG, null);
    doc.save().fillColor(WARNBAR).rect(40, Y(549.7), 3.5, 26).fill().restore();
    disc(60, Y(562.9), 8, WARNBAR);
    doc.font(F.preto).fontSize(10);
    t('preto', '!', 60 - larguraDe('!', F.preto, 10) / 2, Y(557.5), 10, '#ffffff');
    linhaMista([
      { texto: 'Este termo deve ser assinado e devolvido até ', base: 'normal', cor: INK },
      { texto: limite, base: 'bold', cor: INK },
      { texto: '. Cliente sem termo assinado não participa.', base: 'normal', cor: INK },
    ], 72, Y(557), 9.5, 483);

    // 5. Identificação e assinatura
    secao('5', 'Identificação e assinatura', Y(600.2));
    rotulo('NOME DO CLIENTE', 40, Y(616));
    rotulo('E-MAIL', 304.6, Y(616));
    valor(contato.nome, 40, Y(628), 250);
    if (emailTxt === '(não informado)') t('italico', emailTxt, 304.6, Y(628), 11, GRAY);
    else valor(emailTxt, 304.6, Y(628), 250);
    doc.save().strokeColor(LINE).lineWidth(0.8)
      .moveTo(40, Y(645.7)).lineTo(290, Y(645.7)).stroke()
      .moveTo(304.6, Y(645.7)).lineTo(555, Y(645.7)).stroke().restore();
    poly([[48, Y(736)], [547, Y(736)], [555, Y(664)], [48, Y(656)], [40, Y(728)]], '#ffffff', LINE);
    rotulo('ASSINATURA', 60, Y(664));
    doc.save().strokeColor(INK).lineWidth(0.9)
      .moveTo(60, Y(701.7)).lineTo(359.5, Y(701.7)).stroke()
      .moveTo(383.5, Y(701.7)).lineTo(535, Y(701.7)).stroke().restore();
    t('normal', 'Assinatura do responsável', 60, Y(708), 8, GRAY);
    t('normal', 'Data', 383.5, Y(708), 8, GRAY);
    if (rascunho) {
      t('normal', '/', 433.7, Y(685.7), 11, INK);
      t('normal', '/', 480.3, Y(685.7), 11, INK);
      t('italico', 'Assine acima após imprimir.', 60, Y(720), 7.5, GRAY);
    } else {
      const ass = String(contato.assinatura || contato.nome);
      const sAss = fonteAuto(ass, 299, 30, 16, F.script);
      t('script', ajusta(ass, 299, sAss, F.script), 60, Y(669), sAss, DTEAL);
      if (dataAss) {
        doc.font(F.bold).fontSize(11);
        t('bold', dataAss, 459 - larguraDe(dataAss, F.bold, 11) / 2, Y(690), 11, INK);
      }
      t('italico', 'Assinatura digitada pelo titular através do link individual enviado ao e-mail acima.', 60, Y(720), 7.5, GRAY);
    }

    // Rodapé
    doc.save().fillColor(TEAL).rect(0, 836, W, 6).fill().restore();
    doc.save().strokeColor(LINE).lineWidth(0.6).moveTo(40, 811.9).lineTo(555, 811.9).stroke().restore();
    t('bold', MARCA, 40, 817, 7.5, GRAY);
    const geradoEm = new Date().toLocaleString('pt-BR');
    const suf = `${rascunho ? 'Formulário para assinatura' : 'Cópia do formulário assinado'} • ${rascunho ? 'Emitido' : 'Gerada'} em ${geradoEm} • Página 1 de 1`;
    doc.font(F.normal).fontSize(7.5);
    t('normal', suf, 555 - larguraDe(suf, F.normal, 7.5), 817, 7.5, GRAY);

    totalPages = doc.bufferedPageRange().count;
    doc.end();
  });
}
