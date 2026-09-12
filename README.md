# Payment Feed

A small team app: an admin picks which QuickBooks Online clients to watch, and the team sees
those clients' payments the moment they post in QuickBooks. Data lives in Supabase.

- **Feed** (everyone): live list of payments from tracked clients, today / month totals, client filter.
- **Admin** (admins only): connect QuickBooks, choose clients to track, manage who is on the team.

## How it works

```
QuickBooks ──webhook──▶ qbo-webhook (edge fn) ──▶ qbo_payments (Postgres)
                                                        │ realtime
                               Team browser ◀───────────┘
Admin browser ──▶ qbo-oauth / qbo-sync (edge fns) ──▶ QuickBooks API
```

1. Admin clicks **Connect QuickBooks** → Intuit OAuth → tokens stored in `qbo_connections`
   (service-role only, never readable from the browser). Customers sync into `qbo_customers`.
2. Admin checks the clients to track (`qbo_customers.tracked`).
3. Intuit sends a webhook for each new/changed Payment → the function verifies the HMAC
   signature, fetches the payment, and upserts it into `qbo_payments`.
4. Row Level Security lets team members read only payments whose customer is tracked.
   Supabase Realtime pushes inserts to every open browser.

## One-time setup

### 1. Supabase

Apply `supabase/migrations/0001_qbo_payment_feed.sql` to the project (SQL editor, CLI, or MCP).

Deploy the three functions in `supabase/functions/`. `qbo-webhook` and `qbo-oauth` must have
**Verify JWT turned off** (Intuit calls them directly; they authenticate on their own).

Set these secrets on the project (Dashboard → Edge Functions → Secrets, or `supabase secrets set`):

| Secret | Value |
| --- | --- |
| `QBO_CLIENT_ID` | from your Intuit app (Keys & credentials) |
| `QBO_CLIENT_SECRET` | same place |
| `QBO_WEBHOOK_VERIFIER` | from your Intuit app (Webhooks → Verifier token) |
| `QBO_ENVIRONMENT` | `production` (or `sandbox` while testing) |
| `APP_URL` | where the frontend is hosted, e.g. `https://payments.yourdomain.com` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.

Auth: enable the **Email** provider (magic links). The **first person to sign in becomes admin**;
everyone after is a member. To stop strangers from signing up, turn off "Allow new users to sign up"
in Auth settings after your team is in, or remove people from the Team card.

### 2. Intuit developer app

At <https://developer.intuit.com> create an app (QuickBooks Online and Payments → Accounting scope).

- **Redirect URI**: `https://<project-ref>.supabase.co/functions/v1/qbo-oauth`
- **Webhooks → Endpoint URL**: `https://<project-ref>.supabase.co/functions/v1/qbo-webhook`
- **Webhooks → Events**: `Payment` (Create, Update, Delete, Void) and `Customer` (Create, Update, Delete, Merge)
- Copy the Client ID, Client Secret, and Webhook Verifier Token into the Supabase secrets above.

Production keys require the app to pass Intuit's production checklist; sandbox keys work immediately
for testing (set `QBO_ENVIRONMENT=sandbox`).

### 3. Frontend

```bash
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev            # local
npm run build          # dist/ → deploy to Vercel, Netlify, Cloudflare Pages, etc.
```

Add the deployed URL to Supabase → Auth → URL Configuration (Site URL + Redirect URLs) so magic
links land back on the app.

## Day to day

- Admin → **Sync customers + last 90 days** pulls in history after first connecting, or after the
  webhook was down for a while.
- Intuit refresh tokens last 100 days of inactivity. The app refreshes them on every API call, so
  a live webhook keeps the connection alive indefinitely; the Admin card warns when it gets close.
- Voided or deleted payments disappear from the feed.

## Tables

| Table | Purpose | Who can read |
| --- | --- | --- |
| `qbo_team` | team members and roles | own row; admins see all |
| `qbo_connections` | QuickBooks OAuth tokens | service role only |
| `qbo_connection_status` (view) | connection info without tokens | admins |
| `qbo_oauth_states` | short-lived OAuth state | service role only |
| `qbo_customers` | QuickBooks customers + `tracked` flag | admins all; members tracked only |
| `qbo_payments` | payments | members, tracked clients only |
