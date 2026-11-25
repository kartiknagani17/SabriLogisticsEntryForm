# Still to do

## WhatsApp sending (paused until the Meta WhatsApp API is set up)

The WhatsApp sender is already running on Cloudflare (Worker **`sabri-whatsapp`**,
`https://sabri-whatsapp.kartiknagani17.workers.dev`) and the app already points at it.
It only needs these 3 settings, which come from Meta once the WhatsApp Business API is registered:

| Name | What it is | Where to find it |
|---|---|---|
| `WA_TOKEN` | permanent access token (tick **Secret**) | business.facebook.com/settings → Users → System users → Generate new token (permissions: whatsapp_business_messaging, whatsapp_business_management) |
| `WA_PHONE_ID` | phone number ID | developers.facebook.com → My Apps → your app → WhatsApp → API Setup |
| `WA_TEMPLATE` | name of the approved template, e.g. `gc_receipt` | WhatsApp Manager → Message templates |
| `WA_WABA_ID` | WhatsApp Business Account ID (for the balance box in Accounting) | WhatsApp Manager → Overview (the `asset_id` in the address) or API Setup |

**Where to add them:** Cloudflare dashboard → Workers & Pages → `sabri-whatsapp` → Settings →
Variables and Secrets → Add. Paste into the Key box, one per line:

```
WA_TOKEN=...
WA_PHONE_ID=...
WA_TEMPLATE=...
WA_WABA_ID=...
```

then tick **Secret** on `WA_TOKEN` and click **Add variable and deploy**. Nothing in the app needs to change.

The template needs a **Document** header and 4 blanks in the body, in this order: consignor, GC number,
from city, to city. For example:
`Hello {{1}}, your consignment GC No. {{2}} from {{3}} to {{4}} has been booked. Your receipt is attached.`

Before registering: the sending number must not be in use on the normal WhatsApp app, and the business must be
verified with Meta (unverified accounts can message only ~250 new people a day; the branches need ~2,500).

Until this is done, GCs save normally; if a consignor WhatsApp number is typed, the app shows that sending failed.

## WhatsApp balance box

Accounting (admin) shows the WhatsApp balance = money recorded with **Add funds** minus what Meta reports as spent since
the first top-up. Meta has no balance API, so record each top-up you make in WhatsApp Manager → Payment configurations.

## Hosting

The site is hosted on Vercel from this repository (`vercel.json`: serves `dist`, adds security headers). Every push to
`main` deploys. `/` is the public business website (index, privacy, terms); the staff dashboard is at `/app`. Database changes are in `supabase-scale/` (step 5 = missing GCs, login hardening, wallet; already run).

## TEMPORARY: Login disabled
Login is intentionally blocked for now. To restore it:
- Point the Login links in `dist/index.html`, `dist/privacy.html`, `dist/terms.html` back to `/app` (they currently go to `/error`).
- Remove the `/app` and `/app.html` redirects from `vercel.json`.
- Delete `dist/error.html` if no longer needed.

## TEMPORARY: Whole website down
The whole site is intentionally down; every page redirects to `/maintenance`. To bring it back:
- Remove the catch-all redirect (the one whose source starts with `/((?!maintenance`) from `vercel.json`.
- Delete `dist/maintenance.html`.
- Then follow "Login disabled" above to restore login.
