const axios = require('axios');
const cheerio = require('cheerio');

const MOCK_STORE_BASE = process.env.MOCK_STORE_BASE_URL || 'https://demo.inelabteamdev.com';

/**
 * Fetch the layout configuration from the mock store.
 * This contains dynamic CSS class names for price elements and other UI config.
 */
async function fetchLayout() {
    const res = await axios.get(`${MOCK_STORE_BASE}/api/layout`, { timeout: 15000 });
    return res.data;
}

/**
 * Search the catalog for products matching a query.
 * Returns paginated results from the mock store's catalog API.
 */
async function searchCatalog(query, page = 1, pageSize = 20) {
    const res = await axios.get(`${MOCK_STORE_BASE}/api/catalog`, {
        params: { page, pageSize },
        timeout: 15000,
    });
    const data = res.data;

    // Filter by name/brand/category if query provided
    if (query && query.trim()) {
        const q = query.toLowerCase().trim();
        data.items = data.items.filter(item =>
            item.name.toLowerCase().includes(q) ||
            item.brand.toLowerCase().includes(q) ||
            item.category.toLowerCase().includes(q) ||
            item.sku.toLowerCase().includes(q)
        );
    }

    return data;
}

/**
 * Search across multiple pages of catalog for better results.
 */
async function deepSearchCatalog(query, maxPages = 10) {
    const results = [];
    const q = query.toLowerCase().trim();

    for (let page = 1; page <= maxPages; page++) {
        try {
            const res = await axios.get(`${MOCK_STORE_BASE}/api/catalog`, {
                params: { page, pageSize: 100 },
                timeout: 15000,
            });

            const matching = res.data.items.filter(item =>
                item.name.toLowerCase().includes(q) ||
                item.brand.toLowerCase().includes(q) ||
                item.category.toLowerCase().includes(q) ||
                item.sku.toLowerCase().includes(q)
            );

            results.push(...matching);

            // If we have enough results or reached the end
            if (results.length >= 50 || page >= res.data.pages) break;
        } catch (err) {
            console.error(`Error fetching catalog page ${page}:`, err.message);
            break;
        }
    }

    return results.slice(0, 50);
}

/**
 * Fetch full product details from the mock store.
 */
async function fetchProductDetails(productId) {
    const res = await axios.get(`${MOCK_STORE_BASE}/api/product/${productId}`, { timeout: 15000 });
    return res.data;
}

/**
 * Scrape the product page to extract price and stock information.
 * 
 * The mock store uses dynamic CSS classes from /api/layout to obfuscate price data.
 * Price is rendered as a split value (priceCarrier: "split") inside an <output> tag (priceTag: "output").
 * 
 * Strategy:
 * 1. GET the layout config for current CSS class names
 * 2. GET the product page HTML
 * 3. Use Playwright to render the page and extract price/stock from the dynamically-generated DOM
 * 
 * If Playwright is not available, falls back to API-based extraction attempts.
 */
async function scrapeProductPrice(productId, options = {}) {
    const startTime = Date.now();
    const maxRetries = options.maxRetries || 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[Scraper] Attempt ${attempt}/${maxRetries} for product ${productId}`);

            // First, get the layout config to know CSS class names
            const layout = await fetchLayout();

            // Try lightweight approach first: fetch product page and parse
            const result = await scrapeWithPlaywright(productId, layout, options.headed || false);

            if (result && result.price !== null) {
                return {
                    success: true,
                    productId,
                    price: result.price,
                    originalPrice: result.originalPrice,
                    stock: result.stock,
                    scrapedAt: new Date().toISOString(),
                    duration: Date.now() - startTime,
                    attempt,
                    method: 'playwright',
                };
            }

            throw new Error('Price extraction returned null');
        } catch (error) {
            lastError = error;
            console.error(`[Scraper] Attempt ${attempt} failed for product ${productId}:`, error.message);

            if (attempt < maxRetries) {
                // Exponential backoff: 2s, 4s, 8s...
                const waitMs = Math.pow(2, attempt) * 1000;
                console.log(`[Scraper] Retrying in ${waitMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }
    }

    return {
        success: false,
        productId,
        price: null,
        originalPrice: null,
        stock: null,
        scrapedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
        attempt: maxRetries,
        method: 'playwright',
        error: lastError?.message || 'Unknown error',
    };
}

/**
 * Use Playwright to render the product page and extract price/stock.
 * The mock store requires JS execution and mouse interaction (hover dwell) to reveal prices.
 */
