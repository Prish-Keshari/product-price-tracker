const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { deepSearchCatalog, fetchProductDetails, scrapeProductPrice } = require('../scraper/scraper');

/**
 * GET /api/products/search?q=query
 * Search the mock store catalog for products
 */
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 2) {
            return res.status(400).json({ error: 'Search query must be at least 2 characters' });
        }

        const results = await deepSearchCatalog(q);
        res.json({ results, count: results.length });
    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json({ error: 'Failed to search products' });
    }
});

/**
 * GET /api/products/details/:id
 * Get full product details from the mock store
 */
router.get('/details/:id', async (req, res) => {
    try {
        const details = await fetchProductDetails(req.params.id);
        res.json(details);
    } catch (error) {
        console.error('Product details error:', error.message);
        res.status(500).json({ error: 'Failed to fetch product details' });
    }
});

/**
 * POST /api/products/track
 * Start tracking a product - saves it to Supabase
 */
router.post('/track', async (req, res) => {
    try {
        const { storeProductId, name, brand, category, sku, slug, description } = req.body;

        if (!storeProductId || !name) {
            return res.status(400).json({ error: 'storeProductId and name are required' });
        }

        // Check if already tracked
        const { data: existing } = await supabase
            .from('tracked_products')
            .select('id')
            .eq('store_product_id', storeProductId)
            .single();

        if (existing) {
            // Re-activate if it was deactivated
            await supabase
                .from('tracked_products')
                .update({ active: true })
                .eq('id', existing.id);

            return res.json({ message: 'Product already tracked', id: existing.id, reactivated: true });
        }

        // Insert new tracked product
        const { data, error } = await supabase
            .from('tracked_products')
            .insert({
                store_product_id: storeProductId,
                name,
                brand,
                category,
                sku,
                slug,
                description,
                active: true,
            })
            .select()
            .single();

        if (error) throw error;

        // Trigger initial scrape
        console.log(`[API] Triggering initial scrape for product ${storeProductId}`);
        scrapeProductPrice(storeProductId, { maxRetries: 3 }).then(async (result) => {
            if (result.success) {
                await supabase.from('price_history').insert({
                    tracked_product_id: data.id,
                    store_product_id: storeProductId,
                    price: result.price,
                    original_price: result.originalPrice,
                    stock: result.stock,
                    recorded_at: result.scrapedAt,
                });

                await supabase
                    .from('tracked_products')
                    .update({
                        current_price: result.price,
                        current_stock: result.stock,
                        last_scraped_at: result.scrapedAt,
                    })
                    .eq('id', data.id);
            }

            await supabase.from('scrape_logs').insert({
                tracked_product_id: data.id,
                store_product_id: storeProductId,
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
        }).catch(err => console.error('[API] Initial scrape error:', err.message));

        res.status(201).json({ message: 'Product tracking started', product: data });
    } catch (error) {
        console.error('Track product error:', error.message);
        res.status(500).json({ error: 'Failed to track product' });
    }
});

/**
 * GET /api/products/tracked
 * Get all tracked products
 */
router.get('/tracked', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('tracked_products')
            .select('*')
            .eq('active', true)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Get tracked products error:', error.message);
        res.status(500).json({ error: 'Failed to get tracked products' });
    }
});

/**
 * GET /api/products/:id/history
 * Get price history for a tracked product
 */
router.get('/:id/history', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('price_history')
            .select('*')
            .eq('tracked_product_id', req.params.id)
            .order('recorded_at', { ascending: true });

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Get price history error:', error.message);
        res.status(500).json({ error: 'Failed to get price history' });
    }
});

/**
 * GET /api/products/:id/logs
 * Get scrape logs for a tracked product
 */
router.get('/:id/logs', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('scrape_logs')
            .select('*')
            .eq('tracked_product_id', req.params.id)
            .order('scraped_at', { ascending: false })
            .limit(100);

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Get scrape logs error:', error.message);
        res.status(500).json({ error: 'Failed to get scrape logs' });
    }
});

/**
 * DELETE /api/products/:id/untrack
 * Stop tracking a product (soft delete)
 */
router.delete('/:id/untrack', async (req, res) => {
    try {
        const { error } = await supabase
            .from('tracked_products')
            .update({ active: false })
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ message: 'Product untracked successfully' });
    } catch (error) {
        console.error('Untrack product error:', error.message);
        res.status(500).json({ error: 'Failed to untrack product' });
    }
});

/**
 * POST /api/products/:id/scrape
 * Trigger a manual scrape for a specific product
 */
router.post('/:id/scrape', async (req, res) => {
    try {
        const { data: product, error: fetchError } = await supabase
            .from('tracked_products')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchError || !product) {
            return res.status(404).json({ error: 'Tracked product not found' });
        }

        res.json({ message: 'Scrape triggered', productId: product.store_product_id });

        // Run scrape in background
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

            await supabase
                .from('tracked_products')
                .update({
                    current_price: result.price,
                    current_stock: result.stock,
                    last_scraped_at: result.scrapedAt,
                })
                .eq('id', product.id);
        }
    } catch (error) {
        console.error('Manual scrape error:', error.message);
    }
});

/**
 * POST /api/products/scrape-all
 * Trigger scrape for all tracked products (used by cron-job.org)
 */
router.post('/scrape-all', async (req, res) => {
    try {
        // Optional: validate a secret key for cron job security
        const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
        if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { data: products, error } = await supabase
            .from('tracked_products')
            .select('*')
            .eq('active', true);

        if (error) throw error;

        if (!products || products.length === 0) {
            return res.json({ message: 'No tracked products to scrape' });
        }

        res.json({ message: `Scraping ${products.length} products`, started: true });

        // Run scrapes in background
        for (const product of products) {
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

                    await supabase
                        .from('tracked_products')
                        .update({
                            current_price: result.price,
                            current_stock: result.stock,
                            last_scraped_at: result.scrapedAt,
                        })
                        .eq('id', product.id);
                }
            } catch (err) {
                console.error(`Scrape error for product ${product.store_product_id}:`, err.message);
            }
        }

        console.log('[API] Scrape-all completed');
    } catch (error) {
        console.error('Scrape-all error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to trigger scrape-all' });
        }
    }
});

module.exports = router;
