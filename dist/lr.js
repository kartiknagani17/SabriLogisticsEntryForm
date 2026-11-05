// Lorry Receipt (LR) sheet: redrawn as SVG from the photo of the printed form.
// Hand-written parts of the form (total cartons, stamp) are deliberately left out.
const LR_RED = '#c8202f';
const LR_ROWS = 20;
const LR_COLS = [['Destination', 64], ['L.R. No.', 40], ['Consignor', 78], ['Consignee', 104], ['No. of|Article', 38], ['Contains', 68], ['Weight', 44], ['To Pay', 40], ['Paid', 40], ['PM No.', 43]];
const LR_X0 = 18, LR_Y0 = 196, LR_HEAD = 26, LR_ROW = 27;

const lrFit = (txt, maxW, size, bold) => {
  txt = String(txt ?? '');
  while (size > 5.5 && textWidth(txt, size, bold) > maxW) size -= 0.5;
  if (textWidth(txt, size, bold) > maxW) { while (txt.length > 1 && textWidth(txt + '…', size, bold) > maxW) txt = txt.slice(0, -1); txt += '…'; }
  return [txt, size];
};

// Builds the LR object (what gets stored) from the chosen GC entries
function lrFromEntries(entries, extra) {
  const uniq = k => [...new Set(entries.map(e => (e.data[k] || '').trim()).filter(Boolean))];
  return {
    memoNo: extra.memoNo, date: extra.date,
    from: uniq('from').join(', '), to: uniq('to').join(', '),
    truckNo: extra.truckNo || '', driverName: extra.driverName || '',
    rows: entries.map(e => {
      const d = e.data;
      return { dest: d.to || '', lr: d.gc || '', consignor: d.consignor || '', consignee: d.consignee || '', articles: d.quantity || '',
        contains: d.description || '', weight: d.weight || '', pay: d.payType || '', total: e.total, pm: d.privateMark || '' };
    }),
  };
}

