-- ============================================
-- Product Price Tracker - Supabase Database Setup
-- Run this SQL in the Supabase SQL Editor
-- ============================================

-- Table: tracked_products
-- Stores products that users have chosen to track
CREATE TABLE IF NOT EXISTS tracked_products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_product_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  sku TEXT,
  slug TEXT,
  description TEXT,
  current_price DECIMAL(10, 2),
  current_stock INTEGER,
  active BOOLEAN DEFAULT true,
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: price_history
-- Stores historical price and stock data for each tracked product
CREATE TABLE IF NOT EXISTS price_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tracked_product_id UUID REFERENCES tracked_products(id) ON DELETE CASCADE,
  store_product_id INTEGER NOT NULL,
  price DECIMAL(10, 2),
  original_price DECIMAL(10, 2),
  stock INTEGER,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: scrape_logs
-- Logs every scrape attempt with outcome (success/failure)
CREATE TABLE IF NOT EXISTS scrape_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tracked_product_id UUID REFERENCES tracked_products(id) ON DELETE CASCADE,
  store_product_id INTEGER NOT NULL,
  success BOOLEAN NOT NULL,
  price DECIMAL(10, 2),
  original_price DECIMAL(10, 2),
  stock INTEGER,
  method TEXT DEFAULT 'playwright',
  duration_ms INTEGER,
  attempt_count INTEGER DEFAULT 1,
  error_message TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(tracked_product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(recorded_at);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_product ON scrape_logs(tracked_product_id);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_date ON scrape_logs(scraped_at);
CREATE INDEX IF NOT EXISTS idx_tracked_products_store_id ON tracked_products(store_product_id);
CREATE INDEX IF NOT EXISTS idx_tracked_products_active ON tracked_products(active);

-- Enable Row Level Security (RLS)
ALTER TABLE tracked_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_logs ENABLE ROW LEVEL SECURITY;

-- Allow anonymous read/write access (for simplicity; tighten for production)
CREATE POLICY "Allow all access to tracked_products" ON tracked_products
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to price_history" ON price_history
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to scrape_logs" ON scrape_logs
  FOR ALL USING (true) WITH CHECK (true);

-- Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tracked_products_updated_at
  BEFORE UPDATE ON tracked_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
