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

**Where to add them:** Cloudflare dashboard → Workers & Pages → `sabri-whatsapp` → Settings →
Variables and Secrets → Add. Paste into the Key box, one per line:

```
WA_TOKEN=...
WA_PHONE_ID=...
WA_TEMPLATE=...
```

then tick **Secret** on `WA_TOKEN` and click **Add variable and deploy**. Nothing in the app needs to change.

The template needs a **Document** header and 4 blanks in the body, in this order: consignor, GC number,
from city, to city. For example:
`Hello {{1}}, your consignment GC No. {{2}} from {{3}} to {{4}} has been booked. Your receipt is attached.`

Before registering: the sending number must not be in use on the normal WhatsApp app, and the business must be
verified with Meta (unverified accounts can message only ~250 new people a day; the branches need ~2,500).

Until this is done, GCs save normally; if a consignor WhatsApp number is typed, the app shows that sending failed.

## Going live

The app is not hosted yet. Publish the `dist` folder (any static host). The database (Supabase) is already updated.
