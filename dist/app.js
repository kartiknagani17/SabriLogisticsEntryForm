const $ = s => document.querySelector(s);
// today's date on this computer (toISOString would give the UTC date, i.e. yesterday between midnight and 5:30 am in India)
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- form definition: [key, label, type, placeholder, extra class] ----
const PAY = ['Paid', 'To Pay', 'To be Billed'];
const PKG = ['bag', 'bundle', 'box', 'carton', 'roll', 'parcel', 'homemade goods'];
const T = 'text', N = 'number';
const sections = [
  { title: 'Shipment details', fields: [
    ['gc', 'GC Number', T, 'e.g. 459403'], ['date', 'Date', 'date', ''], ['from', 'From', T, 'Origin city'], ['to', 'To', T, 'Destination city'],
    ['ewbNo', 'E-Way Bill No.', T, '12 digits (optional)'], ['invNo', 'Invoice No.', T, ''], ['invoiceValue', 'Invoice Value', N, 'Amount'], ['payType', 'Pay Type', 'select', '', '', PAY], ['privateMark', 'Private Mark', T, 'Optional'],
  ] },
  { title: 'Parties & cargo', fields: [
    ['consignor', 'Consignor', T, 'Name / company', 'w2'], ['consignee', 'Consignee', T, 'Name / company', 'w2'],
    ['consignorGst', 'Consignor GST No', T, '', 'w2'], ['consigneeGst', 'Consignee GST No', T, '', 'w2'],
    ['consignorPhone', 'Consignor WhatsApp No.', 'tel', '10 digits (optional)', 'w2'],
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
const branchOf = id => branches.find(b => b.id === (id === undefined ? curBranch() : id)) || {};
const branchAddr = id => (branchOf(id).address || '').trim();
const rd = (d, branchId) => ({ ...d, boAddress: branchAddr(branchId), bkgPh: branchOf(branchId).booking_ph || '', delPh: branchOf(branchId).delivery_ph || '', qty: d.quantity, bilty: d.bc, doorDel: d.doorDelivery, igst: String((parseFloat(d.sgst) || 0) + (parseFloat(d.cgst) || 0)), invValue: d.invoiceValue });

function fieldHTML([key, label, type, ph, cls, opts]) {
  const req = REQUIRED.includes(key) ? 'required' : '';
  const v = data[key] || '';
  if (type === 'select') {
    const o = (key === 'packageType' ? `<option value="" disabled ${v ? '' : 'selected'}>Select</option>` : '') +
      opts.map(x => `<option value="${esc(x)}" ${v === x ? 'selected' : ''}>${esc(key === 'packageType' ? x[0].toUpperCase() + x.slice(1) : x)}</option>`).join('');
    return `<div class="field ${cls || ''}"><label for="${key}">${label}</label><select id="${key}" name="${key}" ${req}>${o}</select></div>`;
  }
  if (key === 'ewbNo') return `<div class="field"><label for="ewbNo">${label}</label><div class="ewb-row"><input id="ewbNo" name="ewbNo" type="text" inputmode="numeric" maxlength="12" placeholder="${ph}" value="${esc(v)}"/><button type="button" class="btn-secondary mini" id="ewbGo">Submit</button></div></div>`;
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
// the admin's "Main Branch" view shows everything; anything the admin saves from it goes to the real Main Branch
const mainBranch = () => branches.find(b => /^main branch$/i.test((b.name || '').trim())) || branches.reduce((m, b) => !m || b.id < m.id ? b : m, null); // the first branch ever created, even if renamed
const needBranch = () => { const b = curBranch() || (isAdmin() && mainBranch() ? mainBranch().id : null); if (!b) throw new Error('Choose a branch in the left menu first.'); return b; };
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
// Lists are read a page at a time (newest first) and searches run in the database, so a screen
// downloads only what it shows, however many entries the branches build up over the years.
const PAGE = 100;
const SETUP_MSG = 'The database needs an update: run the 4 files in the supabase-scale folder, in order, in Supabase (SQL Editor).';
async function getJSON(path) { const x = await sbFetch(path); if (!x.ok) throw new Error(await x.text()); return x.json(); }
// one page of a list; `more` tells whether there is another page after it
async function getPage(path, offset) {
  const rows = await getJSON(`${path}&limit=${PAGE + 1}&offset=${offset || 0}`);
  return { rows: rows.slice(0, PAGE), more: rows.length > PAGE };
}
// PostgREST filter values: quoted so commas, brackets and dots in GC numbers or names are safe
const pq = v => '"' + String(v).replace(/["\\]/g, '\\$&') + '"';
const inList = vals => encodeURIComponent(`in.(${vals.map(pq).join(',')})`);
const likeAny = (cols, q) => { const v = pq('*' + String(q).trim() + '*'); return '&or=' + encodeURIComponent(`(${cols.map(c => `${c}.ilike.${v}`).join(',')})`); };
// form values are saved trimmed and without empty fields
const norm = d => { const o = {}; for (const [k, v] of Object.entries(d)) { if (k === 'printedAt') continue; const t = String(v ?? '').trim(); if (t !== '') o[k] = t; } return o; };
const isMissing = m => /PGRST20[25]|does not exist|404|Could not find the function/.test(m);
const PICK = 'id,branch_id,gc_no,entry_date,from_city,to_city,consignor,consignee,total,quantity:data->>quantity';
const store = {
  // a GC number can be used once per branch: the database refuses a second one (409)
  async save(d) {
    const branch = needBranch(), clean = { ...norm(d), printedAt: d.printedAt }, r = rd(clean);
    const row = { branch_id: branch, gc_no: clean.gc, entry_date: clean.date || null, from_city: clean.from, to_city: clean.to, consignor: clean.consignor, consignee: clean.consignee, total: chargeTotal(r), data: clean };
    const x = await sbFetch('entries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    if (x.status === 409) throw new Error('DUPLICATE'); if (!x.ok) throw new Error(await x.text());
  },
  // dashboard list: filtered, sorted and paged in the database
  async page({ q, pay, sort, offset }) {
    try { return await rpc('entries_page', { p_branch: curBranch() || null, p_q: q || null, p_pay: pay || null, p_sort: sort || null, p_limit: PAGE, p_offset: offset || 0 }); }
    catch (e) { throw new Error(isMissing(e.message) ? SETUP_MSG : e.message); }
  },
  // newest GCs of a branch, optionally narrowed by a search (GC number, parties or cities); light columns only
  search(branch, q, limit, cols) {
    return getJSON(`entries?select=${cols || PICK}&order=created_at.desc&limit=${limit}${bq(branch)}${q ? likeAny(['gc_no', 'consignor', 'consignee', 'from_city', 'to_city'], q) : ''}`);
  },
  // the entries with these GC numbers (branch = null: any branch the user can see)
  async byGcs(branch, gcs, cols) {
    const out = [], u = [...new Set(gcs.map(String))];
    for (let i = 0; i < u.length; i += 150) out.push(...await getJSON(`entries?select=${cols || '*'}${branch ? `&branch_id=eq.${branch}` : ''}&gc_no=${inList(u.slice(i, i + 150))}`));
    return out;
  },
  async full(id) { const r = await getJSON(`entries?select=data&id=eq.${id}`); if (!r.length) throw new Error('This GC is no longer saved.'); return r[0].data; },
  async byIds(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 150) out.push(...await getJSON(`entries?select=*&id=${inList(ids.slice(i, i + 150))}`));
    return out;
  },
};
// changes only the pay type, inside the database
store.setPayType = async function (e, payType) {
  try { await rpc('set_pay_type', { p_id: e.id, p_pay: payType }); } catch (err) { throw new Error(isMissing(err.message) ? SETUP_MSG : err.message); }
  e.pay_type = payType;
};
// generic "one table of saved rows" store (inward receipts, delivery slips)
const tableStore = (table, missingMsg, cols = '*') => ({
  missing: m => /PGRST205|does not exist|404/.test(m) ? missingMsg : m,
  async page(offset) { try { return await getPage(`${table}?select=${cols}&order=created_at.desc${bq()}`, offset); } catch (e) { throw new Error(this.missing(e.message)); } },
  async add(rows) {
    const branch = needBranch();
    const x = await sbFetch(table, { method: 'POST', body: JSON.stringify(rows.map(r => ({ ...r, branch_id: branch }))) }); if (!x.ok) throw new Error(this.missing(await x.text()));
  },
});
const inwardStore = tableStore('inwards', 'The inwards table is missing in Supabase. Run supabase.sql and supabase-branches.sql once.');
const slipStore = tableStore('delivery_slips', 'The delivery_slips table is missing in Supabase. Run supabase.sql and supabase-branches.sql once.', 'id,branch_id,slip_no,slip_date,gc_numbers,total,created_at');
// numbers are sequential, so the highest of the latest few is the highest of all
const nextNo = (list, key, prefix) => prefix + String(list.reduce((m, l) => Math.max(m, parseInt(String(l[key] || '').replace(/\D/g, '')) || 0), 0) + 1).padStart(3, '0');
slipStore.nextNo = async () => nextNo(await getJSON(`delivery_slips?select=slip_no&order=id.desc&limit=50${bq(needBranch())}`), 'slip_no', 'DS');
const lrStore = {
  missing: m => /PGRST205|does not exist|404/.test(m) ? 'The lrs table is missing in Supabase. Run supabase.sql and supabase-branches.sql once.' : m,
  async save(lr) {
    const row = { branch_id: needBranch(), memo_no: lr.memoNo, lr_date: lr.date || null, gc_numbers: lr.rows.map(r => r.lr), data: lr };
    const x = await sbFetch('lrs', { method: 'POST', body: JSON.stringify(row) }); if (!x.ok) throw new Error(this.missing(await x.text()));
  },
  // the list shows a few columns; the full LR (all its rows) is read when it is opened
  async page(offset) { try { return await getPage(`lrs?select=id,branch_id,memo_no,lr_date,created_at,gc_numbers,from:data->>from,to:data->>to,truckNo:data->>truckNo&order=created_at.desc${bq()}`, offset); } catch (e) { throw new Error(this.missing(e.message)); } },
  async full(id) { return (await getJSON(`lrs?select=data&id=eq.${id}`))[0].data; },
  async nextMemo() { try { return nextNo(await getJSON(`lrs?select=memo_no&order=id.desc&limit=50${bq(needBranch())}`), 'memo_no', 'SL'); } catch (e) { throw new Error(this.missing(e.message)); } },
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
const receiptPagesFn = (d, branchId) => async inline => [receiptSVG(rd(d, branchId), inline ? await inlineImgs() : undefined)];
// LR rows always show the GC's current pay type and total (so an Inward pay-type change and older LRs are reflected)
async function liveLR(lr, branch) {
  let list = []; try { list = await store.byGcs(branch, (lr.rows || []).map(r => r.lr), 'gc_no,total,pay:data->>payType'); } catch (e) {}
  const by = new Map(list.map(e => [String(e.gc_no), e]));
  const bo = branchOf(branch); return { ...lr, branchPhone: (bo.booking_ph || bo.delivery_ph || '').trim(), rows: (lr.rows || []).map(r => { const e = by.get(String(r.lr)); return e ? { ...r, pay: e.pay || r.pay, total: e.total } : r; }) };
}
const lrPagesFn = (lr, branch) => async inline => lrPages(await liveLR(lr, branch), inline ? await inlineImgs() : undefined);

// ---- form events ----
document.addEventListener('input', e => {
  if (e.target.matches('#fields input, #fields select')) {
    data[e.target.name] = e.target.value; $('#totalOut').textContent = fmt(chargeTotal(rd(data)));
    if (savedEntry) showFinish(); // editing after a save means a new entry: bring the Finish button back
  }
});
// E-way bill: fetch the details for the typed number and fill every mapped field (user can still edit)
async function fetchEwb() {
  const no = String(data.ewbNo || '').replace(/\D/g, '');
  if (no.length !== 12) return showToast('Enter the 12-digit e-way bill number first.', true);
  const b = $('#ewbGo'); b.disabled = true; b.textContent = '…';
  try {
    const x = await fetch(window.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/fetch-ewaybill', { method: 'POST', headers: { apikey: window.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + window.SUPABASE_ANON_KEY, 'Content-Type': 'application/json', 'x-session-token': session.token }, body: JSON.stringify({ ewbNo: no }) });
    const j = await x.json().catch(() => ({})); if (!x.ok) throw new Error(j.error || 'Request failed');
    const f = j.fields || {}; let n = 0;
    for (const k of Object.keys(f)) if (f[k] !== undefined && f[k] !== null && String(f[k]).trim() !== '') { data[k] = String(f[k]); n++; }
    data.ewbNo = no; renderForm(); if (savedEntry) showFinish();
    showToast(n ? 'E-way bill details filled in — please check them.' : 'No details came back for this number.', !n);
  } catch (e) { showToast('E-way bill: ' + e.message, true); const g = $('#ewbGo'); if (g) { g.disabled = false; g.textContent = 'Submit'; } }
}
document.addEventListener('click', e => { if (e.target.id === 'ewbGo') fetchEwb(); });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'ewbNo') { e.preventDefault(); fetchEwb(); } });
// After a successful save the Finish button is replaced by View / Download PDF / Print for that entry.
let savedEntry = null;
function showFinish() { savedEntry = null; $('#doneBtns').classList.add('hidden'); const b = $('#nextBtn'); b.classList.remove('hidden', 'working'); b.disabled = false; b.textContent = 'Finish entry'; }
$('#entryForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#nextBtn'); btn.disabled = true; btn.classList.add('working'); btn.textContent = 'Saving…';
  try {
    data.printedAt = nowStamp(); await store.save(data);
    savedEntry = { ...data };
    btn.classList.add('hidden'); $('#doneBtns').classList.remove('hidden');
    showToast('Entry saved');
    if (normPhone(savedEntry.consignorPhone).length === 10) sendWhatsApp(savedEntry, true);
  } catch (err) {
    err.message === 'DUPLICATE' ? showToast(`GC number ${String(data.gc || '').trim()} is already saved in this branch — it was not saved again.`, true) : showToast('Save failed: ' + err.message, true);
    showFinish();
  }
});
$('#doneView').addEventListener('click', () => showDoc('GC ' + savedEntry.gc, 'Saved receipt.', receiptPagesFn(savedEntry), `GC-${savedEntry.gc}`));
$('#donePdf').addEventListener('click', () => receiptPDF(rd(savedEntry), `GC-${savedEntry.gc}.pdf`).catch(e => showToast(e.message, true)));
// Send the GC PDF to the consignor's WhatsApp. Goes through the Cloudflare Worker when config.js sets WHATSAPP_URL
// (free, and keeps the PDFs out of Supabase's 5 GB monthly egress); otherwise through the Supabase edge function.
const waURL = () => (window.WHATSAPP_URL || '').trim() || window.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/send-whatsapp';
async function sendWhatsApp(d, auto) {
  const b = $('#doneWa'); if (b) { b.disabled = true; b.textContent = 'Sending…'; }
  try {
    const x = await fetch(waURL(), { method: 'POST', headers: { apikey: window.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + window.SUPABASE_ANON_KEY, 'Content-Type': 'application/json', 'x-session-token': session.token },
      body: JSON.stringify({ phone: d.consignorPhone, pdf: await receiptPdfBase64(rd(d)), gc: d.gc, consignor: d.consignor, from: d.from, to: d.to }) });
    const j = await x.json().catch(() => ({})); if (!x.ok) throw new Error(j.error || 'Request failed');
    showToast('GC sent to consignor on WhatsApp');
  } catch (e) { showToast((auto ? 'Saved, but WhatsApp failed: ' : 'WhatsApp failed: ') + e.message, true); }
  if (b) { b.disabled = false; b.textContent = 'Send on WhatsApp'; }
}
$('#doneWa').addEventListener('click', () => {
  if (normPhone(savedEntry.consignorPhone).length !== 10) return showToast('Add a 10-digit consignor WhatsApp number to the entry first.', true);
  sendWhatsApp(savedEntry, false);
});
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
let entTotal = 0, lrMore = false, inMore = false, slipMore = false;
const actions = `<button type="button" class="btn-secondary mini" data-a="view">View</button> <button type="button" class="btn-secondary mini" data-a="pdf">PDF</button> <button type="button" class="btn-secondary mini" data-a="print">Print</button>`;
const moreRow = (more, cols) => more ? `<tr class="more-row"><td colspan="${cols}"><button type="button" class="btn-secondary mini" data-more="1">Show more</button></td></tr>` : '';
// a later request replaces an earlier one still on its way (fast typing in the search box)
let entSeq = 0;
async function loadEntries(append) {
  const my = ++entSeq;
  const res = await store.page({ q: $('#gcSearch').value.trim(), pay: $('#gcPay').value, sort: $('#gcSort').value, offset: append ? entries.length : 0 });
  if (my !== entSeq) return;
  entries = append ? entries.concat(res.rows) : res.rows; entTotal = res.total;
  renderEntries();
}
let viewList = [];
function renderEntries() {
  viewList = entries;
  const filtered = $('#gcSearch').value.trim() || $('#gcPay').value;
  $('#gcCount').textContent = `${entries.length < entTotal ? `Showing ${entries.length.toLocaleString('en-IN')} of ` : ''}${entTotal.toLocaleString('en-IN')} ${filtered ? 'matching ' : ''}entries`;
  $('#rows').innerHTML = (viewList.length ? viewList.map((e, i) => `<tr class="row" data-i="${i}"><td class="adm">${esc(bname(e.branch_id))}</td><td>${esc(e.gc_no)}</td><td>${esc(e.entry_date)}</td><td>${esc(e.from_city)}</td><td>${esc(e.to_city)}</td><td>${esc(e.consignor)}</td><td>${esc(e.consignee)}</td><td>${esc(e.pay_type)}</td><td>${fmt(e.total)}</td><td>${new Date(e.created_at).toLocaleString('en-IN')}</td><td>${actions}</td></tr>`).join('') : `<tr><td colspan="11">${filtered ? 'No matching entries.' : 'No entries yet.'}</td></tr>`) + moreRow(entries.length < entTotal, 11);
}
async function loadLRs(append) {
  const res = await lrStore.page(append ? lrs.length : 0);
  lrs = append ? lrs.concat(res.rows) : res.rows; lrMore = res.more;
  $('#lrRows').innerHTML = (lrs.length ? lrs.map((l, i) => `<tr class="row" data-i="${i}"><td class="adm">${esc(bname(l.branch_id))}</td><td>${esc(l.memo_no)}</td><td>${esc(dmy(l.lr_date))}</td><td title="${esc(l.from)}">${esc(cities3(l.from))}</td><td title="${esc(l.to)}">${esc(cities3(l.to))}</td><td>${(l.gc_numbers || []).length}</td><td>${esc(l.truckNo)}</td><td>${new Date(l.created_at).toLocaleString('en-IN')}</td><td>${actions}</td></tr>`).join('') : '<tr><td colspan="9">No reports yet. Use Create New LR.</td></tr>') + moreRow(lrMore, 9);
}
function setTab(t) {
  tab = t;
  [['entries', 'Entries', 'paneEntries'], ['lr', 'LR', 'paneLR'], ['in', 'In', 'paneIn'], ['slip', 'Slip', 'paneSlip'], ['acc', 'Acc', 'paneAcc']].forEach(([k, n, pane]) => { $('#tab' + n).classList.toggle('active', t === k); $('#' + pane).classList.toggle('hidden', t !== k); });
  $('#dashHint').textContent = { entries: 'All GC entries saved so far. Click a row to view it.', lr: 'All lorry receipts created so far, one row each.', in: 'GCs received at this office. Pay type can be changed per row.', slip: 'Delivery slips created so far.', acc: 'Money totals for the selected branch (or all branches). Narrow it with dates if you like.' }[t];
}
async function loadDash() { try { await { entries: loadEntries, lr: loadLRs, in: loadInward, slip: loadSlips, acc: loadAcc }[tab](); } catch (err) { showToast(err.message, true); } }
$('#navDash').addEventListener('click', () => { show('dash'); $('#mode').textContent = scopeLabel(); loadDash(); });
$('#tabEntries').addEventListener('click', () => { setTab('entries'); loadDash(); });
$('#tabLR').addEventListener('click', () => { setTab('lr'); loadDash(); });
$('#tabIn').addEventListener('click', () => { setTab('in'); loadDash(); });
$('#tabSlip').addEventListener('click', () => { setTab('slip'); loadDash(); });
$('#tabAcc').addEventListener('click', () => { setTab('acc'); loadDash(); });

// ---- ACCOUNTING: totals for the branch in view (admin: all branches or the one picked; employee: own branch) ----
// the database adds up the totals per branch; only those few numbers come back
let accRows = [], accSeq = 0;
async function loadAcc() {
  const my = ++accSeq;
  if (isAdmin()) loadWallet();
  let rows; try { rows = await rpc('acc_totals', { p_branch: curBranch() || null, p_from: $('#accFrom').value || null, p_to: $('#accTo').value || null }); }
  catch (e) { throw new Error(isMissing(e.message) ? SETUP_MSG : e.message); }
  if (my !== accSeq) return;
  accRows = rows || []; renderAcc();
}
function renderAcc() {
  const from = $('#accFrom').value, to = $('#accTo').value, n = v => parseFloat(v) || 0, rs = v => '\u20B9 ' + fmt(v);
  const sumE = list => {
    const t = { count: 0, total: 0, freight: 0, bc: 0, door: 0, handling: 0, other: 0, tax: 0, pay: { 'Paid': 0, 'To Pay': 0, 'To be Billed': 0 }, slips: 0, slipTotal: 0, recv: 0, recvValue: 0, missing: 0 };
    list.forEach(r => { t.count += n(r.n); t.total += n(r.total); t.freight += n(r.freight); t.bc += n(r.bc); t.door += n(r.door); t.handling += n(r.handling); t.other += n(r.other); t.tax += n(r.tax);
      t.pay['Paid'] += n(r.paid); t.pay['To Pay'] += n(r.topay); t.pay['To be Billed'] += n(r.billed); t.slips += n(r.slips); t.slipTotal += n(r.slipTotal); t.recv += n(r.recv); t.recvValue += n(r.recvValue); t.missing += n(r.missing); });
    return t;
  };
  const t = sumE(accRows), slipTotal = t.slipTotal, grand = t.total + slipTotal, recvValue = t.recvValue;
  const S = { length: t.slips }, W = { length: t.recv };
  $('#accScope').textContent = scopeLabel() + (from || to ? ' \u00B7 ' + (from || '\u2026') + ' to ' + (to || '\u2026') : '');
  const card = (l, v, big) => `<div class="acc-card ${big ? 'big' : ''}"><small>${l}</small><b>${v}</b></div>`;
  const row = (l, v) => `<tr><td>${l}</td><td class="num">${rs(v)}</td></tr>`;
  let html = `<div class="acc-cards">${card('Grand total', rs(grand), true)}${card('GC charges total', rs(t.total))}${card('Delivery slip charges', rs(slipTotal))}${card('GC entries', t.count)}${card('Delivery slips', S.length)}${card('GCs received', W.length + ' \u00B7 ' + rs(recvValue))}${card('Parcels missing', t.missing)}</div>
    <div class="acc-grid"><div class="card dash" style="padding:18px"><h3>By pay type</h3><table><tbody>${Object.entries(t.pay).map(([k, v]) => row(esc(k), v)).join('')}<tr class="tot"><td>Total</td><td class="num">${rs(t.total)}</td></tr></tbody></table></div>
    <div class="card dash" style="padding:18px"><h3>GC charges breakdown</h3><table><tbody>${row('Freight', t.freight)}${row('BC', t.bc)}${row('Door delivery', t.door)}${row('Handling', t.handling)}${row('Other', t.other)}${row('SGST + CGST', t.tax)}<tr class="tot"><td>Total</td><td class="num">${rs(t.total)}</td></tr></tbody></table></div></div>`;
  if (isAdmin() && !scopeBranch) {
    const ids = [...new Set([...branches.map(b => b.id), ...accRows.map(r => r.branch_id)])];
    html += `<h3 class="acc-h">By branch</h3><div class="card dash" style="padding:20px;overflow-x:auto"><table><thead><tr><th>Branch</th><th class="num">GCs</th><th class="num">GC charges</th><th class="num">Slips</th><th class="num">Slip charges</th><th class="num">Total</th></tr></thead><tbody>${ids.map(id => { const bt = sumE(accRows.filter(r => r.branch_id === id)); return `<tr><td><b>${esc(bname(id))}</b></td><td class="num">${bt.count}</td><td class="num">${fmt(bt.total)}</td><td class="num">${bt.slips}</td><td class="num">${fmt(bt.slipTotal)}</td><td class="num"><b>${fmt(bt.total + bt.slipTotal)}</b></td></tr>`; }).join('')}<tr class="tot"><td>All branches</td><td class="num">${t.count}</td><td class="num">${fmt(t.total)}</td><td class="num">${S.length}</td><td class="num">${fmt(slipTotal)}</td><td class="num">${fmt(grand)}</td></tr></tbody></table></div>`;
  }
  $('#accBody').innerHTML = html;
}
const accReload = () => loadAcc().catch(err => showToast(err.message, true));
$('#accFrom').addEventListener('change', accReload); $('#accTo').addEventListener('change', accReload);
$('#accClear').addEventListener('click', () => { $('#accFrom').value = ''; $('#accTo').value = ''; accReload(); });
// ---- WHATSAPP BALANCE (admin): money added to the Meta WhatsApp account minus what Meta reports as spent since then ----
// Meta has no "balance" API, so each top-up is recorded here (Add funds) and the WhatsApp sender asks Meta for the spend.
const waPost = async body => {
  const x = await fetch(waURL(), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': session.token }, body: JSON.stringify(body) });
  const j = await x.json().catch(() => ({})); if (!x.ok) throw new Error(j.error || 'Request failed'); return j;
};
const LOW_BAL = 200; // rupees: below this the box turns red
async function loadWallet() {
  const box = $('#waWallet'); if (!isAdmin()) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="card wallet"><div><small>WhatsApp (Meta) balance</small><b>Checking…</b></div></div>';
  let w; try { w = await waPost({ action: 'usage' }); } catch (e) { w = { error: e.message }; }
  // "out of funds": Meta reported a payment failure after the last time funds were recorded here
  let dry = false; try { const [al, tp] = await Promise.all([getJSON('wa_alerts?select=created_at&order=created_at.desc&limit=1'), getJSON('wa_topups?select=created_at&order=created_at.desc&limit=1')]); dry = !!al.length && (!tp.length || new Date(al[0].created_at) > new Date(tp[0].created_at)); } catch (e) {}
  const cur = !w.currency || w.currency === 'INR' ? '₹ ' : w.currency + ' ', money = v => cur + fmt(v);
  const low = dry || (w.balance != null && w.balance < LOW_BAL);
  box.innerHTML = `${dry ? '<div class="wl-dry">&#9888; WhatsApp is out of funds: Meta could not send a message. Add money in Meta (WhatsApp Manager &rarr; Billing), then press Add funds here.</div>' : ''}<div class="card wallet ${low ? 'low' : ''}">
    <div><small>WhatsApp (Meta) balance</small><b>${w.error ? '—' : w.balance == null ? 'No funds recorded' : money(w.balance)}</b>${low ? '<span class="chip-st off">Running low — add funds</span>' : ''}</div>
    <div class="wl-stats">${w.error ? `<span class="wl-err">${esc(w.error)}</span>` : `<span>Spent this month <b>${money(w.spentMonth || 0)}</b></span><span>Messages this month <b>${(w.sentMonth || 0).toLocaleString('en-IN')}</b></span><span>Remaining <b${low ? ' class="miss"' : ''}>${w.balance == null ? '—' : money(w.balance)}</b></span>`}</div>
    <div class="keep-act"><button type="button" class="btn-secondary mini" id="waRefresh">Refresh</button><button type="button" class="btn-primary mini" id="waAdd">Add funds</button></div></div>
    <p class="wl-note">After adding money in Meta (WhatsApp Manager → Billing), record the same amount here with <b>Add funds</b>. Meta updates the spend every few hours.</p>`;
  $('#waRefresh').onclick = loadWallet;
  $('#waAdd').onclick = () => formModal('Add funds', 'Record money added to the Meta WhatsApp account, so the balance stays right.', [{ k: 'amount', label: 'Amount (₹) *', mode: 'decimal' }, { k: 'note', label: 'Note (optional)', ph: 'e.g. UPI 19 Nov' }],
    async v => { const amt = parseFloat(v.amount); if (!(amt > 0)) throw new Error('Enter the amount added.'); await writeOk(await sbFetch('wa_topups', { method: 'POST', body: json({ amount: amt, note: v.note || null }) })); showToast('Funds recorded'); loadWallet(); }, 'Save');
}
// ---- MONTHLY DOWNLOAD: everything saved in one month (India time), as an Excel file with one sheet per record type.
// Records are deleted after 60 days, so this file is the long-term copy. ----
const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', XLSX_SRI = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
const loadScript = src => new Promise((res, rej) => {
  if (window.XLSX) return res();
  const s = document.createElement('script'); s.src = src; s.integrity = XLSX_SRI; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('Could not load the Excel maker. Check the internet connection.')); document.head.appendChild(s);
});
const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return ym(d); };
const nextMonth = m => { const [y, mo] = m.split('-').map(Number); return ym(new Date(y, mo, 1)); };
// every row of a table saved in [from, to): 1000 at a time, in id order
async function monthRows(table, cols, from, to, onPage) {
  const out = []; let last = 0;
  for (;;) {
    const part = await getJSON(`${table}?select=${cols}&created_at=gte.${encodeURIComponent(from)}&created_at=lt.${encodeURIComponent(to)}&id=gt.${last}&order=id&limit=1000${bq()}`);
    out.push(...part); onPage(out.length);
    if (part.length < 1000) return out;
    last = part[part.length - 1].id;
  }
}
const when = t => t ? new Date(t).toLocaleString('en-IN') : '';
const asNum = v => { const n = parseFloat(v); return v !== '' && v != null && isFinite(n) && String(v).trim() === String(n) ? n : (v ?? ''); };
async function downloadMonth() {
  const m = $('#expMonth').value; if (!m) return showToast('Pick a month first.', true);
  const b = $('#expBtn'), from = `${m}-01T00:00:00+05:30`, to = `${nextMonth(m)}-01T00:00:00+05:30`;
  const say = t => { b.textContent = t; };
  b.disabled = true;
  try {
    say('Loading…'); await loadScript(XLSX_SRC);
    const ents = await monthRows('entries', 'id,branch_id,gc_no,created_at,total,data', from, to, n => say(`Reading GCs… ${n.toLocaleString('en-IN')}`));
    const lrsM = await monthRows('lrs', 'id,branch_id,memo_no,lr_date,created_at,data', from, to, n => say(`Reading LRs… ${n.toLocaleString('en-IN')}`));
    const inw = await monthRows('inwards', 'id,branch_id,gc_no,created_at', from, to, n => say(`Reading inward… ${n.toLocaleString('en-IN')}`));
    const sl = await monthRows('delivery_slips', 'id,branch_id,slip_no,slip_date,created_at,data', from, to, n => say(`Reading slips… ${n.toLocaleString('en-IN')}`));
    say('Making the Excel file…'); await new Promise(r => setTimeout(r, 30));
    const fields = sections.flatMap(s => s.fields), known = new Set(fields.map(f => f[0]));
    const extra = [...new Set(ents.flatMap(e => Object.keys(e.data || {})))].filter(k => !known.has(k) && k !== 'printedAt');
    const gcSheet = [['Branch', 'Saved at', ...fields.map(f => f[1]), ...extra, 'Total', 'Printed at'],
      ...ents.map(e => { const d = e.data || {}; return [bname(e.branch_id), when(e.created_at), ...fields.map(f => f[2] === N ? asNum(d[f[0]]) : (d[f[0]] ?? '')), ...extra.map(k => d[k] ?? ''), asNum(e.total), d.printedAt || '']; })];
    const lrSheet = [['Branch', 'Memo No', 'LR Date', 'Saved at', 'From', 'To', 'Truck No', 'Driver', 'GC No', 'Destination', 'Consignor', 'Consignee', 'Articles', 'Contains', 'Weight', 'Pay Type', 'Amount', 'PM No'],
      ...lrsM.flatMap(l => { const d = l.data || {}, head = [bname(l.branch_id), l.memo_no, dmy(l.lr_date), when(l.created_at), d.from || '', d.to || '', d.truckNo || '', d.driverName || ''];
        return (d.rows && d.rows.length ? d.rows : [{}]).map(r => [...head, r.lr ?? '', r.dest ?? '', r.consignor ?? '', r.consignee ?? '', asNum(r.articles), r.contains ?? '', asNum(r.weight), r.pay ?? '', asNum(r.total), r.pm ?? '']); })];
    const inSheet = [['Branch', 'GC No', 'Received at'], ...inw.map(w => [bname(w.branch_id), w.gc_no, when(w.created_at)])];
    const slSheet = [['Branch', 'Slip No', 'Slip Date', 'Saved at', 'GC No', 'Units', 'Door Delivery', 'Other', 'Total'],
      ...sl.flatMap(s => (Array.isArray(s.data) && s.data.length ? s.data : [{}]).map(r => [bname(s.branch_id), s.slip_no, dmy(s.slip_date), when(s.created_at), r.gc ?? '', asNum(r.units), asNum(r.door), asNum(r.other), asNum(r.total)]))];
    const wb = XLSX.utils.book_new();
    [['GC entries', gcSheet], ['LR', lrSheet], ['Inward', inSheet], ['Delivery slips', slSheet]].forEach(([n, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n));
    XLSX.writeFile(wb, `Sabri Logistics ${scopeLabel().replace(/[^\w -]/g, '')} ${m}.xlsx`);
    showToast(`Downloaded ${m}: ${ents.length} GCs, ${lrsM.length} LRs, ${inw.length} inward, ${sl.length} slips`);
  } catch (err) { showToast('Download failed: ' + err.message, true); }
  b.disabled = false; b.textContent = 'Download month (Excel)';
}
$('#expMonth').value = prevMonth();
$('#expBtn').addEventListener('click', downloadMonth);
// "Show more" under a list reads its next page
const moreBtn = (sel, load) => $(sel).addEventListener('click', async e => {
  const b = e.target.closest('[data-more]'); if (!b) return;
  b.disabled = true; b.textContent = 'Loading…';
  try { await load(true); } catch (err) { showToast(err.message, true); b.disabled = false; b.textContent = 'Show more'; }
});
moreBtn('#rows', loadEntries); moreBtn('#lrRows', loadLRs); moreBtn('#inRows', p => loadInward(p)); moreBtn('#slipRows', p => loadSlips(p));
$('#rows').addEventListener('click', async e => {
  const tr = e.target.closest('tr.row'); if (!tr) return; const row = viewList[tr.dataset.i], a = e.target.dataset.a;
  // the list holds only its columns: the full GC is read now, for this one entry
  let d; try { d = await store.full(row.id); } catch (err) { return showToast(err.message, true); }
  if (a === 'pdf') return receiptPDF(rd(d, row.branch_id), `GC-${row.gc_no}.pdf`);
  if (a === 'print') return receiptPrint(rd(d, row.branch_id));
  showDoc('GC ' + row.gc_no, 'Saved receipt.', receiptPagesFn(d, row.branch_id), `GC-${row.gc_no}`);
});

// ---- LR (lorry receipt) ----
// Picker built for hundreds of GCs: checkbox list, search, Shift-click ranges, select-all-shown, selected-only filter.
// It lists the branch's newest GCs; typing searches all of the branch's GCs in the database.
// Only a few columns are read for the list; the full entries are read for the GCs actually picked.
const CAP = 500, PICK_LR = 'id,gc_no,entry_date,from_city,to_city,consignor,consignee';
async function openCreateLR() {
  let lrBranch; try { lrBranch = needBranch(); } catch (err) { showToast(err.message, true); return; }
  lrBox.innerHTML = '<h3>Create new LR</h3><p class="sub">Loading your GC entries…</p><div class="pk-note">Loading…</div>';
  openModal(true);
  let memoNo, recent;
  try { [recent, memoNo] = await Promise.all([store.search(lrBranch, '', CAP, PICK_LR), lrStore.nextMemo()]); }
  catch (err) { closeModal(); showToast(err.message, true); return; }
  const today = todayLocal();
  const byId = new Map();      // every GC seen in this window, by entry id
  const remember = list => list.map(e => { byId.set(e.id, e); return e.id; });
  const recentIds = remember(recent);
  const order = [];            // entry ids in the order they were selected (= row order on the sheet)
  const sel = new Set();
  let shown = [], last = -1, found = recentIds, seq = 0, timer;   // listed ids, last clicked position in `shown`, ids from the latest search
  lrBox.innerHTML = `<h3>Create new LR</h3><p class="sub">Memo No. ${esc(memoNo)}. Tick the GC numbers to include. Shift-click selects a range. Every ${LR_ROWS} GCs make one page.</p>
    <div class="pk-bar"><input type="text" id="lrSearch" placeholder="Search GC number, consignor, consignee or city" autocomplete="off">
      <button type="button" class="btn-secondary mini" id="pkAll">Select all shown</button><button type="button" class="btn-secondary mini" id="pkNone">Clear</button>
      <label class="pk-only"><input type="checkbox" id="pkOnly"> Selected only</label></div>
    <div class="pk-list" id="pkList"></div>
    <div class="pk-status" id="pkStatus"></div>
    <div class="fields"><div class="field"><label for="lrDate">Date</label><input id="lrDate" type="date" value="${today}"></div><div class="field"><label for="lrTruck">Truck No. (optional)</label><input id="lrTruck"></div>
    <div class="field"><label for="lrDriver">Driver Name (optional)</label><input id="lrDriver"></div></div>
    <div class="modal-actions sticky"><span class="pk-count" id="pkCount"></span><button type="button" class="btn-secondary" id="lrCancel">Cancel</button><button type="button" class="btn-primary" id="lrCreate">Create LR</button></div>`;
  openModal(true);
  const list = $('#pkList'), search = $('#lrSearch');
  const line = id => { const e = byId.get(id); return `<div class="pk-row" data-i="${id}"><input type="checkbox" tabindex="-1"><span class="g">${esc(e.gc_no)}</span><span>${esc(e.from_city)} &rarr; ${esc(e.to_city)}</span><span>${esc(e.consignor)}</span><span>${esc(e.consignee)}</span><span class="d">${esc(dmy(e.entry_date))}</span></div>`; };
  function status() {
    const n = order.length, pages = Math.max(1, Math.ceil(n / LR_ROWS));
    $('#pkStatus').textContent = `${n} selected${n ? ` · ${pages} page${pages > 1 ? 's' : ''}` : ''}`;
    $('#pkCount').textContent = n ? `${n} GC${n > 1 ? 's' : ''}` : '';
  }
  function paint() { list.querySelectorAll('.pk-row[data-i]').forEach(r => { const on = sel.has(+r.dataset.i); r.classList.toggle('on', on); r.firstChild.checked = on; }); status(); }
  function render() {
    const q = search.value.trim().toLowerCase(), only = $('#pkOnly').checked;
    const all = only ? order.filter(id => { const e = byId.get(id); return !q || [e.gc_no, e.consignor, e.consignee, e.from_city, e.to_city].some(v => String(v || '').toLowerCase().includes(q)); }) : found;
    shown = all.slice(0, CAP); last = -1;
    const note = !only && found.length >= CAP ? `<div class="pk-note">Showing the newest ${CAP}${q ? ' matches' : ' GCs'}. ${q ? 'Type more of the number or name to narrow it down.' : 'Search to find older GCs.'}</div>` : '';
    list.innerHTML = shown.length
      ? `<div class="pk-row pk-head"><span></span><span>GC No</span><span>Route</span><span>Consignor</span><span>Consignee</span><span>Date</span></div>` + shown.map(line).join('') + note
      : `<div class="pk-note">${q || only ? 'No matching GC numbers' : 'No entries saved yet'}</div>`;
    paint();
  }
  // typing searches the database (after a short pause); an empty box lists the newest GCs again
  function onSearch() {
    clearTimeout(timer);
    if ($('#pkOnly').checked) return render();
    const q = search.value.trim();
    if (!q) { seq++; found = recentIds; return render(); }
    timer = setTimeout(async () => {
      const my = ++seq; list.innerHTML = '<div class="pk-note">Searching…</div>';
      try { const r = await store.search(lrBranch, q, CAP, PICK_LR); if (my !== seq) return; found = remember(r); render(); }
      catch (err) { if (my === seq) list.innerHTML = `<div class="pk-note">${esc(err.message)}</div>`; }
    }, 300);
  }
  function setSel(i, on) { if (on && !sel.has(i)) { sel.add(i); order.push(i); } else if (!on && sel.has(i)) { sel.delete(i); order.splice(order.indexOf(i), 1); } }
  list.addEventListener('click', e => {
    const row = e.target.closest('.pk-row[data-i]'); if (!row) return;
    const i = +row.dataset.i, pos = shown.indexOf(i), on = !sel.has(i);
    if (e.shiftKey && last >= 0) { const [a, b] = pos > last ? [last, pos] : [pos, last]; for (let k = a; k <= b; k++) setSel(shown[k], on); }
    else setSel(i, on);
    last = pos; paint();
  });
  search.addEventListener('input', onSearch);
  $('#pkOnly').addEventListener('change', onSearch);
  $('#pkAll').onclick = () => { shown.forEach(i => setSel(i, true)); paint(); };
  $('#pkNone').onclick = () => { sel.clear(); order.length = 0; render(); };
  $('#lrCancel').onclick = closeModal;
  $('#lrCreate').onclick = async () => {
    if (!order.length) { showToast('Pick at least one GC number', true); search.focus(); return; }
    const b = $('#lrCreate'); b.disabled = true; b.textContent = 'Creating…';
    try {
      const full = new Map((await store.byIds(order)).map(e => [e.id, e]));
      if (order.some(id => !full.has(id))) throw new Error('Some picked GCs could not be read. Please try again.');
      const lr = lrFromEntries(order.map(id => full.get(id)), { memoNo, date: $('#lrDate').value, truckNo: $('#lrTruck').value.trim(), driverName: $('#lrDriver').value.trim() });
      await lrStore.save(lr); await showDoc('LR ' + lr.memoNo + ' created', 'The stamp is left blank to be written by hand.', lrPagesFn(lr, lrBranch), `LR-${lr.memoNo}`); if (tab === 'lr') loadLRs().catch(() => {}); }
    catch (err) { showToast(err.message, true); b.disabled = false; b.textContent = 'Create LR'; }
  };
  render(); search.focus();
}
$('#newLRBtn').addEventListener('click', openCreateLR);
$('#lrRows').addEventListener('click', async e => {
  const tr = e.target.closest('tr.row'); if (!tr) return; const l = lrs[tr.dataset.i], a = e.target.dataset.a;
  try {
    const d = await lrStore.full(l.id);
    if (a === 'pdf') return await svgToPDF(lrPages(await liveLR(d, l.branch_id), await inlineImgs()), `LR-${l.memo_no}.pdf`);
    if (a === 'print') return svgPrint(lrPages(await liveLR(d, l.branch_id), await inlineImgs()), `LR ${l.memo_no}`);
    await showDoc('LR ' + l.memo_no, 'Saved lorry receipt.', lrPagesFn(d, l.branch_id), `LR-${l.memo_no}`);
  } catch (err) { showToast(err.message, true); }
});

// ---- shared: GC search box with a drop-down of matches ----
// find(q) searches the database and returns the matching entries (after a short pause in typing)
function gcSearchBox(input, dd, find, onPick) {
  let hits = [], seq = 0, timer;
  const draw = () => {
    clearTimeout(timer);
    const q = input.value.trim(); if (!q) { seq++; dd.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      let r; try { r = await find(q); } catch (err) { if (my === seq) dd.innerHTML = `<div class="none">${esc(err.message)}</div>`; return; }
      if (my !== seq) return;
      hits = r.slice(0, 30);
      dd.innerHTML = hits.length ? hits.map((e, i) => `<div data-h="${i}"><span><b>${esc(e.gc_no)}</b> <small>${esc(e.consignor)} &rarr; ${esc(e.consignee)}</small></span><small>${esc(e.from_city)} &rarr; ${esc(e.to_city)}</small></div>`).join('') : '<div class="none">No matching GC number</div>';
    }, 250);
  };
  input.addEventListener('input', draw); input.addEventListener('focus', draw);
  dd.addEventListener('click', ev => { const r = ev.target.closest('[data-h]'); if (!r) return; onPick(hits[+r.dataset.h]); input.value = ''; dd.innerHTML = ''; input.focus(); });
}
// GC entries behind the inward rows on screen, by branch + GC number
let inEntries = new Map();
const entryOf = (gc, branch) => inEntries.get(branch + '|' + gc);

// ---- INWARD ----
async function loadInward(append) {
  const res = await inwardStore.page(append ? inwards.length : 0);
  const ents = res.rows.length ? await store.byGcs(curBranch(), res.rows.map(w => w.gc_no), 'id,branch_id,gc_no,entry_date,from_city,to_city,consignor,consignee,total,pay_type:data->>payType') : [];
  if (!append) inEntries = new Map();
  ents.forEach(e => inEntries.set(e.branch_id + '|' + e.gc_no, e));
  inwards = append ? inwards.concat(res.rows) : res.rows; inMore = res.more;
  renderInward();
}
const qtyOf = e => parseInt(String((e && e.quantity) ?? '').replace(/\D/g, ''), 10) || 0;
function renderInward() {
  $('#inRows').innerHTML = inwards.length ? inwards.map((w, i) => {
    const e = entryOf(w.gc_no, w.branch_id) || {}, pay = e.pay_type || '', miss = +w.missing_qty || 0, qty = qtyOf(e);
    const st = `&#10003; Received<br><small style="color:var(--muted);font-weight:400">${new Date(w.created_at).toLocaleDateString('en-IN')}${qty ? ` &middot; ${Math.max(0, qty - miss)} of ${qty} parcels` : ''}</small>`;
    const mc = miss ? `<span class="miss">${miss}</span><br><button type="button" class="btn-secondary mini" data-found="${i}">Found</button>` : '<span style="color:var(--muted)">&ndash;</span>';
    return `<tr data-i="${i}" class="${miss ? 'is-missing' : ''}"><td class="adm">${esc(bname(w.branch_id))}</td><td>${esc(dmy(e.entry_date))}</td><td>${esc(e.from_city)}</td><td>${esc(e.to_city)}</td><td>${esc(e.consignor)}</td><td>${esc(e.consignee)}</td>
      <td><select class="pay-sel" data-orig="${esc(pay)}">${PAY.map(p => `<option ${p === pay ? 'selected' : ''}>${p}</option>`).join('')}</select><button type="button" class="btn-primary save-pay hidden">Save</button></td>
      <td>${e.total != null ? fmt(e.total) : ''}</td><td class="rcv">${st}</td><td>${mc}</td></tr>`;
  }).join('') + moreRow(inMore, 10) : '<tr><td colspan="10">Nothing received yet. Use RECEIVED to add GC numbers.</td></tr>';
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
$('#inRows').addEventListener('click', async e => {
  const b = e.target.closest('[data-found]'); if (!b) return;
  const w = inwards[+b.dataset.found]; b.disabled = true; b.textContent = 'Saving…';
  try {
    const x = await sbFetch(`inwards?id=eq.${w.id}`, { method: 'PATCH', body: JSON.stringify({ missing_qty: 0 }) });
    if (!x.ok) throw new Error(await x.text());
    showToast(`GC ${w.gc_no}: missing parcels cleared`); loadInward().catch(err => showToast(err.message, true));
  } catch (err) { showToast('Save failed: ' + err.message, true); b.disabled = false; b.textContent = 'Found'; }
});
async function openReceived() {
  let branch; try { branch = needBranch(); } catch (err) { showToast(err.message, true); return; }
  openModal(false);
  const chosen = [];
  // the branch's GCs matching the search that are not received / marked missing yet and not already picked
  const find = async q => {
    const hits = (await store.search(branch, q, 60)).filter(e => !chosen.some(c => c.gc === String(e.gc_no)));
    if (!hits.length) return hits;
    const have = new Set((await getJSON(`inwards?select=gc_no&branch_id=eq.${branch}&gc_no=${inList(hits.map(e => e.gc_no))}`)).map(w => String(w.gc_no)));
    return hits.filter(e => !have.has(String(e.gc_no)));
  };
  // chosen: [{ gc, who, qty, missing }] - every picked GC is saved as received; "missing" is an optional count of parcels that did not arrive
  lrBox.innerHTML = `<h3>Received</h3><p class="sub">Search a GC number and pick it from the list. If some parcels did not arrive, type how many in the <b>Missing</b> box (optional), then press SAVE.</p>
    <div class="picker"><input type="text" id="rcvSearch" placeholder="Search GC number, consignor or consignee" autocomplete="off"><div class="dd" id="rcvDd"></div></div>
    <div class="rcv-list" id="rcvChips"></div>
    <div class="modal-actions sticky"><span class="pk-count" id="rcvCount"></span><button type="button" class="btn-secondary" id="rcvCancel">Cancel</button><button type="button" class="btn-primary" id="rcvAdd">SAVE</button></div>`;
  const chips = $('#rcvChips');
  const recvOf = c => c.qty ? Math.max(0, c.qty - c.missing) : null;
  const drawChips = () => {
    chips.innerHTML = chosen.length ? chosen.map((c, i) => `<div class="rcv-item ${c.missing ? 'missing' : ''}"><b>${esc(c.gc)}</b><span class="rcv-who">${esc(c.who)}</span>
      <div class="rcv-qty"><span class="rcv-tot">${c.qty ? `Total ${c.qty}` : 'Total ?'}</span><span class="rcv-got" id="rcvGot${i}">${recvOf(c) != null ? `Received ${recvOf(c)}` : ''}</span></div>
      <label class="rcv-miss">Missing <input type="number" min="0"${c.qty ? ` max="${c.qty}"` : ''} inputmode="numeric" data-m="${i}" value="${c.missing || ''}" placeholder="0"></label>
      <button type="button" class="x" data-x="${i}" title="Remove">&times;</button></div>`).join('') : '';
    const m = chosen.reduce((a, c) => a + c.missing, 0);
    $('#rcvCount').textContent = chosen.length ? `${chosen.length} received` + (m ? ` · ${m} parcel${m > 1 ? 's' : ''} missing` : '') : '';
  };
  gcSearchBox($('#rcvSearch'), $('#rcvDd'), find, e => { if (!chosen.some(c => c.gc === String(e.gc_no))) chosen.push({ gc: String(e.gc_no), who: `${e.consignor || ''} → ${e.consignee || ''}`, qty: qtyOf(e), missing: 0 }); drawChips(); });
  chips.onclick = ev => { const t = ev.target.closest('button'); if (t && t.dataset.x != null) { chosen.splice(+t.dataset.x, 1); drawChips(); } };
  chips.oninput = ev => {
    const t = ev.target.closest('input[data-m]'); if (!t) return;
    const c = chosen[+t.dataset.m]; let v = Math.max(0, parseInt(t.value, 10) || 0); if (c.qty && v > c.qty) { v = c.qty; t.value = v; }
    c.missing = v; t.closest('.rcv-item').classList.toggle('missing', v > 0);
    const g = $('#rcvGot' + t.dataset.m); if (g) g.textContent = recvOf(c) != null ? `Received ${recvOf(c)}` : '';
    const m = chosen.reduce((a, x) => a + x.missing, 0); $('#rcvCount').textContent = `${chosen.length} received` + (m ? ` · ${m} parcel${m > 1 ? 's' : ''} missing` : '');
  };
  $('#rcvCancel').onclick = closeModal; $('#rcvSearch').focus();
  $('#rcvAdd').onclick = async () => {
    if (!chosen.length) { showToast('Pick at least one GC number', true); return; }
    const b = $('#rcvAdd'); b.disabled = true; b.textContent = 'Saving…';
    try {
      await inwardStore.add(chosen.map(c => ({ gc_no: c.gc, status: 'received', missing_qty: c.missing })));
      const m = chosen.reduce((a, c) => a + c.missing, 0), r = chosen.length;
      closeModal(); showToast(`${r} GC${r > 1 ? 's' : ''} marked received` + (m ? `, ${m} parcel${m > 1 ? 's' : ''} missing` : ''));
      loadInward().catch(err => showToast(err.message, true));
    } catch (err) { showToast(err.message, true); b.disabled = false; b.textContent = 'SAVE'; }
  };
}
$('#receivedBtn').addEventListener('click', openReceived);

// ---- DELIVERY SLIP ----
async function loadSlips(append) {
  const res = await slipStore.page(append ? slips.length : 0);
  slips = append ? slips.concat(res.rows) : res.rows; slipMore = res.more;
  $('#slipRows').innerHTML = slips.length ? slips.map((s, i) => `<tr class="row" data-i="${i}"><td class="adm">${esc(bname(s.branch_id))}</td><td>${esc(s.slip_no)}</td><td>${esc(dmy(s.slip_date))}</td><td>${(s.gc_numbers || []).length}</td><td>${fmt(s.total)}</td><td>${new Date(s.created_at).toLocaleString('en-IN')}</td><td>${actions}</td></tr>`).join('') + moreRow(slipMore, 7) : '<tr><td colspan="7">No delivery slips yet. Use Create Delivery slip.</td></tr>';
}
// the full slip (all its rows) for the A4 sheet; older slips did not store the parties, so they are read from the GCs
async function slipDoc(id) {
  const full = (await getJSON(`delivery_slips?select=slip_no,slip_date,branch_id,data&id=eq.${id}`))[0];
  if (!full) throw new Error('This delivery slip is no longer saved.');
  let rows = Array.isArray(full.data) ? full.data : [];
  const need = rows.filter(r => !r.consignor && !r.consignee).map(r => r.gc);
  if (need.length) {
    let ents = []; try { ents = await store.byGcs(full.branch_id, need, 'gc_no,consignor,consignee'); } catch (e) {}
    const by = new Map(ents.map(e => [String(e.gc_no), e]));
    rows = rows.map(r => { const e = by.get(String(r.gc)); return e && !r.consignor && !r.consignee ? { ...r, consignor: e.consignor, consignee: e.consignee } : r; });
  }
  const bo = branchOf(full.branch_id);
  return { slipNo: full.slip_no, date: full.slip_date, branchName: bo.name || '', branchAddress: bo.address || '', branchPhone: (bo.delivery_ph || bo.booking_ph || '').trim(), rows };
}
const slipPagesFn = slip => async inline => slipPages(slip, inline ? await inlineImgs() : undefined);
$('#slipRows').addEventListener('click', async e => {
  const tr = e.target.closest('tr.row'); if (!tr) return; const s = slips[tr.dataset.i], a = e.target.dataset.a;
  try {
    const d = await slipDoc(s.id);
    if (a === 'pdf') return await svgToPDF(slipPages(d, await inlineImgs()), `Delivery-Slip-${s.slip_no}.pdf`);
    if (a === 'print') return svgPrint(slipPages(d, await inlineImgs()), `Delivery Slip ${s.slip_no}`);
    await showDoc('Delivery slip ' + s.slip_no, 'Saved delivery slip.', slipPagesFn(d), `Delivery-Slip-${s.slip_no}`);
  } catch (err) { showToast(err.message, true); }
});
async function openCreateSlip() {
  let branch; try { branch = needBranch(); } catch (err) { showToast(err.message, true); return; }
  lrBox.innerHTML = '<h3>Create Delivery slip</h3><p class="sub">Loading…</p>'; openModal(true);
  let slipNo;
  try { slipNo = await slipStore.nextNo(); } catch (err) { closeModal(); showToast(slipStore.missing(err.message), true); return; }
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
  gcSearchBox($('#slSearch'), $('#slDd'), async q => (await store.search(branch, q, 60)).filter(e => !rows.some(r => r.gc === String(e.gc_no))),
    e => { if (rows.some(r => r.gc === String(e.gc_no))) return; rows.push({ gc: String(e.gc_no), units: parseFloat(e.quantity) || 0, door: '', other: '', consignor: e.consignor || '', consignee: e.consignee || '' }); draw(); });
  $('#slBody').addEventListener('input', ev => { const k = ev.target.dataset.k; if (k) { rows[ev.target.closest('tr').dataset.i][k] = ev.target.value; sums(); } });
  $('#slBody').addEventListener('click', ev => { const x = ev.target.dataset.x; if (x != null) { rows.splice(+x, 1); draw(); } });
  $('#slCancel').onclick = closeModal; draw(); $('#slSearch').focus();
  $('#slCreate').onclick = async () => {
    if (!rows.length) { showToast('Add at least one GC number', true); return; }
    const b = $('#slCreate'); b.disabled = true; b.textContent = 'Creating…';
    const data = rows.map(r => ({ gc: r.gc, consignor: r.consignor, consignee: r.consignee, units: r.units, door: parseFloat(r.door) || 0, other: parseFloat(r.other) || 0, total: tot(r) }));
    try { await slipStore.add([{ slip_no: slipNo, slip_date: todayLocal(), gc_numbers: rows.map(r => r.gc), total: data.reduce((a, r) => a + r.total, 0), data }]); showToast('Delivery slip ' + slipNo + ' created'); loadSlips().catch(err => showToast(err.message, true));
      const bo = branchOf(branch);
      await showDoc('Delivery slip ' + slipNo + ' created', 'Download, print or close.', slipPagesFn({ slipNo, date: todayLocal(), branchName: bo.name || '', branchAddress: bo.address || '', branchPhone: (bo.delivery_ph || bo.booking_ph || '').trim(), rows: data }), `Delivery-Slip-${slipNo}`); }
    catch (err) { showToast(err.message, true); b.disabled = false; b.textContent = 'Create slip'; }
  };
}
$('#newSlipBtn').addEventListener('click', openCreateSlip);

// report table shows at most 3 cities per cell (full list on hover)
function cities3(s) { const c = String(s || '').split(', ').filter(Boolean); return c.slice(0, 3).join(', ') + (c.length > 3 ? '…' : ''); }
// search, sort and pay-type filter ask the database again (search after a short pause in typing)
let gcTimer;
const reloadEntries = () => loadEntries().catch(err => showToast(err.message, true));
$('#gcSearch').addEventListener('input', () => { clearTimeout(gcTimer); gcTimer = setTimeout(reloadEntries, 300); });
$('#gcSort').addEventListener('change', reloadEntries);
$('#gcPay').addEventListener('change', reloadEntries);

// keep the pressed colour visible for a moment after a click
document.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; b.classList.add('pressed'); setTimeout(() => b.classList.remove('pressed'), 400); });

// ================= sign-in =================
const SESSION_KEY = 'sl_session';
const normPhone = p => String(p || '').replace(/\D/g, '').slice(-10);
const scopeLabel = () => isAdmin() ? (scopeBranch ? bname(scopeBranch) : 'Main Branch') : (session.branch_name || '');
function signOutLocal(msg) {
  session = null; scopeBranch = null; branches = []; entries = []; lrs = []; inwards = []; slips = []; inEntries = new Map(); accRows = [];
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
  $('#lgSub').textContent = stage === 'id' ? 'Enter your phone number or email.' : stage === 'set' ? `First sign-in for ${lg.id}. Choose a password (at least 6 characters) to use from now on.` : lg.id;
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
      if (st === 'expired') return err('Your sign-up link has expired (7 days). Ask the admin to press Reset password for you.');
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
  } catch (ex) { err(ex.message === 'INVALID_LOGIN' ? 'Could not sign in. Ask the admin.' : /INVITE_EXPIRED/.test(ex.message) ? 'Your sign-up link has expired. Ask the admin to press Reset password for you.' : ex.message); }
  finally { btn.disabled = false; }
});
$('#logoutBtn').addEventListener('click', async () => { try { await rpc('auth_logout'); } catch (e) {} signOutLocal(); });

