// Delivery slip as a landscape slip-size sheet (A5 landscape, 210 x 148 mm), viewed / printed / downloaded as PDF.
const SLIP_W = 842, SLIP_H = 420, SLIP_ROWS = 11;
const SLIP_COLS = [['Sr.', 30], ['GC No.', 70], ['Consignor', 150], ['Consignee', 150], ['Units', 45], ['Other', 60], ['Delivery Total', 85], ['GC Total', 100], ['Amount', 112]];
const SLIP_X0 = 20, SLIP_Y0 = 118, SLIP_HEAD = 18, SLIP_ROW = 17;

// slip: { slipNo, date, branchName, branchAddress, branchPhone, rows: [{gc, consignor, consignee, units, door, other, gcTotal, total}] }
// Delivery Total = door delivery x units + other; Amount = delivery total + the GC's own total
const delOf = r => r.delivery != null ? parseFloat(r.delivery) || 0 : (parseFloat(r.door) || 0) * (parseFloat(r.units) || 0) + (parseFloat(r.other) || 0);
function slipSVG(slip, page = 0, pages = 1, imgs = { logo: 'assets/logo.png' }) {
  const ink = '#000', soft = '#111';
  const text = (x, y, size, str, o = {}) => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${o.b ? 700 : 400}" fill="${o.c || ink}"${o.a ? ` text-anchor="${o.a}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(str)}</text>`;
  const line = (x1, y1, x2, y2, w = 0.7, dash) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ink}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const num = n => (parseFloat(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let o = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SLIP_W} ${SLIP_H}" width="${SLIP_W}" height="${SLIP_H}" font-family="Arial,'Liberation Sans',Helvetica,sans-serif" style="background:#fff"><rect width="${SLIP_W}" height="${SLIP_H}" fill="#fff"/>`;

  // ---- letterhead ----
  o += text(SLIP_W / 2, 14, 5.5, 'SUBJECT TO VERAVAL JURISDICTION', { b: 1, a: 'middle', ls: 0.4 });
  const ph = (slip.branchPhone || '').trim(); if (ph) o += text(SLIP_W - 20, 18, 8, 'M : ' + ph, { b: 1, a: 'end' });
  o += `<image href="${imgs.logo}" x="20" y="20" width="54" height="35" preserveAspectRatio="xMidYMid meet"/>`;
  o += text(SLIP_W / 2, 44, 22, 'Sabri Logistics', { b: 1, a: 'middle' });
  const addr = (slip.branchAddress || '').trim();
  if (addr) { const [a, sz] = lrFit(addr, 600, 7.5, true); o += text(SLIP_W / 2, 60, sz, a, { b: 1, a: 'middle' }); }
  o += `<rect x="20" y="68" width="${SLIP_W - 40}" height="17" fill="${ink}"/>`;
  o += text(SLIP_W / 2, 80, 10, 'DELIVERY SLIP', { b: 1, a: 'middle', c: '#fff', ls: 2 });

  // ---- slip details (one line) ----
  const field = (label, lx, x1, x2, y, val) => {
    let s = text(lx, y, 7.5, label, { b: 1 }) + line(x1, y + 2, x2, y + 2, 0.5);
    if (val) { const [v, sz] = lrFit(val, x2 - x1 - 4, 9, true); s += text(x1 + 3, y - 0.5, sz, v, { c: soft, b: 1 }); }
    return s;
  };
  const y = 104;
  o += field('Slip No.', 20, 56, 230, y, slip.slipNo);
  o += field('Date :', 260, 288, 420, y, dmy(slip.date));
  o += field('Branch :', 450, 488, 700, y, slip.branchName);
  o += field('GCs :', 730, 754, 822, y, String((slip.rows || []).length));

  // ---- table ----
  const W = SLIP_COLS.reduce((a, c) => a + c[1], 0), H = SLIP_HEAD + SLIP_ROWS * SLIP_ROW;
  o += `<rect x="${SLIP_X0}" y="${SLIP_Y0}" width="${W}" height="${H}" fill="none" stroke="${ink}" stroke-width="0.9"/>`;
  let x = SLIP_X0; const xs = [];
  SLIP_COLS.forEach(([label, w]) => { xs.push(x); o += text(x + w / 2, SLIP_Y0 + 12, 7, label, { b: 1, a: 'middle' }); x += w; });
  xs.slice(1).forEach(cx => { o += line(cx, SLIP_Y0, cx, SLIP_Y0 + H, 0.7, '3 2'); });
  o += line(SLIP_X0, SLIP_Y0 + SLIP_HEAD, SLIP_X0 + W, SLIP_Y0 + SLIP_HEAD, 0.7);

  const left = new Set([2, 3]), right = new Set([5, 6, 7, 8]);
  (slip.rows || []).slice(page * SLIP_ROWS, (page + 1) * SLIP_ROWS).forEach((r, i) => {
    const yb = SLIP_Y0 + SLIP_HEAD + i * SLIP_ROW + SLIP_ROW / 2 + 3;
    if (i) o += line(SLIP_X0, yb - SLIP_ROW / 2 - 3, SLIP_X0 + W, yb - SLIP_ROW / 2 - 3, 0.3, '1 2');
    const cells = [page * SLIP_ROWS + i + 1, r.gc, r.consignor, r.consignee, r.units, num(r.other), num(delOf(r)), num(r.gcTotal), num(r.total)];
    cells.forEach((v, c) => {
      if (v === '' || v == null) return;
      const w = SLIP_COLS[c][1] - 6, [s, sz] = lrFit(String(v), w, 8, c === 1 || c === 8);
      const o2 = { c: soft, b: c === 1 || c === 8 };
      o += left.has(c) ? text(xs[c] + 3, yb, sz, s, o2) : right.has(c) ? text(xs[c] + SLIP_COLS[c][1] - 4, yb, sz, s, { ...o2, a: 'end' }) : text(xs[c] + SLIP_COLS[c][1] / 2, yb, sz, s, { ...o2, a: 'middle' });
    });
  });

  // ---- totals (last page) + signatures ----
  const yT = SLIP_Y0 + H + 15;
  if (page === pages - 1) {
    const rows = slip.rows || [], sum = k => rows.reduce((a, r) => a + (parseFloat(r[k]) || 0), 0);
    o += `<rect x="${SLIP_X0}" y="${yT - 11}" width="${W}" height="16" fill="#f1f1f1" stroke="${ink}" stroke-width="0.7"/>`;
    o += text(SLIP_X0 + 6, yT + 1, 8, 'Grand Total', { b: 1 });
    o += text(xs[4] + SLIP_COLS[4][1] / 2, yT + 1, 8, String(sum('units')), { b: 1, a: 'middle' });
    o += text(xs[5] + SLIP_COLS[5][1] - 4, yT + 1, 8, num(sum('other')), { b: 1, a: 'end' });
    o += text(xs[6] + SLIP_COLS[6][1] - 4, yT + 1, 8, num(rows.reduce((a, r) => a + delOf(r), 0)), { b: 1, a: 'end' });
    o += text(xs[7] + SLIP_COLS[7][1] - 4, yT + 1, 8, num(sum('gcTotal')), { b: 1, a: 'end' });
    o += text(xs[8] + SLIP_COLS[8][1] - 4, yT + 1, 8.5, 'Rs. ' + num(sum('total')), { b: 1, a: 'end' });
    o += line(40, 398, 240, 398, 0.5) + text(140, 408, 7, "Receiver's Signature", { a: 'middle' });
    o += line(600, 398, 800, 398, 0.5) + text(700, 408, 7, 'For Sabri Logistics', { a: 'middle', b: 1 });
  }
  if (pages > 1) o += text(SLIP_W - 20, 414, 6, `Page ${page + 1} of ${pages}`, { a: 'end' });
  return o + '</svg>';
}

function slipPages(slip, imgs) {
  const n = Math.max(1, Math.ceil((slip.rows || []).length / SLIP_ROWS));
  return Array.from({ length: n }, (_, i) => slipSVG(slip, i, n, imgs));
}
