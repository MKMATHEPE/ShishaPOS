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

Open `http://localhost:5173` in your browser. Default login: **Admin / 1234**.

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

Without these the app runs in local-only mode (no sync between devices).
