# Product Price Tracker

A full-stack web application that tracks product prices from INE's hosted mock storefront ([https://demo.inelabteamdev.com/](https://demo.inelabteamdev.com/)). Users can search for products, track them, and monitor price/stock changes over time with automated scraping.

## 🏗️ Tech Stack

| Component | Technology | Hosting |
|-----------|-----------|---------|
| Frontend | React (Vite) | Vercel |
| Backend | Node.js (Express) | Render |
| Database | PostgreSQL | Supabase |
| Scraping | Playwright | Server-side |
| Scheduling | cron-job.org | External |

## 📐 Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   React UI  │────▶│  Express API │────▶│  Supabase   │
│  (Vercel)   │◀────│  (Render)    │◀────│ (PostgreSQL)│
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────▼───────┐
                    │  Playwright  │
                    │  Scraper     │────▶ Mock Store
                    └──────────────┘     (demo.inelabteamdev.com)
                           ▲
                    ┌──────┴───────┐
                    │ cron-job.org │  (every 2 hours)
                    └──────────────┘
```

## ✨ Features

### Core Features
- **Product Search** – Search the INE mock store (1000 products) by name, brand, category, or SKU
- **Product Tracking** – One-click tracking with automatic initial scrape
- **Scheduled Scraping** – Automated scraping every 2 hours via cron-job.org
- **Price History Charts** – Interactive Recharts graphs showing price and stock trends
- **Scrape Logs** – Honest per-product log of every scrape attempt (success/failure/retries)

### Scraper Reliability
- Retry logic with exponential backoff (3 retries per product)
- Dynamic CSS class handling (layout API for obfuscated price elements)
- Hover/dwell interaction simulation for price reveal
- Graceful error handling – failures are logged, never hidden
- Playwright for JavaScript-rendered content

### Dashboard
- Stats overview (tracked products, price data, stock status, scrape success rate)
- Product cards with current price, stock status, and last scrape time
- Manual scrape trigger for individual products or all at once

## 🚀 Setup Instructions

### Prerequisites
- Node.js 18+ and npm
- A [Supabase](https://supabase.com/) account (free tier)
- A [Render](https://render.com/) account (free tier)
- A [Vercel](https://vercel.com/) account (free tier)
- A [cron-job.org](https://cron-job.org/) account (free)

### 1. Database Setup (Supabase)

1. Create a new Supabase project
2. Go to **SQL Editor** and run the SQL from `backend/supabase-schema.sql`
3. Note down your **Project URL** and **anon/service_role key** from Settings > API

### 2. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your Supabase credentials
npm install
npx playwright install chromium
npm run dev
```

**Environment Variables:**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=5000
MOCK_STORE_BASE_URL=https://demo.inelabteamdev.com
FRONTEND_URL=http://localhost:5173
CRON_SECRET=your-random-secret   # Optional: secure the cron endpoint
```

### 3. Frontend Setup

```bash
cd frontend
cp .env.example .env
# Edit .env: VITE_API_URL=http://localhost:5000
npm install
npm run dev
```

### 4. Scraping Schedule (cron-job.org)

1. Sign up at [cron-job.org](https://cron-job.org)
2. Create a new cron job:
   - **URL:** `https://your-render-backend.onrender.com/api/cron/scrape?secret=your-random-secret`
   - **Schedule:** Every 2 hours (`0 */2 * * *`)
   - **Method:** GET
3. This keeps the Render free-tier instance warm and triggers scrapes

## 📦 Deployment

### Deploy Backend to Render

1. Push code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com/)
3. Create a **New Web Service**
4. Connect your GitHub repo, set root directory to `backend`
5. **Build Command:** `npm install && npx playwright install chromium --with-deps`
6. **Start Command:** `npm start`
7. Add environment variables (same as `.env`)
8. Deploy!

### Deploy Frontend to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Import your GitHub repo
3. Set root directory to `frontend`
4. Add environment variable:
   - `VITE_API_URL` = your Render backend URL (e.g. `https://your-app.onrender.com`)
5. Deploy!

### Post-Deployment
- Update backend's `FRONTEND_URL` / `VERCEL_FRONTEND_URL` env var with your Vercel URL
- Set up the cron job on cron-job.org pointing to your Render URL

## 🔧 Observable (Headed) Scraper Run

To watch the scraper work in real-time with a visible browser:

```bash
cd backend
npm run scrape:headed
```

This launches Playwright in headed mode so you can observe:
- Page navigation to the mock store
- Price reveal interactions (hover/dwell)
- Data extraction in real-time
- Error recovery and retries

## 📁 Project Structure

```
product-price-tracker/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── supabase.js        # Supabase client
│   │   ├── routes/
│   │   │   └── products.js        # API endpoints
│   │   ├── scraper/
│   │   │   ├── scraper.js         # Core scraper logic
│   │   │   └── run.js             # Standalone scraper runner
│   │   └── index.js               # Express server
│   ├── supabase-schema.sql        # Database schema
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   └── index.js           # API client
│   │   ├── components/
│   │   │   ├── Sidebar.jsx        # Navigation sidebar
│   │   │   └── ToastContainer.jsx # Toast notifications
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx      # Product dashboard
│   │   │   ├── SearchPage.jsx     # Search & track
│   │   │   └── ProductDetail.jsx  # Price charts & logs
│   │   ├── App.jsx                # Root component
│   │   ├── App.css
│   │   └── index.css              # Design system
│   ├── vercel.json                # Vercel SPA config
│   ├── package.json
│   └── .env.example
└── README.md
```

## 🔄 Scraping Schedule

- **Frequency:** Every 2 hours
- **Trigger:** External cron via cron-job.org (GET request)
- **Why external cron?** Render free-tier instances sleep after inactivity. An external cron keeps the instance warm and triggers scrapes reliably.

## ⚙️ Design Decisions & Trade-offs

### Why Playwright over lightweight HTTP?
The mock store is a React SPA that renders prices dynamically with:
- JavaScript-generated DOM content
- Randomized CSS class names (from `/api/layout`)
- A hover/dwell interaction required to reveal prices
- Prices split across elements (`priceCarrier: "split"`)

Lightweight HTTP+cheerio can't execute JS or simulate interactions, so Playwright is necessary.

### Why external cron instead of `setInterval`?
Render free-tier instances go idle after ~15 minutes without requests. A `setInterval` inside the server would stop when the instance sleeps. cron-job.org sends a GET request every 2 hours, which both wakes the instance and triggers the scrape.

### Retry Logic
Each scrape attempt retries up to 3 times with exponential backoff (2s → 4s → 8s). This handles:
- Slow page loads
- Intermittent network errors
- Content loading delays on the mock store

### Honest Logging
All scrape attempts are logged to `scrape_logs` including:
- Success/failure status
- Extracted price and stock
- Duration in milliseconds
- Number of retry attempts
- Error messages for failures

Failures are never hidden – the assignment specifically requires honest recording.

## 📝 Environment Variables Reference

### Backend (.env)
| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key |
| `PORT` | ❌ | Server port (default: 5000) |
| `MOCK_STORE_BASE_URL` | ❌ | Mock store URL (default: https://demo.inelabteamdev.com) |
| `FRONTEND_URL` | ❌ | Frontend URL for CORS |
| `VERCEL_FRONTEND_URL` | ❌ | Vercel frontend URL for CORS |
| `CRON_SECRET` | ❌ | Secret to secure cron endpoint |

### Frontend (.env)
| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | ✅ | Backend API URL |

## 📄 License

MIT
