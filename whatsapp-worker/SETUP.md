# WhatsApp sender on Cloudflare (free)

The app sends each GC PDF to the consignor's WhatsApp. Doing that through Supabase would use up the free plan's
5 GB monthly egress, so it runs on a Cloudflare Worker instead: free for up to 100,000 sends a day, with no
charge for data. Setup takes about 10 minutes and needs no programming.

## 1. Create the Worker

1. Sign up (free) at https://dash.cloudflare.com/sign-up and log in.
2. In the left menu open **Compute (Workers)** → **Workers & Pages** → **Create** → **Create Worker**
   (choose the "Hello World" starter).
3. Name it `sabri-whatsapp` and click **Deploy**.
4. Click **Edit code**. Delete everything in the editor, paste the whole of `worker.js` (this folder), then click **Deploy**.

## 2. Add the settings

In the Worker, open **Settings → Variables and Secrets** and add these. Use type **Secret** for `WA_TOKEN`; the others can be **Text**.

| Name | Value |
|---|---|
| `SUPABASE_URL` | the same address as `SUPABASE_URL` in `dist/config.js` |
| `SUPABASE_ANON_KEY` | the same key as `SUPABASE_ANON_KEY` in `dist/config.js` |
| `WA_TOKEN` | your WhatsApp access token (Meta → WhatsApp → API Setup) |
| `WA_PHONE_ID` | your WhatsApp phone number ID (same page) |
| `WA_TEMPLATE` | the name of your approved message template |
| `WA_LANG` | optional, the template's language code (default `en`) |
| `WA_WABA_ID` | WhatsApp Business Account ID (for the balance box in Accounting) |
| `ALLOWED_ORIGINS` | optional, the site address(es), comma-separated, e.g. `https://sabrilogistics.in` |

Click **Deploy** (or **Save and deploy**) after adding them.

## 3. Point the app at it

1. Copy the Worker's address from its overview page. It looks like `https://sabri-whatsapp.<your-name>.workers.dev`.
2. In `dist/config.js`, set it:

   ```js
   window.WHATSAPP_URL = 'https://sabri-whatsapp.<your-name>.workers.dev';
   ```

3. Publish the updated `dist` folder as usual.

## 4. Check it

Save a GC with your own WhatsApp number as the consignor's number. You should get the PDF within a few seconds.
If something is wrong, the app shows the reason (for example "WhatsApp is not configured on the server yet"
means a variable is missing).

Once this works, the old `send-whatsapp` Supabase function is no longer used. You can leave it or delete it.

## Limits (free plan)

- 100,000 sends a day (you send about 2,500). Above that, sends fail for the rest of the day; there is never a bill.
- No charge for data. Meta still charges its own per-message WhatsApp fee.
