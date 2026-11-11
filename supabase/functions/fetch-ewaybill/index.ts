// Looks up an e-way bill by number and returns the fields the GC form can auto-fill.
// The upstream API (NIC directly, or a GSP such as MasterGST / Adaequare / ClearTax) is configured by secrets, because
// its URL, auth headers and encryption differ per provider:
//   EWB_API_URL      full URL with {ewbNo} placeholder, e.g. https://<provider>/ewaybillapi/v1.03/ewayapi/GetEwayBill?ewbNo={ewbNo}
//   EWB_HEADERS      JSON object of headers to send (client id/secret, gstin, auth token, ...)
// Response is expected in NIC's GetEwayBill shape (fromTrdName, toTrdName, itemList, ...), optionally wrapped in {data: ...}.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-session-token',
};
const reply = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// NIC date dd/mm/yyyy -> yyyy-mm-dd (not used for the GC date, which the user sets)
// deno-lint-ignore no-explicit-any
function mapFields(e: any) {
  const items = Array.isArray(e.itemList) ? e.itemList : [];
  const names = [...new Set(items.map((i: any) => String(i.productName || i.productDesc || '').trim()).filter(Boolean))];
  const qty = items.reduce((n: number, i: any) => n + (Number(i.quantity) || 0), 0);
  return {
    consignor: e.fromTrdName,
    consignorGst: e.fromGstin && e.fromGstin !== 'URP' ? e.fromGstin : '',
    consignee: e.toTrdName,
    consigneeGst: e.toGstin && e.toGstin !== 'URP' ? e.toGstin : '',
    from: e.fromPlace,
    to: e.toPlace,
    invNo: e.docNo,
    invoiceValue: e.totInvValue ?? e.totalValue,
    description: names.join(', ').slice(0, 120),
    quantity: qty || '',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const sess = req.headers.get('x-session-token') || '';
    const me = await fetch(Deno.env.get('SUPABASE_URL')! + '/rest/v1/rpc/auth_me', {
      method: 'POST',
      headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, 'x-session-token': sess, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!sess || !me.ok) return reply({ error: 'Please sign in again.' }, 401);

    const { ewbNo } = await req.json();
    const no = String(ewbNo || '').replace(/\D/g, '');
    if (no.length !== 12) return reply({ error: 'E-way bill number must be 12 digits.' }, 400);

    const url = Deno.env.get('EWB_API_URL');
    if (!url) return reply({ error: 'E-way bill API is not configured on the server yet.' }, 500);
    const headers = JSON.parse(Deno.env.get('EWB_HEADERS') || '{}');
    const r = await fetch(url.replace('{ewbNo}', no), { headers });
    const body = await r.json().catch(() => ({}));
    const e = body?.data ?? body;
    if (!r.ok || !e || (!e.fromTrdName && !e.toTrdName && !e.itemList))
      return reply({ error: body?.message || body?.error?.message || 'No e-way bill found for this number.' }, r.ok ? 404 : 502);
    return reply({ fields: mapFields(e) });
  } catch (err) {
    return reply({ error: String(err) }, 500);
  }
});
