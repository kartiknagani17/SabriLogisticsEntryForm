// Renders the GC receipt as SVG, positioned from the reference PDF (see tools/extract_template.py).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const amt = v => {
  const n = parseFloat(v);
  if (!isFinite(n) || n === 0) return '0';
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const dmy = v => (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v.split('-').reverse().join('-') : (v || '');
const nowStamp = () => {
  const d = new Date(), h = d.getHours();
  const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `${date}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`;
};
const chargeTotal = d => ['freight', 'bilty', 'doorDel', 'handling', 'other', 'igst'].reduce((a, k) => a + (parseFloat(d[k]) || 0), 0);

// reference text (as it appears in the PDF) @ baseline y -> [anchor, fill from form data]
// anchor: c = centre, l = left, r = right of the original text box
const VARS = {
  'G.C. No: 5@29.71': ['c', d => 'G.C. No: ' + (d.gc || '')],
  '10-06-2025@72.92': ['c', d => dmy(d.date)],
  'ABCDT6989Y@72.92': ['l', () => PAN_NO],
  'Paid@72.92': ['r', d => d.payType],
  'ahmedabad@83.72': ['c', d => d.from],
  'gandhinagar@83.72': ['c', d => d.to],
  'HFSK49503JFO304@83.72': ['l', () => ENRL_NO],
  '9876987695,6877456345@94.52': ['c', d => d.bkgPh],
  'sldkjhr456@94.52': ['c', d => d.delPh],
  '159,736.40@94.52': ['r', d => amt(d.freight)],
  '4599843, 9480985@105.33': ['c', d => d.invNo],
  '468@105.33': ['c', d => d.invValue],
  '0@105.33': ['r', d => amt(d.bilty)],
  '1,500@116.13': ['r', d => amt(d.doorDel)],
  'krish @127.53': ['c', d => (d.consignor || '') + ' '],
  'GST NO:-987654321127387@136.53': ['c', d => 'GST NO:-' + (d.consignorGst || '')],
  'raj @127.53': ['c', d => (d.consignee || '') + ' '],
  'GST NO:- 123456789098765@136.53': ['c', d => 'GST NO:- ' + (d.consigneeGst || '')],
  '0@126.93': ['r', d => amt(d.handling)],
  '0@137.73': ['r', d => amt(d.other)],
  '31.82 TON @148.54': ['c', d => (d.weight || '0') + ' TON '],
  '29,652.55 @148.54': ['r', d => amt(d.igst) + ' '],
  '25 @159.34': ['c', d => (d.qty || '') + ' '],
  'box @159.34': ['c', d => (d.packageType || '') + ' '],
  'kaju katri @159.34': ['c', d => (d.description || '') + ' '],
  '0.00 TON @159.34': ['c', d => (d.chargeWeight || '0') + ' TON '],
  '194,388.95@159.34': ['r', d => amt(chargeTotal(d))],
  'Private Mark: 9689605069@171.94': ['c', d => 'Private Mark: ' + (d.privateMark || '')],
  'Consignee@186.95': ['c', d => d.payableBy],
  'June 10, 2025, 6:02 p.m.@211.55': ['c', d => d.printedAt || nowStamp()],
  ' Lorem ipsum dolor sit amet.@200.15': ['l', d => ' ' + (d.remarks || '')],
  'sbi bank@233.76': ['l', () => BANK.name],
  '4567890786567543@242.76': ['l', () => BANK.account],
  'hshd@251.76': ['l', () => BANK.ifsc],
  'www.jjsjgdjahj.com@262.57': ['l', () => ''],
};
const PAN_NO = 'EPIPP7276E', ENRL_NO = '24EPIPP7276E1ZJ';
const BO_DEFAULT = 'B.O. : Shop No. 07, Khara Kuva, Gandhi Chowk, Veraval -362 265 Dist. Gir-Somnath (Gujarat)';
// the B.O. header line shows the GC's branch address (falls back to the old fixed address if the branch has none)
const BO_VAR = ['c', d => d.boAddress ? 'B.O. : ' + d.boAddress.replace(/^B\.O\.\s*:?\s*/i, '') : BO_DEFAULT];
const varOf = t => t.t.startsWith('B.O. :') ? BO_VAR : VARS[`${t.t}@${t.y}`];
const BANK = { name: 'HDFC Bank', account: '50200119470541', ifsc: 'HDFC0000230' };
const COPIES = ['CONSIGNOR COPY', 'CONSIGNEE COPY', 'DRIVER COPY'];
const FONT = "Arial,'Liberation Sans',Helvetica,sans-serif";
const IMG = { logo: [15.3, 9.9, 76.2, 49.8], qr: [17.1, 215.8, 48, 46.8] };

// The PDF's glyphs are drawn ~12% smaller than their nominal size (hinted outlines); fitted against the reference render.
const GLYPH_SCALE = { '1|27.0': 0.89, '1|7.2': 0.90, '1|9.0': 0.88, '0|9.0': 0.88, '1|9.6': 0.88 };
const NBSP = ' '; // plain spaces would be collapsed by SVG and shift the per-glyph x list
let _mctx;
const textWidth = (txt, size, bold) => {
  _mctx = _mctx || document.createElement('canvas').getContext('2d');
  _mctx.font = `${bold ? 'bold ' : ''}${size}px Arial`;
  return _mctx.measureText(txt).width;
};

const advOf = (c, size, bold) => c === ' ' ? 0.275 * size : textWidth(c, size, bold) * (RECEIPT_TPL.ratio[`${+bold}|${size.toFixed(1)}`] || 0.9);
const runWidth = (txt, size, bold) => [...txt].reduce((a, c) => a + advOf(c, size, bold), 0);
const glyphXs = (txt, size, bold, x0) => { let x = x0; return [...txt].map(c => { const r = +x.toFixed(2); x += advOf(c, size, bold); return r; }); };

// the G.C. No box grows leftwards when the number is long (original is 43.2pt wide, right edge fixed at 581.85)
function gcBox(d) {
  const t0 = RECEIPT_TPL.texts.find(t => t.t.startsWith('G.C. No'));
  const pre = t0.xs[9] - t0.xs[0]; // "G.C. No: " keeps the original glyph positions
  const W = pre + runWidth(d.gc || '', 9, true);
  const width = Math.max(43.21, W + 8), left = 581.85 - width;
  return { left, width, cx: left + width / 2, W, pre, t0 };
}

function copySVG(d, label, imgs) {
  let o = '';
  const box = gcBox(d);
  for (let [x, y, w, h, c] of RECEIPT_TPL.rects) {
    if (x >= 539 && y < 40) { // G.C. No box edges
      if (w > 1) { x = box.left; w = box.width - 0.6; } else if (x < 560) x = box.left;
    }
    o += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
  }
  for (const k of ['logo', 'qr']) { const [x, y, w, h] = IMG[k]; o += `<image href="${imgs[k]}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`; }
  for (const t of RECEIPT_TPL.texts) {
    const key = `${+t.b}|${t.s.toFixed(1)}`;
    const fs = +(t.s * (GLYPH_SCALE[key] || 0.88)).toFixed(3);
    const attrs = `y="${t.y}" font-size="${fs}" font-weight="${t.b ? 700 : 400}" fill="${t.w ? '#fff' : '#000'}"`;
    let txt, x0;
    if (t.t.startsWith('G.C. No')) {
      const g0 = box.cx - box.W / 2;
      const xs = [...t.xs.slice(0, 9).map(x => +(x - t.xs[0] + g0).toFixed(2)), ...glyphXs(d.gc || '', t.s, t.b, g0 + box.pre)];
      o += `<text x="${xs.join(' ')}" ${attrs}>${esc('G.C. No: ' + (d.gc || '')).replace(/ /g, NBSP)}</text>`; continue;
    }
    if (t.t.trim() === 'CONSIGNOR COPY') { txt = label; }
    else {
      const v = varOf(t);
      if (!v) { o += `<text x="${t.xs.join(' ')}" ${attrs}>${esc(t.t).replace(/ /g, NBSP)}</text>`; continue; } // fixed text: exact glyph origins from the PDF
      txt = v[1](d) ?? '';
    }
    // variable text: lay the glyphs out with the original's average advance, anchored like the original
    const a = t.t.trim() === 'CONSIGNOR COPY' ? 'c' : varOf(t)[0];
    const k = t.t.startsWith('B.O. :') ? Math.min(1, 560 / runWidth(txt, t.s, t.b)) : 1; // long branch addresses shrink to fit the page
    const sz = t.s * k, attrs2 = k < 1 ? attrs.replace(/font-size="[^"]*"/, `font-size="${(fs * k).toFixed(3)}"`) : attrs;
    const W = runWidth(txt, sz, t.b);
    let ax = a === 'c' ? (t.x0 + t.x1) / 2 : a === 'r' ? t.x1 : t.x0;
    if (t.t.startsWith('G.C. No')) ax = box.cx;
    x0 = a === 'c' ? ax - W / 2 : a === 'r' ? ax - W : ax;
    o += `<text x="${glyphXs(txt, sz, t.b, x0).join(' ')}" ${attrs2}>${esc(txt).replace(/ /g, NBSP)}</text>`;
  }
  return o;
}

// imgs: {logo, qr} urls (use data: URIs when rasterising)
function receiptSVG(d, imgs = { logo: 'assets/logo.png', qr: 'assets/qr.png' }) {
  const s = RECEIPT_TPL.step;
  let o = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842" width="595" height="842" font-family="${FONT}" style="white-space:pre;background:#fff;font-kerning:none;font-variant-ligatures:none;text-rendering:geometricPrecision;font-synthesis:none"><rect width="595" height="842" fill="#fff"/>`;
  COPIES.forEach((label, i) => {
    o += `<g transform="translate(0 ${(i * s).toFixed(2)})">${copySVG(d, label, imgs)}</g>`;
    if (i < 2) o += `<line x1="12.3" x2="582.4" y1="${(271.3 + i * s).toFixed(2)}" y2="${(271.3 + i * s).toFixed(2)}" stroke="#000" stroke-width="0.6" stroke-dasharray="1.8 1.8"/>`;
  });
  return o + '</svg>';
}

const assetCache = {};
async function inlineImgs() {
  if (assetCache.logo) return assetCache;
  for (const k of ['logo', 'qr']) {
    const b = await (await fetch(`assets/${k}.png`)).blob();
    assetCache[k] = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
  }
  return assetCache;
}

// ---- PDF ----
// Each page drawing (SVG) is copied into the PDF as real text, lines and boxes, at exactly the same positions,
// with the PDF's built-in Helvetica (same letter widths as Arial). That makes a PDF ~50 KB instead of a ~1 MB
// photo of the page. Pictures (logo, QR) keep the resolution the photo had: 4 pixels per point, JPEG 92%.
// A page with characters Helvetica cannot show (e.g. Gujarati) is still made as a photo, as before.
const PDF_PX = 4;
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const svgURL = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
// the characters Helvetica has in a PDF (Windows-1252)
const PDF_CHARS = /^[\x20-\x7e\xa0-\xff–—‘’‚“”„†‡•…‰‹›€™ŒœŠšŸŽžƒˆ˜]*$/;
const pdfColor = c => { c = String(c || '#000').trim(); return /^#[0-9a-f]{3}$/i.test(c) ? '#' + [...c.slice(1)].map(h => h + h).join('') : c; };

// the old way, kept for pages Helvetica cannot show: the whole page as one picture
async function rasterPage(doc, svg, S) {
  const img = await loadImg(svgURL(svg));
  const c = document.createElement('canvas'); c.width = Math.round(595 * S); c.height = Math.round(842 * S);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  doc.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 595, 842);
}

// a picture placed the way the SVG places it, resampled to 4 px per point on white (as the photo did)
async function pdfImage(doc, el, tx, ty, cache) {
  const href = el.getAttribute('href') || el.getAttribute('xlink:href'), x = +el.getAttribute('x') + tx, y = +el.getAttribute('y') + ty;
  let w = +el.getAttribute('width'), h = +el.getAttribute('height'), dx = x, dy = y;
  const img = await loadImg(href);
  if ((el.getAttribute('preserveAspectRatio') || 'xMidYMid meet') !== 'none') {
    const s = Math.min(w / img.naturalWidth, h / img.naturalHeight), dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    dx = x + (w - dw) / 2; dy = y + (h - dh) / 2; w = dw; h = dh;
  }
  const key = href.length + '|' + href.slice(-40) + '|' + w.toFixed(2) + 'x' + h.toFixed(2);
  if (!cache[key]) {
    const c = document.createElement('canvas'); c.width = Math.round(w * PDF_PX); c.height = Math.round(h * PDF_PX);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    cache[key] = c.toDataURL('image/jpeg', 0.92);
  }
  doc.addImage(cache[key], 'JPEG', dx, dy, w, h, key); // same alias = stored once (the GC has 3 copies)
}

// text squeezed to a set length in a font only some computers have (the LR heading): drawn by the browser
// exactly as before, as a small transparent picture of just that text
async function pdfTextPicture(doc, el, rootFont, tx, ty) {
  const x = +el.getAttribute('x'), y = +el.getAttribute('y'), fs = +el.getAttribute('font-size'), len = +el.getAttribute('textLength');
  const box = [x - fs * 0.2, y - fs * 1.05, len + fs * 0.4, fs * 1.4];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(' ')}" width="${box[2]}" height="${box[3]}" font-family="${esc(rootFont)}">${el.outerHTML}</svg>`;
  const img = await loadImg(svgURL(svg));
  const c = document.createElement('canvas'); c.width = Math.round(box[2] * PDF_PX); c.height = Math.round(box[3] * PDF_PX);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  doc.addImage(c.toDataURL('image/png'), 'PNG', box[0] + tx, box[1] + ty, box[2], box[3]);
}

