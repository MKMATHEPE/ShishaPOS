# The Chill Pipe · POS

A point-of-sale system built for The Chill Pipe shisha lounge. Runs in the browser, syncs to Supabase in real time, and falls back to localStorage when offline.

---

## Features

- **POS** — Place new pipe or refill orders, choose flavour, set payment method (card / cash), and confirm in one tap.
- **Orders Delivered** — Track fulfilled orders with timestamps and payment breakdown.
- **Management** — Live session KPIs: revenue, order counts, average spend, flavour popularity, and historical daily averages.
- **Stock** — Manage consumables and equipment inventory. Low-stock and out-of-stock alerts per item and per flavour.
- **Settings** — Add / remove staff, set per-user permissions, and configure pipe prices.

## Roles & Permissions

| Permission | Staff | Manager | Admin |
|---|:---:|:---:|:---:|
| POS | ✓ | ✓ | ✓ |
| Orders Delivered | ✓ | ✓ | ✓ |
| Stock | | ✓ | ✓ |
| Management | | ✓ | ✓ |
| Settings | | | ✓ |

Permissions are per-user and can be toggled by an Admin from the Settings tab.

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser and sign in with a Supabase Auth account.

## Secure authentication setup

1. Run `supabase-schema.sql` in the Supabase SQL Editor. This enables Row Level Security and locks the legacy PIN table.
2. In Supabase Authentication, create the first owner account with a strong password.
3. Run the bootstrap statement at the bottom of `supabase-schema.sql`, replacing `owner@example.com` with that account's email.
4. Deploy the protected staff-management function:

```bash
npx supabase functions deploy manage-pos-user
```

5. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to Vercel. Never put a service-role key in a `VITE_` variable.

After the first Admin can sign in with email, create staff and manager accounts from Settings. They sign in with their unique username and a password of at least 10 characters.

## Tech Stack

- [React 19](https://react.dev) + [Vite](https://vite.dev)
- [Supabase](https://supabase.com) — Postgres database with real-time sync
- localStorage — offline fallback, no data loss if Supabase is unreachable

## Environment Variables

Create a `.env` file in the project root:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

Without these the app fails closed and cannot sign in; there is no insecure local-only login fallback.
