const $ = s => document.querySelector(s);
const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- form definition: [key, label, type, placeholder, extra class] ----
const PAY = ['Paid', 'To Pay', 'To be Billed'];
const PKG = ['bag', 'bundle', 'box', 'carton', 'roll', 'parcel', 'homemade goods'];
const T = 'text', N = 'number';
const sections = [
  { title: 'Shipment details', fields: [
    ['gc', 'GC Number', T, 'e.g. 459403'], ['date', 'Date', 'date', ''], ['from', 'From', T, 'Origin city'], ['to', 'To', T, 'Destination city'],
    ['invNo', 'Invoice No.', T, ''], ['invoiceValue', 'Invoice Value', N, 'Amount'], ['payType', 'Pay Type', 'select', '', '', PAY], ['privateMark', 'Private Mark', T, 'Optional'],
    ['pan', 'PAN No', T, ''], ['enrl', 'ENRL No', T, ''], ['bkgPh', 'Booking Ph.', T, ''], ['delPh', 'Delivery Ph.', T, ''] ] },
  { title: 'Parties & cargo', fields: [
    ['consignor', 'Consignor', T, 'Name / company', 'w2'], ['consignee', 'Consignee', T, 'Name / company', 'w2'],
    ['consignorGst', 'Consignor GST No', T, '', 'w2'], ['consigneeGst', 'Consignee GST No', T, '', 'w2'],
    ['quantity', 'Quantity', N, 'e.g. 100'], ['packageType', 'Package Type', 'select', '', '', PKG], ['description', 'Description', T, 'e.g. Sand'], ['payableBy', 'GC Payable By', T, 'Consignee'],
    ['remarks', 'Remarks', T, 'Optional', 'w2'] ] },
  { title: 'Weight & charges', fields: [
    ['weight', 'Wt.', N, 'e.g. 10.000'], ['chargeWeight', 'Charge Wt.', N, 'e.g. 10.000'], ['freight', 'Freight', N, '0'], ['bc', 'BC', N, '0'],
    ['doorDelivery', 'Door Del.', N, '0'], ['handling', 'Handling', N, '0'], ['other', 'Other', N, '0'], ['sgst', 'SGST', N, '0'], ['cgst', 'CGST', N, '0'] ] },
];
const REQUIRED = ['gc', 'date', 'from', 'to', 'consignor', 'consignee', 'quantity', 'packageType', 'description'];
const defaults = { payType: 'Paid', payableBy: 'Consignee' };
let data = { ...defaults };

// map this form's field names onto the receipt renderer's
const rd = d => ({ ...d, qty: d.quantity, bilty: d.bc, doorDel: d.doorDelivery, igst: String((parseFloat(d.sgst) || 0) + (parseFloat(d.cgst) || 0)), invValue: d.invoiceValue });

function fieldHTML([key, label, type, ph, cls, opts]) {
  const req = REQUIRED.includes(key) ? 'required' : '';
  const v = data[key] || '';
  if (type === 'select') {
    const o = (key === 'packageType' ? `<option value="" disabled ${v ? '' : 'selected'}>Select</option>` : '') +
      opts.map(x => `<option value="${esc(x)}" ${v === x ? 'selected' : ''}>${esc(key === 'packageType' ? x[0].toUpperCase() + x.slice(1) : x)}</option>`).join('');
    return `<div class="field ${cls || ''}"><label for="${key}">${label}</label><select id="${key}" name="${key}" ${req}>${o}</select></div>`;
  }
  return `<div class="field ${cls || ''}"><label for="${key}">${label}</label><input id="${key}" name="${key}" type="${type}" ${type === 'number' ? 'step="any"' : ''} placeholder="${ph}" value="${esc(v)}" ${req}/></div>`;
}
function renderForm() {
  $('#fields').innerHTML = sections.map(s => `<div class="sect"><h4>${s.title}</h4><div class="grid">${s.fields.map(fieldHTML).join('')}</div></div>`).join('');
  $('#totalOut').textContent = fmt(chargeTotal(rd(data)));
}
function showToast(t, err) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); el.style.background = err ? '#b3261e' : ''; setTimeout(() => el.classList.remove('show'), err ? 5000 : 2600); }

