/**
 * Standalone scrape runner - can be invoked manually or by a cron job.
 * Usage:
 *   node src/scraper/run.js              - Run in headless mode
 *   node src/scraper/run.js --headed     - Run in headed mode (observable)
 *   node src/scraper/run.js --product=5  - Scrape specific product only
 */
require('dotenv').config();
const supabase = require('../config/supabase');
const { scrapeProductPrice, fetchProductDetails } = require('./scraper');

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const specificProduct = args.find(a => a.startsWith('--product='));
const productIdFilter = specificProduct ? parseInt(specificProduct.split('=')[1]) : null;

async function runScraper() {
    console.log('='.repeat(60));
    console.log(`[Scraper] Starting scrape run at ${new Date().toISOString()}`);
    console.log(`[Scraper] Mode: ${headed ? 'HEADED (observable)' : 'HEADLESS'}`);
    console.log('='.repeat(60));

    try {
        // Get all tracked products from Supabase
        let query = supabase.from('tracked_products').select('*').eq('active', true);

        if (productIdFilter) {
            query = query.eq('store_product_id', productIdFilter);
        }

        const { data: trackedProducts, error } = await query;

        if (error) {
            console.error('[Scraper] Error fetching tracked products:', error.message);
            process.exit(1);
        }

        if (!trackedProducts || trackedProducts.length === 0) {
            console.log('[Scraper] No tracked products found. Add products from the frontend first.');
            process.exit(0);
        }

        console.log(`[Scraper] Found ${trackedProducts.length} tracked product(s)\n`);

        let successCount = 0;
        let failCount = 0;

        for (const product of trackedProducts) {
            console.log(`\n--- Scraping: ${product.name} (ID: ${product.store_product_id}) ---`);

            const result = await scrapeProductPrice(product.store_product_id, {
                headed,
                maxRetries: 3,
            });

            // Log the scrape attempt
            const logEntry = {
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
            };

            const { error: logError } = await supabase.from('scrape_logs').insert(logEntry);
            if (logError) {
                console.error('[Scraper] Error saving scrape log:', logError.message);
            }

            if (result.success) {
                successCount++;
                console.log(`  ✅ Price: ₹${result.price} | Stock: ${result.stock} | Duration: ${result.duration}ms`);

                // Save price history
                const historyEntry = {
                    tracked_product_id: product.id,
                    store_product_id: product.store_product_id,
                    price: result.price,
                    original_price: result.originalPrice,
                    stock: result.stock,
                    recorded_at: result.scrapedAt,
                };

                const { error: histError } = await supabase.from('price_history').insert(historyEntry);
                if (histError) {
                    console.error('[Scraper] Error saving price history:', histError.message);
                }

                // Update the tracked product with latest price/stock
                const { error: updateError } = await supabase
                    .from('tracked_products')
                    .update({
                        current_price: result.price,
                        current_stock: result.stock,
                        last_scraped_at: result.scrapedAt,
                    })
                    .eq('id', product.id);

                if (updateError) {
                    console.error('[Scraper] Error updating tracked product:', updateError.message);
                }
            } else {
                failCount++;
                console.log(`  ❌ Failed: ${result.error} | Duration: ${result.duration}ms`);
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log(`[Scraper] Completed. Success: ${successCount}, Failed: ${failCount}`);
        console.log('='.repeat(60));
    } catch (error) {
        console.error('[Scraper] Fatal error:', error);
        process.exit(1);
    }
}

runScraper().then(() => process.exit(0));
