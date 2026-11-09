import PDFDocument from 'pdfkit';
import { openSync } from 'fontkit';
import { imageSize } from 'image-size';
import { construirTermo } from './termo.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const COR = '#00B894';
const COR_ESCURA = '#00947e';
const TINTA = '#1c1917';
const CINZA = '#57534e';
const BORDA = '#d6d3d1';
const MARGEM = 56;

// Fontes embutidas (acentos, manuscrita da assinatura e emojis).
// Se algum arquivo sumir ou não abrir, volta para as fontes padrão do PDF.
const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'fonts');
function carregarFontes() {
  try {
    const arqs = {
      normal: path.join(FONT_DIR, 'Sans-Regular.ttf'),
      bold: path.join(FONT_DIR, 'Sans-Bold.ttf'),
      script: path.join(FONT_DIR, 'Assinatura.ttf'),
      emoji: path.join(FONT_DIR, 'Emoji.ttf'),
    };
    for (const f of Object.values(arqs)) {
      if (fs.statSync(f).size < 10000) return null;
    }
    const fks = {
      normal: openSync(arqs.normal),
      bold: openSync(arqs.bold),
      script: openSync(arqs.script),
      emoji: openSync(arqs.emoji),
    };
    const arqsOpt = {};
    for (const [chave, arq, fk] of [['black', 'Lato-Black.ttf', 'preto'], ['italic', 'Lato-Italic.ttf', 'italico']]) {
      try {
        const p = path.join(FONT_DIR, arq);
        if (fs.statSync(p).size >= 10000) {
          arqsOpt[chave] = p;
          fks[fk] = openSync(p);
        }
      } catch { /* fonte opcional */ }
    }
    return { arqs: { ...arqs, ...arqsOpt }, fks };
  } catch {
    return null;
  }
}
const FONTES = carregarFontes();

function slug(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'assinado';
}

function temGlifo(fonte, ch) {
  try {
    return fonte.glyphForCodePoint(ch.codePointAt(0)).id !== 0;
  } catch {
    return false;
  }
}