// ---- storage: Supabase. Every request carries the signed-in user's session token; the database only returns that user's branch. ----
const SB = window.SUPABASE_URL && window.SUPABASE_ANON_KEY;
let session = null;      // { token, role, name, email, phone, branch_id, branch_name }
let scopeBranch = null;  // admin only: branch picked in the left menu (null = all branches)
let branches = [];       // admin: every branch, employee: just their own
const isAdmin = () => !!session && session.role === 'admin';
const curBranch = () => isAdmin() ? scopeBranch : (session && session.branch_id);
const bq = b => { b = b === undefined ? curBranch() : b; return b ? `&branch_id=eq.${b}` : ''; };
const needBranch = () => { const b = curBranch(); if (!b) throw new Error('Choose a branch in the left menu first.'); return b; };
const bname = id => (branches.find(b => b.id === id) || {}).name || '';
const sbFetch = async (p, o = {}) => {
  const x = await fetch(window.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + p, { ...o, headers: { apikey: window.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + window.SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...(session ? { 'x-session-token': session.token } : {}), ...(o.headers || {}) } });
  if (x.status === 403 && session && /row-level security/i.test(await x.clone().text())) { signOutLocal('Your session ended. Please sign in again.'); throw new Error('Please sign in again.'); }
  return x;
};
async function rpc(fn, args) {
  const x = await sbFetch('rpc/' + fn, { method: 'POST', body: JSON.stringify(args || {}) }), t = await x.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!x.ok) throw new Error((j && j.message) || t || 'Request failed');
  return j;
}
// read every row of a query, 1000 at a time
async function getAll(path) {
  const rows = [];
  for (let off = 0; ; off += 1000) { const x = await sbFetch(`${path}&limit=1000&offset=${off}`); if (!x.ok) throw new Error(await x.text()); const part = await x.json(); rows.push(...part); if (part.length < 1000) break; }
  return rows;
}
// two entries are duplicates when every field is identical (ignoring the print timestamp and surrounding spaces)
const norm = d => { const o = {}; for (const [k, v] of Object.entries(d)) { if (k === 'printedAt') continue; const t = String(v ?? '').trim(); if (t !== '') o[k] = t; } return o; };
const dupKey = d => { const n = norm(d); return JSON.stringify(Object.keys(n).sort().map(k => [k, n[k]])); };
const store = {
  async save(d) {
    const branch = needBranch(), clean = { ...norm(d), printedAt: d.printedAt }, r = rd(clean);
    if ((await this.list(branch)).some(e => dupKey(e.data) === dupKey(d))) throw new Error('DUPLICATE');
    const row = { branch_id: branch, gc_no: d.gc, entry_date: d.date || null, from_city: d.from, to_city: d.to, consignor: d.consignor, consignee: d.consignee, total: chargeTotal(r), data: clean };
    const x = await sbFetch('entries', { method: 'POST', body: JSON.stringify(row) }); if (x.status === 409) throw new Error('DUPLICATE'); if (!x.ok) throw new Error(await x.text());
  },
  async list(b) {
    const rows = await getAll(`entries?select=*&order=created_at.desc${bq(b)}`);
    const seen = new Set(); return rows.filter(e => { const k = e.branch_id + '|' + dupKey(e.data); if (seen.has(k)) return false; seen.add(k); return true; });
  },
};
store.setPayType = async function (e, payType) {
  const data = { ...e.data, payType };
  const x = await sbFetch(`entries?id=eq.${e.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ data }) }); if (!x.ok) throw new Error(await x.text());
  e.data = data; warmP = null;
};
// generic "one table of saved rows" store (inward receipts, delivery slips)
const tableStore = (table, missingMsg) => ({
  missing: m => /PGRST205|does not exist|404/.test(m) ? missingMsg : m,
  async list() { try { return await getAll(`${table}?select=*&order=created_at.desc${bq()}`); } catch (e) { throw new Error(this.missing(e.message)); } },
  async add(rows) {
    const branch = needBranch();
    const x = await sbFetch(table, { method: 'POST', body: JSON.stringify(rows.map(r => ({ ...r, branch_id: branch }))) }); if (!x.ok) throw new Error(this.missing(await x.text()));
  },
});
const inwardStore = tableStore('inwards', 'The inwards table is missing in Supabase. Run supabase.sql and supabase-branches.sql once.');
const slipStore = tableStore('delivery_slips', 'The delivery_slips table is missing in Supabase. Run supabase.sql and supabase-branches.sql once.');
const lrStore = {
  missing: m => /PGRST205|does not exist|404/.test(m) ? 'The lrs table is missing in Supabase. Run supabase.sql and supabase-branches.sql once.' : m,
  async save(lr) {
    const row = { branch_id: needBranch(), memo_no: lr.memoNo, lr_date: lr.date || null, gc_numbers: lr.rows.map(r => r.lr), data: lr };
    const x = await sbFetch('lrs', { method: 'POST', body: JSON.stringify(row) }); if (!x.ok) throw new Error(this.missing(await x.text()));
  },
  async list() { try { return await getAll(`lrs?select=*&order=created_at.desc${bq()}`); } catch (e) { throw new Error(this.missing(e.message)); } },
  async memoNos() { try { return await getAll(`lrs?select=memo_no${bq()}`); } catch (e) { throw new Error(this.missing(e.message)); } },
  nextMemo(list) { const n = list.reduce((m, l) => Math.max(m, parseInt(String(l.memo_no || '').replace(/\D/g, '')) || 0), 0) + 1; return 'SL' + String(n).padStart(3, '0'); },
};

// ---- modal: document viewer with the actions on top ----
const lrModal = $('#lrModal'), lrBox = $('#lrBox');
const closeModal = () => lrModal.classList.add('hidden');
const openModal = wide => { lrBox.classList.toggle('wide', !!wide); lrModal.classList.remove('hidden'); };
lrModal.addEventListener('mousedown', e => { if (e.target === lrModal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// pagesFn(inline) -> Promise<string[]> of SVG pages (inline = embed images so it can be rasterised / printed)
async function showDoc(title, sub, pagesFn, name) {
  const pages = await pagesFn(false);
  lrBox.innerHTML = `<div class="modal-top"><div><h3>${esc(title)}</h3><p class="sub">${esc(sub)}${pages.length > 1 ? ` · ${pages.length} pages` : ''}</p></div>
    <div class="modal-btns"><button type="button" class="btn-primary" id="docPdf">Download PDF</button><button type="button" class="btn-secondary" id="docPrint">Print</button><button type="button" class="btn-secondary" id="docClose">Close</button></div></div>
    <div class="pages">${pages.join('')}</div>`;
  openModal(true);
  $('#docClose').onclick = closeModal;
  $('#docPdf').onclick = async () => { const b = $('#docPdf'); b.disabled = true; b.textContent = 'Preparing…'; try { await svgToPDF(await pagesFn(true), name + '.pdf'); } catch (e) { showToast(e.message, true); } b.disabled = false; b.textContent = 'Download PDF'; };
  $('#docPrint').onclick = async () => svgPrint(await pagesFn(true), name);
}
const receiptPagesFn = d => async inline => [receiptSVG(rd(d), inline ? await inlineImgs() : undefined)];
// LR rows always show the GC's current pay type and total (so an Inward pay-type change and older LRs are reflected)
async function liveLR(lr, branch) {
  let list = []; try { list = await store.list(branch); } catch (e) {}
  const by = new Map(list.map(e => [String(e.gc_no), e]));
  return { ...lr, rows: (lr.rows || []).map(r => { const e = by.get(String(r.lr)); return e ? { ...r, pay: e.data.payType || r.pay, total: e.total } : r; }) };
}
const lrPagesFn = (lr, branch) => async () => lrPages(await liveLR(lr, branch));

// ---- form events ----
document.addEventListener('input', e => {
  if (e.target.matches('#fields input, #fields select')) {
    data[e.target.name] = e.target.value; $('#totalOut').textContent = fmt(chargeTotal(rd(data)));
    if (savedEntry) showFinish(); // editing after a save means a new entry: bring the Finish button back
  }
});
// After a successful save the Finish button is replaced by View / Download PDF / Print for that entry.
let savedEntry = null;
function showFinish() { savedEntry = null; $('#doneBtns').classList.add('hidden'); const b = $('#nextBtn'); b.classList.remove('hidden', 'working'); b.disabled = false; b.textContent = 'Finish entry'; }
$('#entryForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#nextBtn'); btn.disabled = true; btn.classList.add('working'); btn.textContent = 'Saving…';
  try {
    data.printedAt = nowStamp(); await store.save(data);
    savedEntry = { ...data }; warmP = null; // a new entry exists: drop the prefetched list
    btn.classList.add('hidden'); $('#doneBtns').classList.remove('hidden');
    showToast('Entry saved');
  } catch (err) {
    err.message === 'DUPLICATE' ? showToast('This entry already exists — it was not saved again.', true) : showToast('Save failed: ' + err.message, true);
    showFinish();
  }
});
$('#doneView').addEventListener('click', () => showDoc('GC ' + savedEntry.gc, 'Saved receipt.', receiptPagesFn(savedEntry), `GC-${savedEntry.gc}`));
$('#donePdf').addEventListener('click', () => receiptPDF(rd(savedEntry), `GC-${savedEntry.gc}.pdf`).catch(e => showToast(e.message, true)));
$('#donePrint').addEventListener('click', () => receiptPrint(rd(savedEntry)));
function newEntry() { data = { ...defaults }; renderForm(); showFinish(); show('new'); }
$('#newEntryBtn').addEventListener('click', () => { newEntry(); showToast('Started a new entry'); });

// ---- navigation + dashboard ----
function show(v) {
  $('#viewNew').classList.toggle('hidden', v !== 'new'); $('#viewDash').classList.toggle('hidden', v !== 'dash'); $('#viewBranches').classList.toggle('hidden', v !== 'branches');
  $('#navNew').classList.toggle('active', v === 'new'); $('#navDash').classList.toggle('active', v === 'dash'); $('#navBranches').classList.toggle('active', v === 'branches');
}
$('#navNew').addEventListener('click', () => show('new'));
let entries = [], lrs = [], inwards = [], slips = [], tab = 'entries';
const actions = `<button type="button" class="btn-secondary mini" data-a="view">View</button> <button type="button" class="btn-secondary mini" data-a="pdf">PDF</button> <button type="button" class="btn-secondary mini" data-a="print">Print</button>`;
async function loadEntries() {
  entries = await store.list();
  renderEntries();
}
let viewList = [];
const natCmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
const dateCmp = (a, b) => String(a.entry_date || '').localeCompare(String(b.entry_date || '')) || String(a.created_at).localeCompare(String(b.created_at));
function renderEntries() {
  const q = $('#gcSearch').value.trim().toLowerCase(), pay = $('#gcPay').value, sort = $('#gcSort').value;
  viewList = entries.filter(e => (!q || String(e.gc_no || '').toLowerCase().includes(q)) && (!pay || (e.data && e.data.payType) === pay));
  const by = { gcAsc: (a, b) => natCmp(a.gc_no, b.gc_no), gcDesc: (a, b) => natCmp(b.gc_no, a.gc_no), dateDesc: (a, b) => dateCmp(b, a), dateAsc: dateCmp }[sort];
  if (by) viewList.sort(by);
  $('#gcCount').textContent = viewList.length === entries.length ? `${entries.length} entries` : `${viewList.length} of ${entries.length} entries`;
  $('#rows').innerHTML = viewList.length ? viewList.map((e, i) => `<tr class="row" data-i="${i}"><td class="adm">${esc(bname(e.branch_id))}</td><td>${esc(e.gc_no)}</td><td>${esc(e.entry_date)}</td><td>${esc(e.from_city)}</td><td>${esc(e.to_city)}</td><td>${esc(e.consignor)}</td><td>${esc(e.consignee)}</td><td>${esc(e.data && e.data.payType)}</td><td>${fmt(e.total)}</td><td>${new Date(e.created_at).toLocaleString('en-IN')}</td><td>${actions}</td></tr>`).join('') : `<tr><td colspan="11">${entries.length ? 'No matching entries.' : 'No entries yet.'}</td></tr>`;
}
async function loadLRs() {
  lrs = await lrStore.list();
  $('#lrRows').innerHTML = lrs.length ? lrs.map((l, i) => `<tr class="row" data-i="${i}"><td class="adm">${esc(bname(l.branch_id))}</td><td>${esc(l.memo_no)}</td><td>${esc(dmy(l.lr_date))}</td><td title="${esc(l.data.from)}">${esc(cities3(l.data.from))}</td><td title="${esc(l.data.to)}">${esc(cities3(l.data.to))}</td><td>${(l.gc_numbers || []).length}</td><td>${esc(l.data.truckNo)}</td><td>${new Date(l.created_at).toLocaleString('en-IN')}</td><td>${actions}</td></tr>`).join('') : '<tr><td colspan="9">No reports yet. Use Create New LR.</td></tr>';
}
function setTab(t) {
  tab = t;
  [['entries', 'Entries', 'paneEntries'], ['lr', 'LR', 'paneLR'], ['in', 'In', 'paneIn'], ['slip', 'Slip', 'paneSlip']].forEach(([k, n, pane]) => { $('#tab' + n).classList.toggle('active', t === k); $('#' + pane).classList.toggle('hidden', t !== k); });
  $('#dashHint').textContent = { entries: 'All GC entries saved so far. Click a row to view it.', lr: 'All lorry receipts created so far, one row each.', in: 'GCs received at this office. Pay type can be changed per row.', slip: 'Delivery slips created so far.' }[t];
}
async function loadDash() { try { await { entries: loadEntries, lr: loadLRs, in: loadInward, slip: loadSlips }[tab](); } catch (err) { showToast(err.message, true); } }
$('#navDash').addEventListener('click', () => { show('dash'); $('#mode').textContent = scopeLabel(); loadDash(); });
$('#tabEntries').addEventListener('click', () => { setTab('entries'); loadDash(); });
$('#tabLR').addEventListener('click', () => { setTab('lr'); loadDash(); warm(); });
$('#tabIn').addEventListener('click', () => { setTab('in'); loadDash(); });
$('#tabSlip').addEventListener('click', () => { setTab('slip'); loadDash(); });
$('#rows').addEventListener('click', async e => {
  const tr = e.target.closest('tr.row'); if (!tr) return; const row = viewList[tr.dataset.i], a = e.target.dataset.a;
  if (a === 'pdf') return receiptPDF(rd(row.data), `GC-${row.gc_no}.pdf`);
  if (a === 'print') return receiptPrint(rd(row.data));
  showDoc('GC ' + row.gc_no, 'Saved receipt.', receiptPagesFn(row.data), `GC-${row.gc_no}`);
});

// ---- LR (lorry receipt) ----
// Picker built for hundreds of GCs: checkbox list, search, Shift-click ranges, select-all-shown, selected-only filter.
let pool = [];
// entries are fetched ahead of time (when the REPORT tab opens) so the Create LR window has them ready
let warmP = null, warmAt = 0;
function warm() { if (!warmP || Date.now() - warmAt > 30000) { warmAt = Date.now(); warmP = Promise.all([store.list().catch(() => null), lrStore.memoNos().catch(() => null)]); } return warmP; }
async function openCreateLR() {
  let lrBranch; try { lrBranch = needBranch(); } catch (err) { showToast(err.message, true); return; }
  lrBox.innerHTML = '<h3>Create new LR</h3><p class="sub">Loading your GC entries…</p><div class="pk-note">Loading…</div>';
  openModal(true);
  let memoNo;
  try {
    const [cached, memos] = await warm();
    pool = cached || await store.list(); memoNo = lrStore.nextMemo(memos || await lrStore.memoNos());
  } catch (err) { closeModal(); showToast(err.message, true); return; }
  const today = new Date().toISOString().slice(0, 10), CAP = 2000;
  const order = [];            // pool indexes in the order they were selected (= row order on the sheet)
  const sel = new Set();
  let shown = [], last = -1;   // currently listed pool indexes, last clicked position in `shown`
  lrBox.innerHTML = `<h3>Create new LR</h3><p class="sub">Memo No. ${esc(memoNo)}. Tick the GC numbers to include. Shift-click selects a range. Every ${LR_ROWS} GCs make one page.</p>
    <div class="pk-bar"><input type="text" id="lrSearch" placeholder="Search GC number, consignor, consignee or city" autocomplete="off">
      <button type="button" class="btn-secondary mini" id="pkAll">Select all shown</button><button type="button" class="btn-secondary mini" id="pkNone">Clear</button>
      <label class="pk-only"><input type="checkbox" id="pkOnly"> Selected only</label></div>
    <div class="pk-list" id="pkList"></div>
    <div class="pk-status" id="pkStatus"></div>
    <div class="fields"><div class="field"><label for="lrDate">Date</label><input id="lrDate" type="date" value="${today}"></div><div class="field"><label for="lrTruck">Truck No. (optional)</label><input id="lrTruck"></div>
    <div class="field"><label for="lrDriver">Driver Name (optional)</label><input id="lrDriver"></div><div class="field"><label for="lrSupplier">Truck Supplier (optional)</label><input id="lrSupplier"></div>
    <div class="field full"><label for="lrOwner">Owner Name &amp; Add. (optional)</label><input id="lrOwner"></div></div>
    <div class="modal-actions sticky"><span class="pk-count" id="pkCount"></span><button type="button" class="btn-secondary" id="lrCancel">Cancel</button><button type="button" class="btn-primary" id="lrCreate">Create LR</button></div>`;
  openModal(true);
  const list = $('#pkList'), search = $('#lrSearch');
  const line = i => { const e = pool[i]; return `<div class="pk-row" data-i="${i}"><input type="checkbox" tabindex="-1"><span class="g">${esc(e.gc_no)}</span><span>${esc(e.from_city)} &rarr; ${esc(e.to_city)}</span><span>${esc(e.consignor)}</span><span>${esc(e.consignee)}</span><span class="d">${esc(dmy(e.entry_date))}</span></div>`; };
  function status() {
    const n = order.length, pages = Math.max(1, Math.ceil(n / LR_ROWS));
    $('#pkStatus').textContent = `${n} selected of ${pool.length} GCs${n ? ` · ${pages} page${pages > 1 ? 's' : ''}` : ''}`;
    $('#pkCount').textContent = n ? `${n} GC${n > 1 ? 's' : ''}` : '';
  }
  function paint() { list.querySelectorAll('.pk-row').forEach(r => { const on = sel.has(+r.dataset.i); r.classList.toggle('on', on); r.firstChild.checked = on; }); status(); }
  function render() {
    const q = search.value.trim().toLowerCase(), only = $('#pkOnly').checked;
    const all = pool.map((_, i) => i).filter(i => {
      const e = pool[i]; if (only && !sel.has(i)) return false;
      return !q || [e.gc_no, e.consignor, e.consignee, e.from_city, e.to_city].some(v => String(v || '').toLowerCase().includes(q));
    });
    shown = all.slice(0, CAP); last = -1;
    list.innerHTML = shown.length
      ? `<div class="pk-row pk-head"><span></span><span>GC No</span><span>Route</span><span>Consignor</span><span>Consignee</span><span>Date</span></div>` + shown.map(line).join('') + (all.length > CAP ? `<div class="pk-note">Showing the first ${CAP} of ${all.length}. Narrow the search to see the rest.</div>` : '')
      : `<div class="pk-note">${pool.length ? 'No matching GC numbers' : 'No entries saved yet'}</div>`;
    paint();
  }
  function setSel(i, on) { if (on && !sel.has(i)) { sel.add(i); order.push(i); } else if (!on && sel.has(i)) { sel.delete(i); order.splice(order.indexOf(i), 1); } }
  list.addEventListener('click', e => {
    const row = e.target.closest('.pk-row[data-i]'); if (!row) return;
    const i = +row.dataset.i, pos = shown.indexOf(i), on = !sel.has(i);
    if (e.shiftKey && last >= 0) { const [a, b] = pos > last ? [last, pos] : [pos, last]; for (let k = a; k <= b; k++) setSel(shown[k], on); }
    else setSel(i, on);
    last = pos; paint();
  });
  search.addEventListener('input', render);
  $('#pkOnly').addEventListener('change', render);
  $('#pkAll').onclick = () => { shown.forEach(i => setSel(i, true)); paint(); };
  $('#pkNone').onclick = () => { sel.clear(); order.length = 0; render(); };
  $('#lrCancel').onclick = closeModal;
  $('#lrCreate').onclick = async () => {
    if (!order.length) { showToast('Pick at least one GC number', true); search.focus(); return; }
    const lr = lrFromEntries(order.map(i => pool[i]), { memoNo, date: $('#lrDate').value, truckNo: $('#lrTruck').value.trim(), driverName: $('#lrDriver').value.trim(), truckSupplier: $('#lrSupplier').value.trim(), ownerName: $('#lrOwner').value.trim() });
    const b = $('#lrCreate'); b.disabled = true; b.textContent = 'Creating…';
    try { await lrStore.save(lr); warmP = null; await showDoc('LR ' + lr.memoNo + ' created', 'Total cartons and the stamp are left blank to be written by hand.', lrPagesFn(lr, lrBranch), `LR-${lr.memoNo}`); if (tab === 'lr') loadLRs().catch(() => {}); }
    catch (err) { showToast(err.message, true); b.disabled = false; b.textContent = 'Create LR'; }
  };
  render(); search.focus();
}
$('#newLRBtn').addEventListener('click', openCreateLR);
$('#lrRows').addEventListener('click', async e => {
  const tr = e.target.closest('tr.row'); if (!tr) return; const l = lrs[tr.dataset.i], a = e.target.dataset.a;
  if (a === 'pdf') return svgToPDF(lrPages(await liveLR(l.data, l.branch_id)), `LR-${l.memo_no}.pdf`);
  if (a === 'print') return svgPrint(lrPages(await liveLR(l.data, l.branch_id)), `LR ${l.memo_no}`);
  showDoc('LR ' + l.memo_no, 'Saved lorry receipt.', lrPagesFn(l.data, l.branch_id), `LR-${l.memo_no}`);
});

// ---- shared: GC search box with a drop-down of matches ----
function gcSearchBox(input, dd, candidates, onPick) {
  const draw = () => {
    const q = input.value.trim().toLowerCase(); if (!q) { dd.innerHTML = ''; return; }
    const hits = candidates().filter(e => [e.gc_no, e.consignor, e.consignee].some(v => String(v || '').toLowerCase().includes(q))).slice(0, 30);
    dd.innerHTML = hits.length ? hits.map(e => `<div data-g="${esc(e.gc_no)}"><span><b>${esc(e.gc_no)}</b> <small>${esc(e.consignor)} &rarr; ${esc(e.consignee)}</small></span><small>${esc(e.from_city)} &rarr; ${esc(e.to_city)}</small></div>`).join('') : '<div class="none">No matching GC number</div>';
  };
  input.addEventListener('input', draw); input.addEventListener('focus', draw);
  dd.addEventListener('click', ev => { const r = ev.target.closest('[data-g]'); if (!r) return; onPick(r.dataset.g); input.value = ''; dd.innerHTML = ''; input.focus(); });
}
const entryOf = (gc, branch) => entries.find(e => String(e.gc_no) === String(gc) && (branch == null || e.branch_id === branch));

// ---- INWARD ----
async function loadInward() {
  [entries, inwards] = await Promise.all([store.list(), inwardStore.list()]);
  renderInward();
}
function renderInward() {
  $('#inRows').innerHTML = inwards.length ? inwards.map((w, i) => {
    const e = entryOf(w.gc_no, w.branch_id) || { data: {} }, pay = e.data.payType || '';
    return `<tr data-i="${i}"><td class="adm">${esc(bname(w.branch_id))}</td><td>${esc(w.gc_no)}</td><td>${esc(dmy(e.entry_date))}</td><td>${esc(e.from_city)}</td><td>${esc(e.to_city)}</td><td>${esc(e.consignor)}</td><td>${esc(e.consignee)}</td>
      <td><select class="pay-sel" data-orig="${esc(pay)}">${PAY.map(p => `<option ${p === pay ? 'selected' : ''}>${p}</option>`).join('')}</select><button type="button" class="btn-primary save-pay hidden">Save</button></td>
      <td>${e.total != null ? fmt(e.total) : ''}</td><td class="rcv">&#10003; Received<br><small style="color:var(--muted);font-weight:400">${new Date(w.created_at).toLocaleDateString('en-IN')}</small></td></tr>`;
  }).join('') : '<tr><td colspan="10">Nothing received yet. Use RECEIVED to add GC numbers.</td></tr>';
}
$('#inRows').addEventListener('change', e => { const s = e.target.closest('.pay-sel'); if (s) s.parentElement.querySelector('.save-pay').classList.toggle('hidden', s.value === s.dataset.orig); });
$('#inRows').addEventListener('click', async e => {
  const b = e.target.closest('.save-pay'); if (!b) return;
  const tr = b.closest('tr'), sel = tr.querySelector('.pay-sel'), ent = entryOf(inwards[tr.dataset.i].gc_no, inwards[tr.dataset.i].branch_id);
  if (!ent) { showToast('GC entry not found', true); return; }
  b.disabled = true; b.textContent = 'Saving…';
  try { await store.setPayType(ent, sel.value); sel.dataset.orig = sel.value; b.classList.add('hidden'); showToast('Pay type updated everywhere'); }
  catch (err) { showToast('Save failed: ' + err.message, true); }
  b.disabled = false; b.textContent = 'Save';
});
async function openReceived() {
  try { needBranch(); } catch (err) { showToast(err.message, true); return; }
  lrBox.innerHTML = '<h3>Received</h3><p class="sub">Loading…</p>'; openModal(false);
  let have;
  try { [entries, inwards] = await Promise.all([store.list(), inwardStore.list()]); have = new Set(inwards.map(w => String(w.gc_no))); } catch (err) { closeModal(); showToast(err.message, true); return; }
  const chosen = [];
  lrBox.innerHTML = `<h3>Received</h3><p class="sub">Search a GC number, pick it from the list, then press ADD.</p>
    <div class="picker"><input type="text" id="rcvSearch" placeholder="Search GC number, consignor or consignee" autocomplete="off"><div class="dd" id="rcvDd"></div></div>
    <div class="chips" id="rcvChips"></div>
    <div class="modal-actions"><button type="button" class="btn-secondary" id="rcvCancel">Cancel</button><button type="button" class="btn-primary" id="rcvAdd">ADD</button></div>`;
  const chips = $('#rcvChips');
  const drawChips = () => { chips.innerHTML = chosen.map((g, i) => `<span class="chip">${esc(g)}<button type="button" data-x="${i}">&times;</button></span>`).join(''); };
  gcSearchBox($('#rcvSearch'), $('#rcvDd'), () => entries.filter(e => !have.has(String(e.gc_no)) && !chosen.includes(String(e.gc_no))), g => { chosen.push(String(g)); drawChips(); });
  chips.onclick = ev => { const x = ev.target.dataset.x; if (x != null) { chosen.splice(+x, 1); drawChips(); } };
  $('#rcvCancel').onclick = closeModal; $('#rcvSearch').focus();
  $('#rcvAdd').onclick = async () => {
    if (!chosen.length) { showToast('Pick at least one GC number', true); return; }
    const b = $('#rcvAdd'); b.disabled = true; b.textContent = 'Adding…';
    try { await inwardStore.add(chosen.map(g => ({ gc_no: g }))); closeModal(); showToast(`${chosen.length} GC${chosen.length > 1 ? 's' : ''} marked received`); loadInward().catch(err => showToast(err.message, true)); }
    catch (err) { showToast(err.message, true); b.disabled = false; b.textContent = 'ADD'; }
  };
}
$('#receivedBtn').addEventListener('click', openReceived);

