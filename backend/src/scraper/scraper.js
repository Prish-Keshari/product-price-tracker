const axios = require('axios');
const cheerio = require('cheerio');

const MOCK_STORE_BASE =
    process.env.MOCK_STORE_BASE_URL || 'https://demo.inelabteamdev.com';

/**
 * Fetch the layout configuration from the mock store.
 */
async function fetchLayout() {
    const res = await axios.get(`${MOCK_STORE_BASE}/api/layout`, {
        timeout: 15000,
    });

    return res.data;
}

/**
 * Search the catalog for products matching a query.
 */
async function searchCatalog(query, page = 1, pageSize = 20) {
    const res = await axios.get(`${MOCK_STORE_BASE}/api/catalog`, {
        params: { page, pageSize },
        timeout: 15000,
    });

    const data = res.data;

    if (query && query.trim()) {
        const q = query.toLowerCase().trim();

        data.items = data.items.filter(
            (item) =>
                item.name.toLowerCase().includes(q) ||
                item.brand.toLowerCase().includes(q) ||
                item.category.toLowerCase().includes(q) ||
                item.sku.toLowerCase().includes(q)
        );
    }

    return data;
}

/**
 * Search across multiple pages of catalog.
 */
async function deepSearchCatalog(query, maxPages = 10) {
    const results = [];
    const q = query.toLowerCase().trim();

    for (let page = 1; page <= maxPages; page++) {
        try {
            const res = await axios.get(`${MOCK_STORE_BASE}/api/catalog`, {
                params: {
                    page,
                    pageSize: 100,
                },
                timeout: 15000,
            });

            const matching = res.data.items.filter(
                (item) =>
                    item.name.toLowerCase().includes(q) ||
                    item.brand.toLowerCase().includes(q) ||
                    item.category.toLowerCase().includes(q) ||
                    item.sku.toLowerCase().includes(q)
            );

            results.push(...matching);

            if (results.length >= 50 || page >= res.data.pages) {
                break;
            }
        } catch (err) {
            console.error(
                `Error fetching catalog page ${page}:`,
                err.message
            );
            break;
        }
    }

    return results.slice(0, 50);
}

/**
 * Fetch full product details.
 */
async function fetchProductDetails(productId) {
    const res = await axios.get(
        `${MOCK_STORE_BASE}/api/product/${productId}`,
        {
            timeout: 15000,
        }
    );

    return res.data;
}

/**
 * Scrape product price and stock.
 */