function pdfText(doc, el, tx, ty) {
  const fs = +el.getAttribute('font-size'), bold = +el.getAttribute('font-weight') >= 600 || el.getAttribute('font-weight') === 'bold';
  doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(fs); doc.setTextColor(pdfColor(el.getAttribute('fill')));
  const str = el.textContent, y = +el.getAttribute('y') + ty, xs = el.getAttribute('x').trim().split(/[\s,]+/).map(Number);
  if (xs.length > 1) { // every letter has its own position (the GC receipt): place each one there
    const chars = [...str]; let x = xs[0];
    chars.forEach((ch, i) => {
      x = i < xs.length ? xs[i] : x + doc.getTextWidth(chars[i - 1]);
      if (ch.trim() && ch !== ' ') doc.text(ch, x + tx, y);
    });
    return;
  }
  const ls = parseFloat(el.getAttribute('letter-spacing')) || 0, anchor = el.getAttribute('text-anchor');
  const w = doc.getTextWidth(str) + ls * [...str].length;
  const x0 = xs[0] - (anchor === 'middle' ? w / 2 : anchor === 'end' ? w : 0);
  doc.text(str, x0 + tx, y, ls ? { charSpace: ls } : undefined);
}

async function pdfNode(doc, el, tx, ty, ctx) {
  const n = el.nodeName, a = k => el.getAttribute(k);
  if (n === 'g') {
    const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(a('transform') || '');
    for (const c of el.children) await pdfNode(doc, c, tx + (m ? +m[1] : 0), ty + (m ? +m[2] : 0), ctx);
  } else if (n === 'rect') {
    const fill = a('fill'), stroke = a('stroke'), x = +a('x') + tx, y = +a('y') + ty, w = +a('width'), h = +a('height');
    if (fill && fill !== 'none') { doc.setFillColor(pdfColor(fill)); doc.rect(x, y, w, h, 'F'); }
    if (stroke && stroke !== 'none') { doc.setDrawColor(pdfColor(stroke)); doc.setLineWidth(+a('stroke-width') || 1); doc.rect(x, y, w, h, 'S'); }
  } else if (n === 'line') {
    doc.setDrawColor(pdfColor(a('stroke'))); doc.setLineWidth(+a('stroke-width') || 1);
    const dash = (a('stroke-dasharray') || '').trim(); if (dash) doc.setLineDashPattern(dash.split(/[\s,]+/).map(Number), 0);
    doc.line(+a('x1') + tx, +a('y1') + ty, +a('x2') + tx, +a('y2') + ty);
    if (dash) doc.setLineDashPattern([], 0);
  } else if (n === 'text') {
    if (a('textLength')) await pdfTextPicture(doc, el, ctx.font, tx, ty); else pdfText(doc, el, tx, ty);
  } else if (n === 'image') await pdfImage(doc, el, tx, ty, ctx.images);
  else throw new Error('PDF: cannot draw <' + n + '>');
}

