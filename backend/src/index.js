require('dotenv').config();
const express = require('express');
const cors = require('cors');
const productRoutes = require('./routes/products');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration
const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:5173',
];

// In production, add your Vercel deployment URL
if (process.env.VERCEL_FRONTEND_URL) {
    allowedOrigins.push(process.env.VERCEL_FRONTEND_URL);
}

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, cron jobs)
        if (!origin) return callback(null, true);
        if (allowedOrigins.some(allowed => origin.startsWith(allowed) || origin.includes('.vercel.app'))) {
            return callback(null, true);
        }
        callback(null, true); // Allow all for now, tighten in production
    },
    credentials: true,
}));

app.use(express.json());

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Product Price Tracker API',
        timestamp: new Date().toISOString(),
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', uptime: process.uptime() });
});

// API routes
app.use('/api/products', productRoutes);

// Cron endpoint (alternative to /api/products/scrape-all for simpler cron configuration)
app.get('/api/cron/scrape', async (req, res) => {
    const cronSecret = req.query.secret;
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Redirect to the scrape-all endpoint
    try {
        const supabase = require('./config/supabase');
        const { scrapeProductPrice } = require('./scraper/scraper');

        const { data: products, error } = await supabase
            .from('tracked_products')
            .select('*')
            .eq('active', true);

        if (error) throw error;

        res.json({ message: `Scraping ${(products || []).length} products`, triggered: true });

        // Run in background
        for (const product of (products || [])) {
            try {
                const result = await scrapeProductPrice(product.store_product_id, { maxRetries: 3 });

                await supabase.from('scrape_logs').insert({
                    tracked_product_id: product.id,
                    store_product_id: product.store_product_id,
                    success: result.success,
                    price: result.price,
                    original_price: result.originalPrice,
                    stock: result.stock,
                    method: result.method,
                    duration_ms: result.duration,
                    attempt_count: result.attempt,
                    error_message: result.error || null,
                    scraped_at: result.scrapedAt,
                });

                if (result.success) {
                    await supabase.from('price_history').insert({
                        tracked_product_id: product.id,
                        store_product_id: product.store_product_id,
                        price: result.price,
                        original_price: result.originalPrice,
                        stock: result.stock,
                        recorded_at: result.scrapedAt,
                    });

                    await supabase.from('tracked_products').update({
                        current_price: result.price,
                        current_stock: result.stock,
                        last_scraped_at: result.scrapedAt,
                    }).eq('id', product.id);
                }
            } catch (err) {
                console.error(`Cron scrape error for product ${product.store_product_id}:`, err.message);
            }
        }
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`🚀 Product Price Tracker API running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🔍 Search: http://localhost:${PORT}/api/products/search?q=headphones`);
});