// ---- DELIVERY SLIP ----
async function loadSlips() {
  slips = await slipStore.list();
  $('#slipRows').innerHTML = slips.length ? slips.map(s => `<tr><td class="adm">${esc(bname(s.branch_id))}</td><td>${esc(s.slip_no)}</td><td>${esc(dmy(s.slip_date))}</td><td title="${esc((s.gc_numbers || []).join(', '))}">${esc((s.gc_numbers || []).slice(0, 6).join(', '))}${(s.gc_numbers || []).length > 6 ? '…' : ''}</td><td>${(s.gc_numbers || []).length}</td><td>${fmt(s.total)}</td><td>${new Date(s.created_at).toLocaleString('en-IN')}</td></tr>`).join('') : '<tr><td colspan="7">No delivery slips yet. Use Create Delivery slip.</td></tr>';
}
async function openCreateSlip() {
  try { needBranch(); } catch (err) { showToast(err.message, true); return; }
  lrBox.innerHTML = '<h3>Create Delivery slip</h3><p class="sub">Loading…</p>'; openModal(true);
  let slipNo;
  try { [entries, slips] = await Promise.all([store.list(), slipStore.list()]); const n = slips.reduce((m, x) => Math.max(m, parseInt(String(x.slip_no || '').replace(/\D/g, '')) || 0), 0) + 1; slipNo = 'DS' + String(n).padStart(3, '0'); } catch (err) { closeModal(); showToast(err.message, true); return; }
  const rows = []; // { gc, units, door, other }
  lrBox.innerHTML = `<h3>Create Delivery slip</h3><p class="sub">Slip No. ${esc(slipNo)}. Enter GC numbers; each one is added below with its charges. Total = door delivery &times; units + other.</p>
    <div class="picker"><input type="text" id="slSearch" placeholder="Search GC number, consignor or consignee" autocomplete="off"><div class="dd" id="slDd"></div></div>
    <div style="overflow-x:auto"><table class="slip-table"><thead><tr><th>GC Number</th><th>Units</th><th>Door Delivery Charge</th><th>Other Charge</th><th>Total</th><th></th></tr></thead><tbody id="slBody"></tbody><tfoot><tr><th colspan="4" style="text-align:right">Grand total</th><th id="slGrand">0.00</th><th></th></tr></tfoot></table></div>
    <div class="modal-actions"><button type="button" class="btn-secondary" id="slCancel">Cancel</button><button type="button" class="btn-primary" id="slCreate">Create slip</button></div>`;
  const tot = r => (parseFloat(r.door) || 0) * r.units + (parseFloat(r.other) || 0);
  const sums = () => { rows.forEach((r, i) => { const c = $(`#slBody tr[data-i="${i}"] .t`); if (c) c.textContent = fmt(tot(r)); }); $('#slGrand').textContent = fmt(rows.reduce((a, r) => a + tot(r), 0)); };
  const draw = () => {
    $('#slBody').innerHTML = rows.length ? rows.map((r, i) => `<tr data-i="${i}"><td><b>${esc(r.gc)}</b></td><td>${r.units}</td><td><input type="number" min="0" step="any" data-k="door" value="${esc(r.door)}" placeholder="0"></td><td><input type="number" min="0" step="any" data-k="other" value="${esc(r.other)}" placeholder="0"></td><td class="t">${fmt(tot(r))}</td><td><button type="button" class="x" data-x="${i}">&times;</button></td></tr>`).join('') : '<tr><td colspan="6" style="color:var(--muted)">No GC numbers added yet.</td></tr>';
    sums();
  };
  gcSearchBox($('#slSearch'), $('#slDd'), () => entries.filter(e => !rows.some(r => r.gc === String(e.gc_no))), g => { const e = entryOf(g); rows.push({ gc: String(g), units: parseFloat(e && e.data.quantity) || 0, door: '', other: '' }); draw(); });
  $('#slBody').addEventListener('input', ev => { const k = ev.target.dataset.k; if (k) { rows[ev.target.closest('tr').dataset.i][k] = ev.target.value; sums(); } });
  $('#slBody').addEventListener('click', ev => { const x = ev.target.dataset.x; if (x != null) { rows.splice(+x, 1); draw(); } });
  $('#slCancel').onclick = closeModal; draw(); $('#slSearch').focus();
  $('#slCreate').onclick = async () => {
    if (!rows.length) { showToast('Add at least one GC number', true); return; }
    const b = $('#slCreate'); b.disabled = true; b.textContent = 'Creating…';
    const data = rows.map(r => ({ gc: r.gc, units: r.units, door: parseFloat(r.door) || 0, other: parseFloat(r.other) || 0, total: tot(r) }));
    try { await slipStore.add([{ slip_no: slipNo, slip_date: new Date().toISOString().slice(0, 10), gc_numbers: rows.map(r => r.gc), total: data.reduce((a, r) => a + r.total, 0), data }]); closeModal(); showToast('Delivery slip ' + slipNo + ' created'); loadSlips().catch(err => showToast(err.message, true)); }
    catch (err) { showToast(err.message, true); b.disabled = false; b.textContent = 'Create slip'; }
  };
}
$('#newSlipBtn').addEventListener('click', openCreateSlip);