async function loadBranches() {
  const x = await sbFetch('branches?select=*&order=name'); branches = x.ok ? await x.json() : []; fillScope();
}
function fillScope() {
  if (!isAdmin()) return;
  const mb = mainBranch(), opts = '<option value="">Main Branch</option>' + branches.filter(b => (!mb || b.id !== mb.id) && (b.active || b.id === scopeBranch)).map(b => `<option value="${b.id}" ${b.id === scopeBranch ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  document.querySelectorAll('.scopeSel').forEach(s => { s.innerHTML = opts; });
}
function updateEntryHint() {
  const b = curBranch() || (isAdmin() && mainBranch() ? mainBranch().id : null);
  $('#entryHint').textContent = b ? `Saving to branch: ${isAdmin() ? bname(b) : session.branch_name}` : 'Choose a branch in the left menu before saving.';
}
function setScope(id) {
  scopeBranch = id && !(mainBranch() && id === mainBranch().id) ? id : null; fillScope(); updateEntryHint(); $('#mode').textContent = scopeLabel();
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
    <div class="card dash" style="padding:20px;overflow-x:auto"><table><thead><tr><th>Branch</th><th>Booking Ph.</th><th>Delivery Ph.</th><th>Employees</th><th>Status</th><th></th></tr></thead><tbody>${branches.length ? branches.map(b => `<tr class="row" data-b="${b.id}"><td><b>${esc(b.name)}</b></td><td>${esc(b.booking_ph)}</td><td>${esc(b.delivery_ph)}</td><td>${accts.filter(a => a.branch_id === b.id).length}</td><td>${stChip(b.active)}</td><td><button type="button" class="btn-secondary mini" data-a="open">Open</button></td></tr>`).join('') : '<tr><td colspan="6">No branches yet. Use Add branch.</td></tr>'}</tbody></table></div>`;
}
function renderBranchDetail(b) {
  const emps = accts.filter(a => a.branch_id === b.id);
  $('#brBody').innerHTML = `<div class="br-head"><div><button type="button" class="btn-ghost mini" data-a="back">&larr; All branches</button><h2 style="margin-top:8px">${esc(b.name)} ${b.active ? '' : '<span class="chip-st off">Off</span>'}</h2><p class="br-meta">${[b.address, b.booking_ph && 'Booking ' + b.booking_ph, b.delivery_ph && 'Delivery ' + b.delivery_ph].filter(Boolean).map(esc).join(' &middot; ') || 'No details added yet'}</p></div>
    <div class="br-actions"><button type="button" class="btn-primary" data-a="viewData">View branch data</button><button type="button" class="btn-secondary" data-a="editBranch">Edit branch</button><button type="button" class="btn-secondary" data-a="toggleBranch">${b.active ? 'Switch off' : 'Switch on'}</button></div></div>
    <div class="br-sec"><h3>Employees (${emps.length})</h3><button type="button" class="btn-primary" data-a="addEmp">Add employee</button></div>
    <div class="card dash" style="padding:20px;overflow-x:auto"><table><thead><tr><th>Name</th><th>Phone</th><th>Password</th><th>Status</th><th></th></tr></thead><tbody>${emps.length ? emps.map(a => `<tr data-e="${a.id}"><td><b>${esc(a.name)}</b></td><td>${esc(a.phone)}</td><td>${a.has_password ? '<span class="chip-st ok">Set</span>' : '<span class="chip-st wait">Not set yet</span>'}</td><td>${stChip(a.active)}</td><td><button type="button" class="btn-secondary mini" data-a="editEmp">Edit</button><button type="button" class="btn-secondary mini" data-a="resetEmp">Reset password</button><button type="button" class="btn-secondary mini" data-a="toggleEmp">${a.active ? 'Switch off' : 'Switch on'}</button></td></tr>`).join('') : '<tr><td colspan="5">No employees yet. Use Add employee.</td></tr>'}</tbody></table></div>`;
}
$('#brBody').addEventListener('click', async e => {
  const btn = e.target.closest('[data-a]'), a = btn && btn.dataset.a, rowB = e.target.closest('tr[data-b]'), rowE = e.target.closest('tr[data-e]');
  const b = brOpen && branches.find(v => v.id === brOpen), emp = rowE && accts.find(v => v.id === +rowE.dataset.e);
  const done = async () => { await loadBranchesPage(); };
  try {
    if (a === 'back') { brOpen = null; return renderBranches(); }
    if (a === 'open' || (!a && rowB)) { brOpen = +rowB.dataset.b; return renderBranches(); }
    if (a === 'addBranch') return formModal('Add branch', 'Create the branch first, then add its employees.', [
      { k: 'name', label: 'Branch name (same as city) *', ph: 'e.g. Surat', full: true }, { k: 'address', label: 'Address', full: true }, { k: 'bkgPh', label: 'Booking Ph.', mode: 'tel' }, { k: 'delPh', label: 'Delivery Ph.', mode: 'tel' }],
      async v => { if (!v.name) throw new Error('Branch name is required.'); const x = await writeOk(await sbFetch('branches', { method: 'POST', headers: { Prefer: 'return=representation' }, body: json({ name: v.name, city: v.name, address: v.address || null, booking_ph: v.bkgPh || null, delivery_ph: v.delPh || null }) }), 'A branch with this name already exists.'); brOpen = (await x.json())[0].id; await done(); showToast('Branch added'); }, 'Add branch');
    if (!b) return;
    if (a === 'editBranch') return formModal('Edit branch', b.name, [
      { k: 'name', label: 'Branch name (same as city) *', val: b.name, full: true }, { k: 'address', label: 'Address', val: b.address, full: true }, { k: 'bkgPh', label: 'Booking Ph.', val: b.booking_ph, mode: 'tel' }, { k: 'delPh', label: 'Delivery Ph.', val: b.delivery_ph, mode: 'tel' }],
      async v => { if (!v.name) throw new Error('Branch name is required.'); await writeOk(await sbFetch(`branches?id=eq.${b.id}`, { method: 'PATCH', body: json({ name: v.name, city: v.name, address: v.address || null, booking_ph: v.bkgPh || null, delivery_ph: v.delPh || null }) }), 'A branch with this name already exists.'); await done(); showToast('Branch updated'); });
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
    if (a === 'resetEmp') { if (!confirm(`Reset the password of ${emp.name}? They will be asked to create a new one at their next sign-in (within 7 days).`)) return; await rpc('admin_reset_password', { p_account: emp.id }); await done(); return showToast('Password reset'); }
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