// Divide o texto em trechos por fonte: usa a base, e cai para a fonte de
// emoji só nos caracteres que a base não tem e o emoji tem.
function segmentar(str, base) {
  const runs = [];
  let cur = null;
  for (const ch of String(str)) {
    const fonte = (!temGlifo(FONTES.fks[base], ch) && temGlifo(FONTES.fks.emoji, ch)) ? 'emoji' : base;
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

// O PDF sai sempre em 1 página: tenta no tamanho normal, encolhe letra e
// espaçamentos até o piso e, em último caso, corta a descrição com "…".
export async function gerarPdf(campanha, contato, opts = {}) {
  const rascunho = !!opts.rascunho;
  const filename = rascunho ? `formulario-${opts.numero || 1}-${slug(contato.nome)}.pdf` : `formulario-assinado-${slug(contato.nome)}.pdf`;
  if ((campanha.layout_pdf || 'termo') !== 'livre') return construirTermo(campanha, contato, opts, filename, FONTES);
  const descCheia = String(campanha.descricao || '').trim() || '(sem descrição)';
  const construir = (escala, descSobrescrita) => new Promise((resolve, reject) => {
    const fz = (v) => Math.max(6, v * escala);
    const sp = (v) => v * escala;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, bottom: 64, left: MARGEM, right: MARGEM },
      bufferPages: true,
      info: { Title: `Formulário assinado — ${campanha.titulo}`, Author: 'Envio de formulários' },
    });
    let F = { normal: 'Helvetica', bold: 'Helvetica-Bold', script: 'Helvetica-Oblique', emoji: 'Helvetica' };
    if (FONTES) {
      try {
        doc.registerFont('Texto', FONTES.arqs.normal);
        doc.registerFont('Texto-Negrito', FONTES.arqs.bold);
        doc.registerFont('Manuscrita', FONTES.arqs.script);
        doc.registerFont('Emoji', FONTES.arqs.emoji);
        F = { normal: 'Texto', bold: 'Texto-Negrito', script: 'Manuscrita', emoji: 'Emoji' };
      } catch {
        F = { normal: 'Helvetica', bold: 'Helvetica-Bold', script: 'Helvetica-Oblique', emoji: 'Helvetica' };
      }
    }
    // Mesmo formato do doc.text, mas alternando para a fonte de emoji por trecho.
    const escrever = (base, str, a, b, c) => {
      let x;
      let y;
      let opts;
      if (typeof a === 'object' && a !== null) {
        opts = a;
      } else if (typeof a === 'number') {
        x = a; y = b; opts = c || {};
      } else {
        opts = {};
      }
      const runs = FONTES ? segmentar(str, base) : [{ fonte: base, text: String(str) }];
      runs.forEach((run, i) => {
        doc.font(F[run.fonte]);
        const o = { ...opts, continued: i < runs.length - 1 };
        if (i === 0 && x !== undefined) doc.text(run.text, x, y, o);
        else doc.text(run.text, o);
      });
    };
    const chunks = [];
    let totalPages = 0;
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => resolve({
      buffer: Buffer.concat(chunks),
      filename,
      pages: totalPages,
    }));

    const larg = doc.page.width - MARGEM * 2;
    const limiteY = () => doc.page.height - 90;
    const garantir = (h) => { if (doc.y + h > limiteY()) doc.addPage(); };

    // Faixa de cabeçalho
    doc.rect(0, 0, doc.page.width, 104).fill(COR);
    doc.fillColor('#ffffff').font(F.bold).fontSize(18);
    escrever('bold', rascunho ? 'Formulário para assinatura' : 'Formulário assinado', MARGEM, 24, { width: larg });
    // Título da campanha com logotipo opcional ao lado
    const al = campanha.titulo_alinhamento === 'centro' ? 'center' : campanha.titulo_alinhamento === 'direita' ? 'right' : 'left';
    const logo = imagemValida(campanha.logo);
    doc.fillColor('#d9f2e3').font(F.normal).fontSize(11);
    if (logo) {
      let lw = 30;
      let lh = (30 * logo.h) / logo.w;
      if (lh > 34) { lw = (lw * 34) / lh; lh = 34; }
      const antes = (campanha.logo_posicao || 'antes') !== 'depois';
      const tx = antes ? MARGEM + lw + 10 : MARGEM;
      escrever('normal', campanha.titulo, tx, 50, { width: larg - lw - 10, align: al });
      try {
        doc.image(logo.buf, antes ? MARGEM : MARGEM + larg - lw, 42, { width: lw, height: lh });
      } catch { /* ignora logo inválido */ }
    } else {
      escrever('normal', campanha.titulo, MARGEM, 50, { width: larg, align: al });
    }
    doc.y = 126;

    // Imagem acima da descrição
    const banner = imagemValida(campanha.imagem);
    if (banner) {
      let w = larg;
      let h = (larg * banner.h) / banner.w;
      if (h > 200) { w = (w * 200) / h; h = 200; }
      garantir(h + 16);
      const bx = campanha.imagem_alinhamento === 'centro' ? MARGEM + (larg - w) / 2 : campanha.imagem_alinhamento === 'direita' ? MARGEM + larg - w : MARGEM;
      try {
        doc.image(banner.buf, bx, doc.y, { width: w, height: h });
        doc.y += h + 12;
      } catch { /* ignora imagem inválida */ }
    }

    // Descrição da campanha
    doc.fillColor(TINTA).font(F.bold).fontSize(fz(13));
    escrever('bold', 'Descrição');
    doc.moveDown(sp(0.3));
    doc.fillColor(TINTA).font(F.normal).fontSize(fz(11));
    const desc = descSobrescrita !== undefined ? descSobrescrita : descCheia;
    garantir(Math.min(doc.heightOfString(desc, { width: larg }), 400) + 20);
    escrever('normal', desc, { width: larg, align: 'left' });
    doc.moveDown(sp(0.8));

    // Dados do cliente
    garantir(sp(130));
    doc.fillColor(TINTA).font(F.bold).fontSize(fz(13));
    escrever('bold', 'Dados do cliente');
    doc.moveDown(sp(0.4));
    const linha = (rotulo, valor) => {
      garantir(sp(40));
      const y = doc.y;
      doc.fillColor(CINZA).font(F.normal).fontSize(fz(10));
      escrever('normal', rotulo, MARGEM, y);
      doc.fillColor(TINTA).font(F.bold).fontSize(fz(12));
      escrever('bold', String(valor), MARGEM, y + 14 * escala, { width: larg });
      doc.moveDown(sp(0.4));
      doc.strokeColor(BORDA).lineWidth(0.7)
        .moveTo(MARGEM, doc.y).lineTo(MARGEM + larg, doc.y).stroke();
      doc.moveDown(sp(0.6));
    };
    linha('Nome do cliente', contato.nome);
    linha('E-mail', contato.email);
    if (!rascunho) linha('Assinado em', contato.assinado_em);
    doc.moveDown(sp(0.4));

    // Assinatura
    garantir(sp(150));
    doc.fillColor(TINTA).font(F.bold).fontSize(fz(13));
    escrever('bold', 'Assinatura');
    if (rascunho) {
      doc.moveDown(sp(2.4));
      doc.strokeColor(COR_ESCURA).lineWidth(1)
        .moveTo(MARGEM, doc.y).lineTo(MARGEM + larg, doc.y).stroke();
      doc.moveDown(sp(0.5));
      doc.fillColor(CINZA).font(F.normal).fontSize(fz(9));
      escrever('normal', 'Assine acima após imprimir.', { width: larg });
    } else {
      doc.moveDown(sp(0.3));
      doc.fillColor(COR_ESCURA).font(F.script).fontSize(Math.max(22, 34 * escala));
      escrever('script', String(contato.assinatura || contato.nome), { width: larg });
      doc.moveDown(sp(0.2));
      doc.strokeColor(COR_ESCURA).lineWidth(1)
        .moveTo(MARGEM, doc.y).lineTo(MARGEM + larg, doc.y).stroke();
      doc.moveDown(sp(0.6));
      doc.fillColor(CINZA).font(F.normal).fontSize(fz(9));
      escrever('normal', 'Assinatura digitada pelo titular através do link individual enviado ao e-mail acima.', { width: larg });
    }

    // Rodapé em todas as páginas
    const geradoEm = new Date().toLocaleString('pt-BR');
    const total = doc.bufferedPageRange().count;
    totalPages = total;
    for (let i = 0; i < total; i++) {
      doc.switchToPage(i);
      doc.fillColor(CINZA).font(F.normal).fontSize(8);
      escrever('normal', `${rascunho ? 'Formulário para assinatura' : 'Cópia do formulário assinado'} • ${rascunho ? 'Emitido' : 'Gerada'} em ${geradoEm} • Página ${i + 1} de ${total}`,
        MARGEM, doc.page.height - 80, { width: larg, align: 'center' });
    }
    doc.end();
  });
  let escala = 1;
  let resultado = await construir(escala);
  while (resultado.pages > 1 && escala > 0.62) {
    escala = Math.max(0.62, +(escala - 0.08).toFixed(2));
    resultado = await construir(escala);
  }
  if (resultado.pages > 1) {
    let melhor = null;
    let lo = 0.05;
    let hi = 0.95;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const r = await construir(0.62, descCheia.slice(0, Math.max(1, Math.floor(descCheia.length * mid))).trimEnd() + '…');
      if (r.pages <= 1) { melhor = r; lo = mid; } else { hi = mid; }
    }
    resultado = melhor || await construir(0.62, '…');
  }
  return resultado;
}