// svgs: one SVG string or an array of them (one A4 page each)
async function svgToPDF(svgs, filename, asBase64) {
  svgs = [].concat(svgs);
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: [595, 842], compress: true }), images = {};
  for (let i = 0; i < svgs.length; i++) {
    if (i) doc.addPage([595, 842]);
    const root = new DOMParser().parseFromString(svgs[i], 'image/svg+xml').documentElement;
    const texts = [...root.querySelectorAll('text')].filter(t => !t.getAttribute('textLength'));
    if (texts.every(t => PDF_CHARS.test(t.textContent))) {
      for (const el of root.children) await pdfNode(doc, el, 0, 0, { font: root.getAttribute('font-family') || '', images });
    } else await rasterPage(doc, svgs[i], svgs.length > 4 ? 2.5 : 4);
    await new Promise(r => setTimeout(r)); // let the browser breathe between pages
  }
  if (asBase64) return doc.output('datauristring').split(',')[1];
  doc.save(filename);
}

function svgPrint(svgs, title) {
  svgs = [].concat(svgs);
  const w = window.open('');
  w.document.write(`<title>${esc(title)}</title><style>@page{size:A4;margin:0}html,body{margin:0}.pg{break-after:page;page-break-after:always}.pg:last-child{break-after:auto;page-break-after:auto}svg{width:210mm;height:297mm;display:block}</style>${svgs.map(x => `<div class="pg">${x}</div>`).join('')}`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

async function receiptPDF(d, filename) { return svgToPDF(receiptSVG(d, await inlineImgs()), filename); }
async function receiptPdfBase64(d) { return svgToPDF(receiptSVG(d, await inlineImgs()), '', true); }
async function receiptPrint(d) { return svgPrint(receiptSVG(d, await inlineImgs()), `GC ${d.gc}`); }
