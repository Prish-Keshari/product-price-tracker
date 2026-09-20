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
