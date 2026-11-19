// Delivery slip as an A4 page (SVG), viewed / printed / downloaded as PDF the same way as the GC and the LR.
const SLIP_ROWS = 24;
const SLIP_COLS = [['Sr.', 26], ['GC No.', 62], ['Consignor', 112], ['Consignee', 112], ['Units', 40], ['Door Del.', 60], ['Other', 52], ['Amount', 91]];
const SLIP_X0 = 20, SLIP_Y0 = 196, SLIP_HEAD = 24, SLIP_ROW = 22;

// slip: { slipNo, date, branchName, branchAddress, branchPhone, rows: [{gc, consignor, consignee, units, door, other, total}] }
function slipSVG(slip, page = 0, pages = 1, imgs = { logo: 'assets/logo.png' }) {
  const ink = '#000', soft = '#111';
  const text = (x, y, size, str, o = {}) => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${o.b ? 700 : 400}" fill="${o.c || ink}"${o.a ? ` text-anchor="${o.a}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(str)}</text>`;
  const line = (x1, y1, x2, y2, w = 0.7, dash) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ink}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const num = n => (parseFloat(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let o = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842" width="595" height="842" font-family="Arial,'Liberation Sans',Helvetica,sans-serif" style="background:#fff"><rect width="595" height="842" fill="#fff"/>`;

  // ---- letterhead ----
  o += text(297.5, 18, 6.5, 'SUBJECT TO VERAVAL JURISDICTION', { b: 1, a: 'middle', ls: 0.4 });
  const ph = (slip.branchPhone || '').trim(); if (ph) o += text(575, 24, 9.5, 'M : ' + ph, { b: 1, a: 'end' });
  o += `<image href="${imgs.logo}" x="20" y="30" width="70" height="45.6" preserveAspectRatio="xMidYMid meet"/>`;
  o += text(297.5, 62, 30, 'Sabri Logistics', { b: 1, a: 'middle' });
  const addr = (slip.branchAddress || '').trim();
  if (addr) { const [a, sz] = lrFit(addr, 520, 8.6, true); o += text(297.5, 86, sz, a, { b: 1, a: 'middle' }); }
  o += `<rect x="20" y="98" width="555" height="22" fill="${ink}"/>`;
  o += text(297.5, 113.5, 12, 'DELIVERY SLIP', { b: 1, a: 'middle', c: '#fff', ls: 2 });

  // ---- slip details ----
  const field = (label, lx, x1, x2, y, val) => {
    let s = text(lx, y, 8.5, label, { b: 1 }) + line(x1, y + 2, x2, y + 2, 0.6);
    if (val) { const [v, sz] = lrFit(val, x2 - x1 - 4, 10, true); s += text(x1 + 3, y - 0.5, sz, v, { c: soft, b: 1 }); }
    return s;
  };
  o += field('Slip No.', 20, 62, 200, 148, slip.slipNo);
  o += field('Date :', 220, 250, 380, 148, dmy(slip.date));
  o += field('Branch :', 400, 442, 575, 148, slip.branchName);
  o += field('Total GCs :', 20, 74, 200, 174, String((slip.rows || []).length));

  // ---- table ----
  const W = SLIP_COLS.reduce((a, c) => a + c[1], 0), H = SLIP_HEAD + SLIP_ROWS * SLIP_ROW;
  o += `<rect x="${SLIP_X0}" y="${SLIP_Y0}" width="${W}" height="${H}" fill="none" stroke="${ink}" stroke-width="1"/>`;
  let x = SLIP_X0; const xs = [];
  SLIP_COLS.forEach(([label, w]) => { xs.push(x); o += text(x + w / 2, SLIP_Y0 + 15.5, 7.6, label, { b: 1, a: 'middle' }); x += w; });
  xs.slice(1).forEach(cx => { o += line(cx, SLIP_Y0, cx, SLIP_Y0 + H, 0.8, '3 2'); });
  o += line(SLIP_X0, SLIP_Y0 + SLIP_HEAD, SLIP_X0 + W, SLIP_Y0 + SLIP_HEAD, 0.8);

  const left = new Set([2, 3]), right = new Set([5, 6, 7]);
  (slip.rows || []).slice(page * SLIP_ROWS, (page + 1) * SLIP_ROWS).forEach((r, i) => {
    const yb = SLIP_Y0 + SLIP_HEAD + i * SLIP_ROW + SLIP_ROW / 2 + 3;
    if (i) o += line(SLIP_X0, yb - SLIP_ROW / 2 - 3, SLIP_X0 + W, yb - SLIP_ROW / 2 - 3, 0.3, '1 2');
    const cells = [page * SLIP_ROWS + i + 1, r.gc, r.consignor, r.consignee, r.units, num(r.door), num(r.other), num(r.total)];
    cells.forEach((v, c) => {
      if (v === '' || v == null) return;
      const w = SLIP_COLS[c][1] - 6, [s, sz] = lrFit(String(v), w, 8.5, c === 1 || c === 7);
      const o2 = { c: soft, b: c === 1 || c === 7 };
      o += left.has(c) ? text(xs[c] + 3, yb, sz, s, o2) : right.has(c) ? text(xs[c] + SLIP_COLS[c][1] - 4, yb, sz, s, { ...o2, a: 'end' }) : text(xs[c] + SLIP_COLS[c][1] / 2, yb, sz, s, { ...o2, a: 'middle' });
    });
  });

  // ---- totals (last page) + signatures ----
  const yT = SLIP_Y0 + H + 18;
  if (page === pages - 1) {
    const rows = slip.rows || [], sum = k => rows.reduce((a, r) => a + (parseFloat(r[k]) || 0), 0);
    o += `<rect x="${SLIP_X0}" y="${yT - 13}" width="${W}" height="20" fill="#f1f1f1" stroke="${ink}" stroke-width="0.8"/>`;
    o += text(SLIP_X0 + 6, yT + 1, 9, 'Grand Total', { b: 1 });
    o += text(xs[4] + SLIP_COLS[4][1] / 2, yT + 1, 8.5, String(sum('units')), { b: 1, a: 'middle' });
    o += text(xs[5] + SLIP_COLS[5][1] - 4, yT + 1, 8.5, num(sum('door')), { b: 1, a: 'end' });
    o += text(xs[6] + SLIP_COLS[6][1] - 4, yT + 1, 8.5, num(sum('other')), { b: 1, a: 'end' });
    o += text(xs[7] + SLIP_COLS[7][1] - 4, yT + 1, 9.5, 'Rs. ' + num(sum('total')), { b: 1, a: 'end' });
    o += line(30, 800, 200, 800, 0.6) + text(115, 812, 8, "Receiver's Signature", { a: 'middle' });
    o += line(395, 800, 565, 800, 0.6) + text(480, 812, 8, 'For Sabri Logistics', { a: 'middle', b: 1 });
  }
  if (pages > 1) o += text(575, 832, 7, `Page ${page + 1} of ${pages}`, { a: 'end' });
  return o + '</svg>';
}

function slipPages(slip, imgs) {
  const n = Math.max(1, Math.ceil((slip.rows || []).length / SLIP_ROWS));
  return Array.from({ length: n }, (_, i) => slipSVG(slip, i, n, imgs));
}