// report table shows at most 3 cities per cell (full list on hover)
function cities3(s) { const c = String(s || '').split(', ').filter(Boolean); return c.slice(0, 3).join(', ') + (c.length > 3 ? '…' : ''); }
$('#gcSearch').addEventListener('input', renderEntries);
$('#gcSort').addEventListener('change', renderEntries);
$('#gcPay').addEventListener('change', renderEntries);

// keep the pressed colour visible for a moment after a click
document.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; b.classList.add('pressed'); setTimeout(() => b.classList.remove('pressed'), 400); });

// ================= sign-in =================
const SESSION_KEY = 'sl_session';
const normPhone = p => String(p || '').replace(/\D/g, '').slice(-10);
const scopeLabel = () => isAdmin() ? (scopeBranch ? bname(scopeBranch) : 'All branches') : (session.branch_name || '');
function signOutLocal(msg) {
  session = null; scopeBranch = null; branches = []; entries = []; lrs = []; inwards = []; slips = []; warmP = null;
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  closeModal(); showLogin(msg);
}
let lg = { stage: 'id', id: '' };
function lgStage(stage, msg) {
  lg.stage = stage;
  $('#lgIdWrap').classList.toggle('hidden', stage !== 'id');
  $('#lgPwWrap').classList.toggle('hidden', stage === 'id');
  $('#lgPw2Wrap').classList.toggle('hidden', stage !== 'set');
  $('#lgBack').classList.toggle('hidden', stage === 'id');
  $('#lgPw').autocomplete = stage === 'set' ? 'new-password' : 'current-password';
  $('#lgPwLabel').textContent = stage === 'set' ? 'Create a password' : 'Password';
  $('#lgTitle').textContent = stage === 'set' ? 'Welcome! Create your password' : 'Sign in';
  $('#lgSub').textContent = stage === 'id' ? 'Enter your phone number (employees) or email (admin).' : stage === 'set' ? `First sign-in for ${lg.id}. Choose a password (at least 6 characters) to use from now on.` : lg.id;
  $('#lgBtn').textContent = stage === 'id' ? 'Continue' : stage === 'set' ? 'Save password & sign in' : 'Sign in';
  $('#lgErr').textContent = msg || '';
  $('#lgPw').value = ''; $('#lgPw2').value = '';
  setTimeout(() => $(stage === 'id' ? '#lgId' : '#lgPw').focus(), 30);
}
function showLogin(msg) { $('#appRoot').classList.add('hidden'); $('#loginView').classList.remove('hidden'); lg.id = ''; $('#lgId').value = ''; lgStage('id', msg); }
$('#lgBack').addEventListener('click', () => lgStage('id'));
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#lgBtn'), err = m => { $('#lgErr').textContent = m; };
  btn.disabled = true; $('#lgErr').textContent = '';
  try {
    if (lg.stage === 'id') {
      const id = $('#lgId').value.trim(); if (!id) return err('Enter your phone number or email.');
      const st = await rpc('auth_status', { p_id: id }); lg.id = id;
      if (st === 'unknown') return err('No account found for this number / email. Ask the admin to add you.');
      if (st === 'inactive') return err('This account is switched off. Contact the admin.');
      return lgStage(st === 'set_password' ? 'set' : 'login');
    }
    const pw = $('#lgPw').value; let res;
    if (lg.stage === 'set') {
      if (pw.length < 6) return err('Password must be at least 6 characters.');
      if (pw !== $('#lgPw2').value) return err('The two passwords do not match.');
      res = await rpc('auth_set_password', { p_id: lg.id, p_password: pw });
    } else res = await rpc('auth_login', { p_id: lg.id, p_password: pw });
    if (res.error) return err(res.error === 'LOCKED' ? 'Too many wrong attempts. Try again in 15 minutes.' : 'Wrong password.');
    session = res; try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (x) {}
    await enterApp();
  } catch (ex) { err(ex.message === 'INVALID_LOGIN' ? 'Could not sign in. Ask the admin.' : ex.message); }
  finally { btn.disabled = false; }
});
$('#logoutBtn').addEventListener('click', async () => { try { await rpc('auth_logout'); } catch (e) {} signOutLocal(); });