function lrSVG(lr, page = 0, pages = 1, imgs = { logo: 'assets/logo.png' }) {
  const R = LR_RED;
  const text = (x, y, size, str, o = {}) => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${o.b ? 700 : 400}" fill="${o.c || R}"${o.a ? ` text-anchor="${o.a}"` : ''}${o.f ? ` font-family="${o.f}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(str)}</text>`;
  const line = (x1, y1, x2, y2, w = 0.7) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${R}" stroke-width="${w}"/>`;
  let o = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842" width="595" height="842" font-family="Arial,'Liberation Sans',Helvetica,sans-serif" style="background:#fff"><rect width="595" height="842" fill="#fff"/>`;

  // ---- letterhead ----
  o += text(20, 22, 7, 'GSTIN : ', { b: 1 });
  o += text(297, 18, 6.5, 'SUBJECT TO VERAVAL JURISDICTION', { b: 1, a: 'middle', ls: 0.4 });
  o += text(577, 24, 9.5, 'M : 99986 22244', { b: 1, a: 'end' });
  // company logo (same as the GC receipt)
  o += `<image href="${imgs.logo}" x="20" y="34" width="70" height="45.6" preserveAspectRatio="xMidYMid meet"/>`;
  o += `<text x="160" y="70" font-size="35" font-weight="700" fill="${R}" font-family="Rockwell,'Roboto Slab','Courier New',Georgia,serif" textLength="291" lengthAdjust="spacingAndGlyphs">Sabri Logistics</text>`;
  o += `<rect x="18" y="82" width="559" height="19" fill="${R}"/>`;
  o += text(297.5, 95, 8.6, 'Surat : Godown No. 12, Ambica Transport Compound, Nr. Mangalam Granite, Saroli Road, Surat-395010', { b: 1, a: 'middle', c: '#fff' });

  // ---- header fields: label + underline + value ----
  const field = (label, lx, x1, x2, y, val) => {
    let s = text(lx, y, 8, label, { b: 1 }) + line(x1, y + 2, x2, y + 2, 0.6);
    if (val) { const [v, sz] = lrFit(val, x2 - x1 - 4, 9, false); s += text(x1 + 3, y - 0.5, sz, v, { c: '#111' }); }
    return s;
  };
  o += field('Memo No.', 20, 62, 150, 128, lr.memoNo);
  o += field('From :', 158, 186, 290, 128, lr.from);
  o += field('To :', 298, 316, 420, 128, lr.to);
  o += field('Date :', 428, 456, 577, 128, dmy(lr.date));
  o += field('Truck No.', 20, 62, 230, 154, lr.truckNo);
  o += field('Driver Name :', 250, 312, 577, 154, lr.driverName);

  // ---- table ----
  const W = LR_COLS.reduce((a, c) => a + c[1], 0), H = LR_HEAD + LR_ROWS * LR_ROW;
  o += `<rect x="${LR_X0}" y="${LR_Y0}" width="${W}" height="${H}" fill="none" stroke="${R}" stroke-width="1"/>`;
  let x = LR_X0; const xs = [];
  LR_COLS.forEach(([label, w], i) => {
    xs.push(x);
    const parts = label.split('|'), cx = x + w / 2;
    parts.forEach((p, j) => { o += text(cx, LR_Y0 + (parts.length > 1 ? 11 + j * 8.5 : 16), parts.length > 1 ? 6.6 : 7.4, p, { b: 1, a: 'middle' }); });
    x += w;
  });

  // ---- rows ----
  const ink = '#111', left = new Set([2, 3, 5]);
  (lr.rows || []).slice(page * LR_ROWS, (page + 1) * LR_ROWS).forEach((r, i) => {
    const cells = [r.dest, r.lr, r.consignor, r.consignee, r.articles, r.contains, r.weight, '', '', r.pm];
    const yb = LR_Y0 + LR_HEAD + i * LR_ROW + LR_ROW / 2 + 3;
    cells.forEach((v, c) => {
      if (!v) return;
      const w = LR_COLS[c][1] - 6, [s, sz] = lrFit(v, w, 8.5, false);
      o += left.has(c) ? text(xs[c] + 3, yb, sz, s, { c: ink }) : text(xs[c] + LR_COLS[c][1] / 2, yb, sz, s, { c: ink, a: 'middle' });
    });
    // the To Pay / Paid column carries the GC's total amount instead of a tick
    const p = (r.pay || '').toLowerCase(), amt = r.total != null && r.total !== '' ? Number(r.total).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '';
    const amount = c => { if (!amt) return; const [s, sz] = lrFit(amt, LR_COLS[c][1] - 4, 8.5, true); o += text(xs[c] + LR_COLS[c][1] / 2, yb, sz, s, { c: ink, a: 'middle', b: 1 }); };
    if (p === 'paid') amount(8);
    else if (p === 'to pay') amount(7);
    else if (p === 'to be billed') o += text(xs[7] + LR_COLS[7][1] / 2, yb, 7, 'TBB', { c: ink, a: 'middle', b: 1 });
  });

  // ---- totals over the whole LR, printed on the last page only ----
  if (page === pages - 1) {
    const rows = lr.rows || [], sum = f => rows.reduce((a, r) => a + (parseFloat(f(r)) || 0), 0), pays = k => sum(r => (r.pay || '').toLowerCase() === k ? r.total : 0);
    const num = (n, d) => n.toLocaleString('en-IN', { maximumFractionDigits: d });
    const tot = (c, str) => { const [t, sz] = lrFit(str, LR_COLS[c][1] - 3, 8.5, true); o += text(xs[c] + LR_COLS[c][1] / 2, 782, sz, t, { c: '#111', a: 'middle', b: 1 }); };
    o += text(22, 782, 9, 'Total', { b: 1 });
    tot(4, num(sum(r => r.articles), 2)); tot(6, num(sum(r => r.weight), 3)); tot(7, num(pays('to pay'), 2)); tot(8, num(pays('paid'), 2));
  }
  if (pages > 1) o += text(577, 822, 7, `Page ${page + 1} of ${pages}`, { a: 'end' });
  return o + '</svg>';
}

// one SVG per A4 page (20 rows each) so any number of GCs fits
function lrPages(lr, imgs) {
  const n = Math.max(1, Math.ceil((lr.rows || []).length / LR_ROWS));
  return Array.from({ length: n }, (_, i) => lrSVG(lr, i, n, imgs));
}