async function scrapeWithPlaywright(productId, layout, headed = false) {
    let browser = null;

    try {
        const { chromium } = require('playwright');

        browser = await chromium.launch({
            headless: !headed,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });
        await context.addInitScript(() => {
            const removeCookieOverlay = () => {
                document.querySelectorAll('.cookie-overlay').forEach(el => {
                    el.remove();
                });
            };

            removeCookieOverlay();

            const observer = new MutationObserver(() => {
                removeCookieOverlay();
            });

            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        });
        const page = await context.newPage();

        // Navigate to product page
        await page.goto(`${MOCK_STORE_BASE}/product/${productId}`, {
            waitUntil: 'networkidle',
            timeout: 30000,
        });


        // Wait for the page content to load
        await page.waitForTimeout(2000);

        // The price block requires hovering/dwelling to reveal. 
        // Try to find and interact with the price container
        const priceWrapClass = layout.classes?.priceWrap || 'pw-m4';
        const priceValueClass = layout.classes?.priceValue || 'pv-m4';
        const stockClass = layout.classes?.stock || 'st-m4';
        const saleClass = layout.classes?.sale || 'sl-m4';
        const mrpClass = layout.classes?.mrp || 'mr-m4';
        const priceTag = layout.priceTag || 'output';

        // Move mouse to the price area to trigger hover reveal
        // Move mouse to the price area to trigger hover reveal
        try {
            const priceWrap = page.locator(`.${priceWrapClass}`).first();

            if (await priceWrap.count()) {
                await priceWrap.scrollIntoViewIfNeeded();

                await priceWrap.hover({
                    force: true,
                    timeout: 10000
                });

                await page.waitForTimeout(3000);

                try {
                    await priceWrap.click({
                        force: true,
                        timeout: 2000
                    });
                } catch { }

                await page.waitForTimeout(2000);
            } else {
                console.log('[Scraper] Price wrapper not found:', priceWrapClass);
            }
        } catch (e) {
            console.log('[Scraper] Price reveal interaction:', e.message);
        }
        console.log('[Scraper] Price wrapper:', priceWrapClass);
        console.log('[Scraper] Price value class:', priceValueClass);
        console.log('[Scraper] Sale class:', saleClass);
        console.log('[Scraper] MRP class:', mrpClass);
        // Extract price from the rendered page
        const priceData = await page.evaluate(({ priceValueClass, stockClass, saleClass, mrpClass, priceTag }) => {
            let price = null;
            let originalPrice = null;
            let stock = null;

            // Try to find price elements using the dynamic class names
            // Sale price (current/discounted price)
            const saleEl = document.querySelector(`.${saleClass}`);
            if (saleEl) {
                const saleText = saleEl.textContent.trim();
                const saleMatch = saleText.match(/[\d,]+\.?\d*/);
                if (saleMatch) price = parseFloat(saleMatch[0].replace(/,/g, ''));
            }

            // MRP (original price)
            const mrpEl = document.querySelector(`.${mrpClass}`);
            if (mrpEl) {
                const mrpText = mrpEl.textContent.trim();
                const mrpMatch = mrpText.match(/[\d,]+\.?\d*/);
                if (mrpMatch) originalPrice = parseFloat(mrpMatch[0].replace(/,/g, ''));
            }

            // If no separate sale/mrp, try the priceValue class
            if (price === null) {
                const pvEl = document.querySelector(`.${priceValueClass}`);
                if (pvEl) {
                    const pvText = pvEl.textContent.trim();
                    const pvMatch = pvText.match(/[\d,]+\.?\d*/);
                    if (pvMatch) price = parseFloat(pvMatch[0].replace(/,/g, ''));
                }
            }

            // Try the price tag (output element)
            if (price === null) {
                const outputEl = document.querySelector(priceTag);
                if (outputEl) {
                    const outputText = outputEl.textContent.trim();
                    const outputMatch = outputText.match(/[\d,]+\.?\d*/);
                    if (outputMatch) price = parseFloat(outputMatch[0].replace(/,/g, ''));
                }
            }

            // Brute force: search all text content for ₹ symbol
            if (price === null) {
                const allText = document.body.innerText;
                const priceMatches = allText.match(/₹\s*[\d,]+\.?\d*/g);
                if (priceMatches && priceMatches.length > 0) {
                    const firstPrice = priceMatches[0].replace(/₹\s*/, '').replace(/,/g, '');
                    price = parseFloat(firstPrice);
                    if (priceMatches.length > 1) {
                        const secondPrice = priceMatches[1].replace(/₹\s*/, '').replace(/,/g, '');
                        originalPrice = parseFloat(secondPrice);
                    }
                }
            }

            // Extract stock information
            const stockEl = document.querySelector(`.${stockClass}`);
            if (stockEl) {
                const stockText = stockEl.textContent.trim().toLowerCase();
                if (stockText.includes('in stock')) {
                    const stockMatch = stockText.match(/(\d+)/);
                    stock = stockMatch ? parseInt(stockMatch[1]) : -1; // -1 means "in stock" but quantity unknown
                } else if (stockText.includes('out of stock')) {
                    stock = 0;
                } else {
                    const stockMatch = stockText.match(/(\d+)/);
                    stock = stockMatch ? parseInt(stockMatch[1]) : null;
                }
            }

            // Fallback: search for stock text in page  
            if (stock === null) {
                const allText = document.body.innerText.toLowerCase();
                if (allText.includes('out of stock')) {
                    stock = 0;
                } else if (allText.includes('in stock')) {
                    const stockMatch = allText.match(/(\d+)\s*(?:left|remaining|in stock|available)/i);
                    stock = stockMatch ? parseInt(stockMatch[1]) : -1;
                }
            }

            return { price, originalPrice, stock };
        }, { priceValueClass, stockClass, saleClass, mrpClass, priceTag });

        await browser.close();
        return priceData;
    } catch (error) {
        if (browser) await browser.close().catch(() => { });
        throw error;
    }
}

module.exports = {
    fetchLayout,
    searchCatalog,
    deepSearchCatalog,
    fetchProductDetails,
    scrapeProductPrice,
};