async function loadBranches() {
  const x = await sbFetch('branches?select=*&order=name'); branches = x.ok ? await x.json() : []; fillScope();
}
function fillScope() {
  if (!isAdmin()) return;
  const opts = '<option value="">All branches</option>' + branches.filter(b => b.active || b.id === scopeBranch).map(b => `<option value="${b.id}" ${b.id === scopeBranch ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  document.querySelectorAll('.scopeSel').forEach(s => { s.innerHTML = opts; });
}
function updateEntryHint() {
  const b = curBranch();
  $('#entryHint').textContent = b ? `Saving to branch: ${isAdmin() ? bname(b) : session.branch_name}` : 'Choose a branch in the left menu before saving.';
}
function setScope(id) {
  scopeBranch = id || null; fillScope(); warmP = null; updateEntryHint(); $('#mode').textContent = scopeLabel();
  if (!$('#viewDash').classList.contains('hidden')) loadDash();
}
document.querySelectorAll('.scopeSel').forEach(s => s.addEventListener('change', e => setScope(+e.target.value)));
async function enterApp() {
  $('#loginView').classList.add('hidden'); $('#appRoot').classList.remove('hidden');
  document.body.classList.toggle('emp', !isAdmin());
  $('#whoami').innerHTML = `<b>${esc(session.name)}</b><small>${isAdmin() ? 'Administrator' : esc(session.branch_name || '')}</small>`;
  scopeBranch = null; await loadBranches();
  data = { ...defaults }; renderForm(); showFinish(); show('new'); updateEntryHint();
}

// ================= branches + employees (admin) =================
let accts = [], brOpen = null;
function formModal(title, sub, fields, onSave, btnText) {
  lrBox.innerHTML = `<h3>${esc(title)}</h3><p class="sub">${esc(sub)}</p><div class="fields">${fields.map(f => `<div class="field ${f.full ? 'full' : ''}"><label for="fm_${f.k}">${f.label}</label><input id="fm_${f.k}" value="${esc(f.val || '')}" placeholder="${esc(f.ph || '')}" ${f.mode ? `inputmode="${f.mode}"` : ''} autocomplete="off"></div>`).join('')}</div>
    <div class="modal-actions"><button type="button" class="btn-secondary" id="fmCancel">Cancel</button><button type="button" class="btn-primary" id="fmSave">${btnText || 'Save'}</button></div>`;
  openModal(false); $('#fm_' + fields[0].k).focus();
  $('#fmCancel').onclick = closeModal;
  const go = async () => {
    const v = {}; fields.forEach(f => { v[f.k] = $('#fm_' + f.k).value.trim(); });
    const b = $('#fmSave'); b.disabled = true;
    try { await onSave(v); closeModal(); } catch (err) { showToast(err.message, true); b.disabled = false; }
  };
  $('#fmSave').onclick = go;
  lrBox.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
}
async function writeOk(x, dupMsg) { if (x.ok) return x; const t = await x.text(); if (x.status === 409 || /23505/.test(t)) throw new Error(dupMsg); throw new Error(t); }
const json = o => JSON.stringify(o);
const stChip = on => on ? '<span class="chip-st ok">Active</span>' : '<span class="chip-st off">Off</span>';

async function loadBranchesPage() {
  await loadBranches();
  const x = await sbFetch('accounts?select=*&role=eq.employee&order=name'); if (!x.ok) throw new Error(await x.text());
  accts = await x.json(); renderBranches();
}
function renderBranches() {
  const b = brOpen && branches.find(v => v.id === brOpen);
  if (!b) { brOpen = null; return renderBranchList(); }
  renderBranchDetail(b);
}
function renderBranchList() {
  $('#brBody').innerHTML = `<div class="topbar"><div><h2>Branches</h2><p>Each branch has its own entries, reports, inward and delivery slips. Its employees see only that branch.</p></div><button type="button" class="btn-primary" data-a="addBranch">Add branch</button></div>
    <div class="card dash" style="padding:20px;overflow-x:auto"><table><thead><tr><th>Branch</th><th>City</th><th>Phone</th><th>Employees</th><th>Status</th><th></th></tr></thead><tbody>${branches.length ? branches.map(b => `<tr class="row" data-b="${b.id}"><td><b>${esc(b.name)}</b></td><td>${esc(b.city)}</td><td>${esc(b.phone)}</td><td>${accts.filter(a => a.branch_id === b.id).length}</td><td>${stChip(b.active)}</td><td><button type="button" class="btn-secondary mini" data-a="open">Open</button></td></tr>`).join('') : '<tr><td colspan="6">No branches yet. Use Add branch.</td></tr>'}</tbody></table></div>`;
}
function renderBranchDetail(b) {
  const emps = accts.filter(a => a.branch_id === b.id);
  $('#brBody').innerHTML = `<div class="br-head"><div><button type="button" class="btn-ghost mini" data-a="back">&larr; All branches</button><h2 style="margin-top:8px">${esc(b.name)} ${b.active ? '' : '<span class="chip-st off">Off</span>'}</h2><p class="br-meta">${[b.city, b.address, b.phone].filter(Boolean).map(esc).join(' &middot; ') || 'No details added yet'}</p></div>
    <div class="br-actions"><button type="button" class="btn-primary" data-a="viewData">View branch data</button><button type="button" class="btn-secondary" data-a="editBranch">Edit branch</button><button type="button" class="btn-secondary" data-a="toggleBranch">${b.active ? 'Switch off' : 'Switch on'}</button></div></div>
    <div class="br-sec"><h3>Employees (${emps.length})</h3><button type="button" class="btn-primary" data-a="addEmp">Add employee</button></div>
    <div class="card dash" style="padding:20px;overflow-x:auto"><table><thead><tr><th>Name</th><th>Phone</th><th>Password</th><th>Status</th><th></th></tr></thead><tbody>${emps.length ? emps.map(a => `<tr data-e="${a.id}"><td><b>${esc(a.name)}</b></td><td>${esc(a.phone)}</td><td>${a.has_password ? '<span class="chip-st ok">Set</span>' : '<span class="chip-st wait">Not set yet</span>'}</td><td>${stChip(a.active)}</td><td><button type="button" class="btn-secondary mini" data-a="editEmp">Edit</button><button type="button" class="btn-secondary mini" data-a="resetEmp" ${a.has_password ? '' : 'disabled'}>Reset password</button><button type="button" class="btn-secondary mini" data-a="toggleEmp">${a.active ? 'Switch off' : 'Switch on'}</button></td></tr>`).join('') : '<tr><td colspan="5">No employees yet. Use Add employee.</td></tr>'}</tbody></table></div>`;
}
$('#brBody').addEventListener('click', async e => {
  const btn = e.target.closest('[data-a]'), a = btn && btn.dataset.a, rowB = e.target.closest('tr[data-b]'), rowE = e.target.closest('tr[data-e]');
  const b = brOpen && branches.find(v => v.id === brOpen), emp = rowE && accts.find(v => v.id === +rowE.dataset.e);
  const done = async () => { await loadBranchesPage(); };
  try {
    if (a === 'back') { brOpen = null; return renderBranches(); }
    if (a === 'open' || (!a && rowB)) { brOpen = +rowB.dataset.b; return renderBranches(); }
    if (a === 'addBranch') return formModal('Add branch', 'Create the branch first, then add its employees.', [
      { k: 'name', label: 'Branch name *', ph: 'e.g. Surat' }, { k: 'city', label: 'City' }, { k: 'phone', label: 'Phone', mode: 'tel' }, { k: 'address', label: 'Address', full: true }],
      async v => { if (!v.name) throw new Error('Branch name is required.'); const x = await writeOk(await sbFetch('branches', { method: 'POST', headers: { Prefer: 'return=representation' }, body: json({ name: v.name, city: v.city || null, phone: v.phone || null, address: v.address || null }) }), 'A branch with this name already exists.'); brOpen = (await x.json())[0].id; await done(); showToast('Branch added'); }, 'Add branch');
    if (!b) return;
    if (a === 'editBranch') return formModal('Edit branch', b.name, [
      { k: 'name', label: 'Branch name *', val: b.name }, { k: 'city', label: 'City', val: b.city }, { k: 'phone', label: 'Phone', val: b.phone, mode: 'tel' }, { k: 'address', label: 'Address', val: b.address, full: true }],
      async v => { if (!v.name) throw new Error('Branch name is required.'); await writeOk(await sbFetch(`branches?id=eq.${b.id}`, { method: 'PATCH', body: json({ name: v.name, city: v.city || null, phone: v.phone || null, address: v.address || null }) }), 'A branch with this name already exists.'); await done(); showToast('Branch updated'); });
    if (a === 'toggleBranch') {
      if (b.active && !confirm(`Switch off ${b.name}? Its employees will not be able to sign in. Nothing is deleted.`)) return;
      await writeOk(await sbFetch(`branches?id=eq.${b.id}`, { method: 'PATCH', body: json({ active: !b.active }) })); const was = b.active; await done(); return showToast(was ? 'Branch switched off' : 'Branch switched on');
    }
    if (a === 'viewData') { setScope(b.id); show('dash'); $('#mode').textContent = scopeLabel(); loadDash(); return; }
    if (a === 'addEmp') return formModal('Add employee', `${b.name}. They sign in with this phone number and create their own password the first time.`, [
      { k: 'name', label: 'Name *' }, { k: 'phone', label: 'Phone number *', ph: '10 digits', mode: 'tel' }],
      async v => { const phone = normPhone(v.phone); if (!v.name) throw new Error('Name is required.'); if (phone.length !== 10) throw new Error('Enter a 10-digit phone number.'); await writeOk(await sbFetch('accounts', { method: 'POST', body: json({ role: 'employee', name: v.name, phone, branch_id: b.id }) }), 'This phone number is already registered.'); await done(); showToast('Employee added'); }, 'Add employee');
    if (!emp) return;
    if (a === 'editEmp') return formModal('Edit employee', b.name, [{ k: 'name', label: 'Name *', val: emp.name }, { k: 'phone', label: 'Phone number *', val: emp.phone, mode: 'tel' }],
      async v => { const phone = normPhone(v.phone); if (!v.name) throw new Error('Name is required.'); if (phone.length !== 10) throw new Error('Enter a 10-digit phone number.'); await writeOk(await sbFetch(`accounts?id=eq.${emp.id}`, { method: 'PATCH', body: json({ name: v.name, phone }) }), 'This phone number is already registered.'); await done(); showToast('Employee updated'); });
    if (a === 'resetEmp') { if (!confirm(`Reset the password of ${emp.name}? They will be asked to create a new one at their next sign-in.`)) return; await rpc('admin_reset_password', { p_account: emp.id }); await done(); return showToast('Password reset'); }
    if (a === 'toggleEmp') { const was = emp.active; await writeOk(await sbFetch(`accounts?id=eq.${emp.id}`, { method: 'PATCH', body: json({ active: !emp.active }) })); await done(); return showToast(was ? 'Employee switched off' : 'Employee switched on'); }
  } catch (err) { showToast(err.message, true); }
});
$('#navBranches').addEventListener('click', async () => { brOpen = null; show('branches'); try { await loadBranchesPage(); } catch (err) { showToast(err.message, true); } });

// ================= start =================
async function boot() {
  renderForm();
  if (!SB) { showLogin('Supabase is not set up (see config.js).'); return; }
  let saved = null; try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) {}
  if (saved && saved.token) {
    session = saved;
    try { session = await rpc('auth_me'); localStorage.setItem(SESSION_KEY, JSON.stringify(session)); await enterApp(); return; }
    catch (e) { session = null; try { localStorage.removeItem(SESSION_KEY); } catch (x) {} }
  }
  showLogin();
}
boot();