async function scrapeProductPrice(productId, options = {}) {
    const startTime = Date.now();
    const maxRetries = options.maxRetries || 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(
                `[Scraper] Attempt ${attempt}/${maxRetries} for product ${productId}`
            );

            const layout = await fetchLayout();

            const result = await scrapeWithPlaywright(
                productId,
                layout,
                options.headed || false
            );

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

            console.error(
                `[Scraper] Attempt ${attempt} failed for product ${productId}:`,
                error.message
            );

            if (attempt < maxRetries) {
                const waitMs = Math.pow(2, attempt) * 1000;

                console.log(`[Scraper] Retrying in ${waitMs}ms...`);

                await new Promise((resolve) =>
                    setTimeout(resolve, waitMs)
                );
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
 * Remove the cookie overlay from the page.
 */
async function removeCookieOverlay(page) {
    try {
        await page.evaluate(() => {
            const removeOverlay = () => {
                document
                    .querySelectorAll('.cookie-overlay')
                    .forEach((el) => {
                        el.remove();
                    });
            };

            removeOverlay();

            // Also disable pointer events if the overlay is recreated.
            document
                .querySelectorAll('.cookie-overlay')
                .forEach((el) => {
                    el.style.display = 'none';
                    el.style.visibility = 'hidden';
                    el.style.pointerEvents = 'none';
                });
        });
    } catch (error) {
        console.log(
            '[Scraper] Cookie overlay removal:',
            error.message
        );
    }
}

/**
 * Use Playwright to render product page and extract price/stock.
 */
async function scrapeWithPlaywright(productId, layout, headed = false) {
    let browser = null;

    try {
        const { chromium } = require('playwright');

        console.log(`[Scraper] Starting Playwright for product ${productId}`);

        browser = await chromium.launch({
            headless: !headed,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const context = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: {
                width: 1366,
                height: 768
            }
        });

        /*
         * Remove cookie overlays as early as possible.
         */
        await context.addInitScript(() => {
            const removeCookieOverlay = () => {
                const selectors = [
                    '.cookie-overlay',
                    '[class*="cookie-overlay"]',
                    '[id*="cookie-overlay"]',
                    '[class*="cookie"]',
                    '[id*="cookie"]'
                ];

                selectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => {
                        try {
                            el.remove();
                        } catch (_) {
                            try {
                                el.style.display = 'none';
                                el.style.visibility = 'hidden';
                                el.style.pointerEvents = 'none';
                            } catch (_) { }
                        }
                    });
                });
            };

            removeCookieOverlay();

            const observer = new MutationObserver(() => {
                removeCookieOverlay();
            });

            const startObserver = () => {
                if (document.documentElement) {
                    observer.observe(document.documentElement, {
                        childList: true,
                        subtree: true
                    });
                }
            };

            if (document.readyState === 'loading') {
                document.addEventListener(
                    'DOMContentLoaded',
                    startObserver,
                    { once: true }
                );
            } else {
                startObserver();
            }
        });

        const page = await context.newPage();

        /*
         * Navigate to product page.
         */
        const productUrl =
            `${MOCK_STORE_BASE}/product/${productId}`;

        console.log(`[Scraper] Opening: ${productUrl}`);

        await page.goto(productUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        /*
         * Allow React/JavaScript to render.
         */
        await page.waitForTimeout(3000);

        /*
         * Remove cookie overlays and disable them with CSS.
         */
        const disableCookieOverlay = async () => {
            try {
                await page.addStyleTag({
                    content: `
                        .cookie-overlay,
                        [class*="cookie-overlay"],
                        [id*="cookie-overlay"],
                        [class*="cookie"],
                        [id*="cookie"] {
                            display: none !important;
                            visibility: hidden !important;
                            opacity: 0 !important;
                            pointer-events: none !important;
                            z-index: -999999 !important;
                        }
                    `
                });
            } catch (_) { }

            try {
                await page.evaluate(() => {
                    const selectors = [
                        '.cookie-overlay',
                        '[class*="cookie-overlay"]',
                        '[id*="cookie-overlay"]'
                    ];

                    selectors.forEach(selector => {
                        document.querySelectorAll(selector).forEach(el => {
                            el.remove();
                        });
                    });
                });
            } catch (_) { }
        };

        await disableCookieOverlay();

        /*
         * Get dynamic classes from layout.
         */
        const priceWrapClass =
            layout?.classes?.priceWrap || 'pw-m4';

        const priceValueClass =
            layout?.classes?.priceValue || 'pv-m4';

        const stockClass =
            layout?.classes?.stock || 'st-m4';

        const saleClass =
            layout?.classes?.sale || 'sl-m4';

        const mrpClass =
            layout?.classes?.mrp || 'mr-m4';

        const priceTag =
            layout?.priceTag || 'output';

        console.log(
            `[Scraper] Price wrapper: ${priceWrapClass}`
        );

        console.log(
            `[Scraper] Price value class: ${priceValueClass}`
        );

        console.log(
            `[Scraper] Sale class: ${saleClass}`
        );

        console.log(
            `[Scraper] MRP class: ${mrpClass}`
        );

        /*
         * Create selectors.
         */
        const makeClassSelector = className => {
            return className
                .split(/\s+/)
                .filter(Boolean)
                .map(name => `.${name}`)
                .join('');
        };

        const priceWrapSelector =
            makeClassSelector(priceWrapClass);

        const priceValueSelector =
            makeClassSelector(priceValueClass);

        const saleSelector =
            makeClassSelector(saleClass);

        const mrpSelector =
            makeClassSelector(mrpClass);

        const stockSelector =
            makeClassSelector(stockClass);

        /*
         * Locate price wrapper.
         */
        const priceWrap =
            page.locator(priceWrapSelector).first();

        const wrapperCount =
            await priceWrap.count();

        console.log(
            `[Scraper] Price wrapper count: ${wrapperCount}`
        );

        if (wrapperCount === 0) {
            console.log(
                `[Scraper] Price wrapper not found: ${priceWrapClass}`
            );

            /*
             * Try locating price directly if wrapper is missing.
             */
            const directPrice =
                page.locator(
                    `${saleSelector}, ${priceValueSelector}, ${priceTag}`
                ).first();

            if (await directPrice.count() === 0) {
                return null;
            }
        }

        /*
         * Remove cookie overlay immediately before interaction.
         */
        await disableCookieOverlay();

        /*
         * Scroll to price section.
         */
        if (wrapperCount > 0) {
            try {
                await priceWrap.scrollIntoViewIfNeeded();
            } catch (_) { }
        }

        await page.waitForTimeout(500);

        /*
         * Get price wrapper bounding box.
         */
        let box = null;

        if (wrapperCount > 0) {
            box = await priceWrap.boundingBox();
        }

        /*
         * Trigger hover manually using mouse.
         *
         * We intentionally DO NOT use locator.hover().
         * Your Render logs showed that Playwright's hover action
         * was repeatedly blocked by cookie-overlay.
         */
        if (box) {
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;

            console.log(
                `[Scraper] Moving mouse to price area: ${centerX}, ${centerY}`
            );

            await page.mouse.move(
                centerX,
                centerY,
                { steps: 10 }
            );

            await page.waitForTimeout(1000);

            /*
             * Move around the price area to trigger
             * mouseenter / mousemove / hover listeners.
             */
            await page.mouse.move(
                box.x + box.width * 0.25,
                box.y + box.height * 0.5,
                { steps: 5 }
            );

            await page.waitForTimeout(500);

            await page.mouse.move(
                box.x + box.width * 0.75,
                box.y + box.height * 0.5,
                { steps: 5 }
            );

            await page.waitForTimeout(3000);

            console.log(
                '[Scraper] Price hover/dwell completed'
            );
        }

        /*
         * Dispatch JavaScript mouse/pointer events directly.
         * This handles stores that use event listeners instead
         * of pure CSS :hover.
         */
        if (wrapperCount > 0) {
            try {
                await priceWrap.evaluate(element => {
                    const events = [
                        'pointerover',
                        'pointerenter',
                        'mouseover',
                        'mouseenter',
                        'mousemove'
                    ];

                    events.forEach(type => {
                        try {
                            element.dispatchEvent(
                                new MouseEvent(type, {
                                    bubbles: true,
                                    cancelable: true,
                                    view: window
                                })
                            );
                        } catch (_) { }
                    });
                });
            } catch (error) {
                console.log(
                    '[Scraper] Event dispatch skipped:',
                    error.message
                );
            }
        }

        /*
         * Give the price reveal animation enough time.
         */
        await page.waitForTimeout(3000);

        /*
         * Some layouts require clicking the price area.
         * Use mouse click instead of locator.click() so that
         * Playwright actionability checks cannot get stuck.
         */
        if (box) {
            try {
                await disableCookieOverlay();

                await page.mouse.click(
                    box.x + box.width / 2,
                    box.y + box.height / 2
                );

                console.log(
                    '[Scraper] Price wrapper clicked'
                );

                await page.waitForTimeout(2000);
            } catch (error) {
                console.log(
                    '[Scraper] Click skipped:',
                    error.message
                );
            }
        }

        /*
         * Remove overlay again in case it was recreated.
         */
        await disableCookieOverlay();

        /*
         * Read the actual price wrapper HTML.
         * This is extremely useful when debugging Render.
         */
        let priceHtml = '';

        if (wrapperCount > 0) {
            try {
                priceHtml = await priceWrap.evaluate(
                    element => element.outerHTML
                );

                console.log(
                    '[Scraper] Price wrapper HTML:',
                    priceHtml.substring(0, 2500)
                );
            } catch (_) { }
        }

        /*
         * Extract price from the rendered DOM.
         *
         * IMPORTANT:
         * We first search INSIDE the price wrapper.
         * This prevents unrelated numbers on the page
         * from being selected as the product price.
         */
        const priceData = await page.evaluate(
            ({
                priceWrapSelector,
                priceValueSelector,
                saleSelector,
                mrpSelector,
                stockSelector,
                priceTag
            }) => {

                const cleanText = value => {
                    if (!value) return null;

                    return String(value)
                        .replace(/\s+/g, ' ')
                        .trim();
                };

                /*
                 * Extract currency/number from text.
                 */
                const extractPrice = value => {
                    const text = cleanText(value);

                    if (!text) return null;

                    /*
                     * Currency formats:
                     * ₹1,999
                     * ₹ 1,999
                     * Rs. 1,999
                     * INR 1,999
                     * $99
                     * €99
                     * £99
                     */
                    const currencyMatch = text.match(
                        /(?:₹|Rs\.?|INR|\$|€|£)\s*[\d,]+(?:\.\d{1,2})?/i
                    );

                    if (currencyMatch) {
                        return currencyMatch[0]
                            .replace(/\s+/g, ' ')
                            .trim();
                    }

                    /*
                     * Plain numeric fallback.
                     */
                    const numberMatch = text.match(
                        /\b\d[\d,]*(?:\.\d{1,2})?\b/
                    );

                    return numberMatch
                        ? numberMatch[0]
                        : null;
                };

                /*
                 * Safely get text from an element.
                 */
                const getText = element => {
                    if (!element) return null;

                    const values = [
                        element.textContent,
                        element.innerText,
                        element.getAttribute('aria-label'),
                        element.getAttribute('title'),
                        element.getAttribute('data-price'),
                        element.getAttribute('data-value'),
                        element.getAttribute('content')
                    ];

                    for (const value of values) {
                        const text = cleanText(value);

                        if (text) {
                            return text;
                        }
                    }

                    return null;
                };

                /*
                 * Find the wrapper.
                 */
                let wrapper =
                    document.querySelector(priceWrapSelector);

                /*
                 * Find price element.
                 */
                let priceElement = null;

                if (wrapper) {
                    priceElement =
                        wrapper.querySelector(saleSelector);

                    if (!priceElement) {
                        priceElement =
                            wrapper.querySelector(priceValueSelector);
                    }

                    if (!priceElement) {
                        priceElement =
                            wrapper.querySelector(priceTag);
                    }
                }

                /*
                 * Global fallback.
                 */
                if (!priceElement) {
                    priceElement =
                        document.querySelector(saleSelector);
                }

                if (!priceElement) {
                    priceElement =
                        document.querySelector(priceValueSelector);
                }

                if (!priceElement) {
                    priceElement =
                        document.querySelector(priceTag);
                }

                /*
                 * Extract current price.
                 */
                let price = null;

                if (priceElement) {
                    price =
                        extractPrice(getText(priceElement));
                }

                /*
                 * Try all relevant elements inside wrapper.
                 */
                if (!price && wrapper) {
                    const elements = wrapper.querySelectorAll(
                        `${saleSelector}, ${priceValueSelector}, ${priceTag}, ` +
                        '[data-price], [data-value], [aria-label], [title]'
                    );

                    for (const element of elements) {
                        const value =
                            extractPrice(getText(element));

                        if (value) {
                            price = value;
                            break;
                        }
                    }
                }

                /*
                 * Wrapper text fallback.
                 */
                if (!price && wrapper) {
                    price =
                        extractPrice(getText(wrapper));
                }

                /*
                 * Final page-wide price fallback.
                 */
                if (!price) {
                    const candidates =
                        document.querySelectorAll(
                            `${saleSelector}, ${priceValueSelector}, ` +
                            '[data-price], [data-value], output, ' +
                            '[class*="price"], [class*="Price"]'
                        );

                    for (const element of candidates) {
                        const value =
                            extractPrice(getText(element));

                        if (value) {
                            price = value;
                            break;
                        }
                    }
                }

                /*
                 * Original/MRP price.
                 */
                let originalPrice = null;

                let mrpElement = null;

                if (wrapper) {
                    mrpElement =
                        wrapper.querySelector(mrpSelector);
                }

                if (!mrpElement) {
                    mrpElement =
                        document.querySelector(mrpSelector);
                }

                if (mrpElement) {
                    originalPrice =
                        extractPrice(getText(mrpElement));
                }

                /*
                 * Stock information.
                 */
                let stock = null;

                let stockElement = null;

                if (wrapper) {
                    stockElement =
                        wrapper.querySelector(stockSelector);
                }

                if (!stockElement) {
                    stockElement =
                        document.querySelector(stockSelector);
                }

                if (stockElement) {
                    stock = cleanText(
                        getText(stockElement)
                    );
                }

                /*
                 * Additional stock fallback.
                 */
                if (!stock && wrapper) {
                    const wrapperText =
                        cleanText(wrapper.innerText);

                    if (wrapperText) {
                        if (/out\s*of\s*stock/i.test(wrapperText)) {
                            stock = 'Out of stock';
                        } else if (/in\s*stock/i.test(wrapperText)) {
                            stock = 'In stock';
                        }
                    }
                }

                return {
                    price,
                    originalPrice,
                    stock,

                    /*
                     * Debug information.
                     */
                    wrapperText:
                        wrapper
                            ? cleanText(wrapper.innerText)
                            : null,

                    priceElementText:
                        priceElement
                            ? cleanText(getText(priceElement))
                            : null
                };
            },
            {
                priceWrapSelector,
                priceValueSelector,
                saleSelector,
                mrpSelector,
                stockSelector,
                priceTag
            }
        );

        console.log(
            '[Scraper] Extracted price:',
            priceData.price
        );

        console.log(
            '[Scraper] Extracted original price:',
            priceData.originalPrice
        );

        console.log(
            '[Scraper] Extracted stock:',
            priceData.stock
        );

        console.log(
            '[Scraper] Wrapper text:',
            priceData.wrapperText
        );

        console.log(
            '[Scraper] Price element text:',
            priceData.priceElementText
        );

        /*
         * Final validation.
         */
        if (!priceData.price) {
            console.log(
                `[Scraper] Price extraction returned null for product ${productId}`
            );

            return null;
        }

        /*
         * Successful result.
         */
        console.log(
            `[Scraper] Successfully extracted price for product ${productId}: ${priceData.price}`
        );

        return {
            price: priceData.price,
            originalPrice: priceData.originalPrice,
            stock: priceData.stock
        };

    } catch (error) {

        console.error(
            `[Scraper] Playwright error for product ${productId}:`,
            error.message
        );

        return null;

    } finally {

        if (browser) {
            try {
                await browser.close();
            } catch (error) {
                console.log(
                    '[Scraper] Browser close error:',
                    error.message
                );
            }
        }
    }
}