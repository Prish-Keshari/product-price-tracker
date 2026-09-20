const axios = require('axios');

const MOCK_STORE_BASE =
    process.env.MOCK_STORE_BASE_URL || 'https://demo.inelabteamdev.com';

/**
 * Fetch dynamic layout configuration.
 */
async function fetchLayout() {
    const res = await axios.get(
        `${MOCK_STORE_BASE}/api/layout`,
        { timeout: 15000 }
    );

    return res.data;
}

/**
 * Search catalog.
 */
async function searchCatalog(query, page = 1, pageSize = 20) {
    const res = await axios.get(
        `${MOCK_STORE_BASE}/api/catalog`,
        {
            params: { page, pageSize },
            timeout: 15000,
        }
    );

    const data = res.data;

    if (query && query.trim()) {
        const q = query.toLowerCase().trim();

        data.items = data.items.filter(
            (item) =>
                item.name?.toLowerCase().includes(q) ||
                item.brand?.toLowerCase().includes(q) ||
                item.category?.toLowerCase().includes(q) ||
                item.sku?.toLowerCase().includes(q)
        );
    }

    return data;
}

/**
 * Search across catalog pages.
 */
async function deepSearchCatalog(query, maxPages = 10) {
    const results = [];
    const q = query.toLowerCase().trim();

    for (let page = 1; page <= maxPages; page++) {
        try {
            const res = await axios.get(
                `${MOCK_STORE_BASE}/api/catalog`,
                {
                    params: {
                        page,
                        pageSize: 100,
                    },
                    timeout: 15000,
                }
            );

            const matching = res.data.items.filter(
                (item) =>
                    item.name?.toLowerCase().includes(q) ||
                    item.brand?.toLowerCase().includes(q) ||
                    item.category?.toLowerCase().includes(q) ||
                    item.sku?.toLowerCase().includes(q)
            );

            results.push(...matching);

            if (
                results.length >= 50 ||
                page >= res.data.pages
            ) {
                break;
            }
        } catch (error) {
            console.error(
                `[Scraper] Catalog page ${page} error:`,
                error.message
            );

            break;
        }
    }

    return results.slice(0, 50);
}

/**
 * Fetch product details.
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
 * Main scraper.
 *
 * Important:
 * - Handles delayed cookie popup.
 * - Detects the grey/frozen page state.
 * - Reloads when initialization gets stuck.
 * - Accepts cookies normally.
 * - Hovers over price area.
 * - Waits for Reveal Price to become enabled.
 * - Clicks Reveal Price.
 * - Extracts price, MRP and stock.
 */
async function scrapeProductPrice(productId, options = {}) {
    const startTime = Date.now();

    const maxRetries = options.maxRetries || 3;
    const headed = options.headed || false;

    let lastError = null;

    for (
        let attempt = 1;
        attempt <= maxRetries;
        attempt++
    ) {
        console.log(
            `[Scraper] Attempt ${attempt}/${maxRetries}`
        );

        console.log(
            `[Scraper] Starting product: ${productId}`
        );

        try {
            const layout = await fetchLayout();

            const result = await scrapeWithPlaywright(
                productId,
                layout,
                headed
            );

            if (
                result &&
                result.price !== null &&
                result.price > 0
            ) {
                console.log(
                    `[Scraper] SUCCESS - Price: ${result.price}`
                );

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

            throw new Error(
                'Price extraction returned null'
            );
        } catch (error) {
            lastError = error;

            console.error(
                `[Scraper] Attempt ${attempt} failed:`,
                error.message
            );

            if (attempt < maxRetries) {
                const waitMs =
                    Math.pow(2, attempt) * 1000;

                console.log(
                    `[Scraper] Retrying in ${waitMs}ms`
                );

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
        error:
            lastError?.message ||
            'Unknown scraper error',
    };
}

/**
 * Handle cookie popup.
 *
 * We DO NOT remove the cookie overlay before handling it.
 *
 * The site can take 2-3 seconds to create the popup.
 */
async function handleCookieConsent(page) {
    console.log(
        '[Scraper] Checking for cookie consent...'
    );

    const acceptButton = page
        .getByRole('button', {
            name: /^accept$/i,
        })
        .first();

    try {
        await acceptButton.waitFor({
            state: 'visible',
            timeout: 8000,
        });

        console.log(
            '[Scraper] Cookie consent found'
        );

        await acceptButton.click({
            timeout: 5000,
        });

        console.log(
            '[Scraper] Cookie ACCEPT clicked'
        );

        /*
         * Give the site's JS time to remove the
         * modal/backdrop.
         */
        await page.waitForTimeout(1000);

        /*
         * Wait for cookie overlay to disappear.
         */
        const overlay = page.locator(
            '.cookie-overlay'
        ).first();

        if (await overlay.count()) {
            await overlay
                .waitFor({
                    state: 'hidden',
                    timeout: 5000,
                })
                .catch(() => { });
        }

        await page.waitForTimeout(500);

        console.log(
            '[Scraper] Cookie handling completed'
        );

        return true;
    } catch (error) {
        console.log(
            '[Scraper] Cookie button not found yet'
        );

        return false;
    }
}

/**
 * Detect whether the page is stuck behind the
 * grey cookie/modal overlay.
 */
async function isPageBlocked(page) {
    try {
        return await page.evaluate(() => {
            const overlay = document.querySelector(
                '.cookie-overlay'
            );

            if (!overlay) {
                return false;
            }

            const style =
                window.getComputedStyle(overlay);

            const rect =
                overlay.getBoundingClientRect();

            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                parseFloat(style.opacity || '1') > 0 &&
                rect.width > 0 &&
                rect.height > 0
            );
        });
    } catch {
        return false;
    }
}

/**
 * Wait for the page to initialize.
 *
 * If the site gets stuck with the grey overlay
 * and the cookie button never appears, reload.
 */
async function initializePage(page, productId) {
    console.log(
        '[Scraper] Waiting for page initialization...'
    );

    await page.waitForTimeout(2500);

    /*
     * First try to handle cookie popup.
     */
    const cookieHandled =
        await handleCookieConsent(page);

    if (cookieHandled) {
        return;
    }

    /*
     * Cookie popup may not have appeared yet.
     * Give it another chance.
     */
    console.log(
        '[Scraper] Cookie not visible yet - waiting...'
    );

    await page.waitForTimeout(2500);

    const cookieHandledAgain =
        await handleCookieConsent(page);

    if (cookieHandledAgain) {
        return;
    }

    /*
     * If the page still has the blocking overlay,
     * the site is in the exact broken state seen
     * during manual testing.
     */
    const blocked =
        await isPageBlocked(page);

    if (blocked) {
        console.log(
            '[Scraper] Page appears blocked/frozen'
        );

        console.log(
            '[Scraper] Reloading page...'
        );

        await page.reload({
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });

        await page.waitForTimeout(3000);

        console.log(
            '[Scraper] Page reloaded successfully'
        );

        /*
         * Cookie popup should now appear.
         */
        const accepted =
            await handleCookieConsent(page);

        if (!accepted) {
            console.log(
                '[Scraper] Cookie popup still not found after reload'
            );
        }

        return;
    }

    console.log(
        '[Scraper] No blocking overlay detected - continuing'
    );
}

/**
 * Playwright scraper.
 */
async function scrapeWithPlaywright(
    productId,
    layout,
    headed = false
) {
    let browser = null;

    try {
        const { chromium } = require('playwright');

        browser = await chromium.launch({
            headless: !headed,
            slowMo: headed ? 50 : 0,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
            ],
        });

        const context =
            await browser.newContext({
                userAgent:
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

                viewport: {
                    width: 1366,
                    height: 768,
                },
            });

        const page = await context.newPage();

        page.setDefaultTimeout(15000);

        const productUrl =
            `${MOCK_STORE_BASE}/product/${productId}`;

        console.log(
            `[Scraper] Opening: ${productUrl}`
        );

        /*
         * --------------------------------------------------
         * 1. OPEN PAGE
         * --------------------------------------------------
         */

        await page.goto(productUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });

        /*
         * IMPORTANT:
         *
         * We DO NOT remove the cookie overlay here.
         *
         * The real site needs time to create the cookie
         * popup and its JavaScript state.
         */
        await initializePage(
            page,
            productId
        );

        /*
         * --------------------------------------------------
         * 2. GET DYNAMIC CLASS NAMES
         * --------------------------------------------------
         */

        const priceWrapClass =
            layout?.classes?.priceWrap ||
            'pw-m4';

        const priceValueClass =
            layout?.classes?.priceValue ||
            'pv-m4';

        const stockClass =
            layout?.classes?.stock ||
            'st-m4';

        const saleClass =
            layout?.classes?.sale ||
            'sl-m4';

        const mrpClass =
            layout?.classes?.mrp ||
            'mr-m4';

        const priceTag =
            layout?.priceTag ||
            'output';

        console.log(
            `[Scraper] Price wrapper: ${priceWrapClass}`
        );

        console.log(
            `[Scraper] Price class: ${priceValueClass}`
        );

        /*
         * --------------------------------------------------
         * 3. FIND PRICE WRAPPER
         * --------------------------------------------------
         */

        const priceWrap =
            page
                .locator(`.${priceWrapClass}`)
                .first();

        await priceWrap.waitFor({
            state: 'visible',
            timeout: 20000,
        });

        console.log(
            '[Scraper] Price wrapper found'
        );

        /*
         * --------------------------------------------------
         * 4. HOVER PRICE AREA
         * --------------------------------------------------
         */

        await priceWrap.scrollIntoViewIfNeeded();

        await page.waitForTimeout(500);

        const bounds =
            await priceWrap.boundingBox();

        if (!bounds) {
            throw new Error(
                'Price wrapper has no bounding box'
            );
        }

        console.log(
            '[Scraper] Hovering over price area...'
        );

        /*
         * Start outside and move into the box.
         * This reproduces real mouse movement better
         * than simply calling locator.hover().
         */
        await page.mouse.move(
            bounds.x - 20,
            bounds.y +
            bounds.height / 2
        );

        await page.waitForTimeout(200);

        await page.mouse.move(
            bounds.x +
            bounds.width / 2,
            bounds.y +
            bounds.height / 2,
            {
                steps: 10,
            }
        );

        console.log(
            '[Scraper] Price area hovered successfully'
        );

        /*
         * Give the site's hover timer enough time.
         */
        await page.waitForTimeout(2000);

        /*
         * --------------------------------------------------
         * 5. FIND REVEAL PRICE BUTTON
         * --------------------------------------------------
         */

        const revealButton =
            page
                .getByRole('button', {
                    name: /reveal price/i,
                })
                .first();

        await revealButton.waitFor({
            state: 'visible',
            timeout: 10000,
        });

        console.log(
            '[Scraper] Reveal Price button found'
        );

        /*
         * --------------------------------------------------
         * 6. WAIT FOR BUTTON TO BECOME ENABLED
         * --------------------------------------------------
         *
         * This is the important part.
         *
         * Earlier code waited and then failed.
         * Now we continuously check the actual
         * disabled state.
         */

        let enabled = false;

        for (
            let check = 1;
            check <= 20;
            check++
        ) {
            enabled =
                await revealButton.isEnabled();

            if (enabled) {
                console.log(
                    `[Scraper] Reveal button enabled (${check}/20)`
                );

                break;
            }

            console.log(
                `[Scraper] Reveal button still disabled (${check}/20)`
            );

            /*
             * Re-hover the price area periodically.
             */
            if (check % 4 === 0) {
                const currentBounds =
                    await priceWrap.boundingBox();

                if (currentBounds) {
                    await page.mouse.move(
                        currentBounds.x +
                        currentBounds.width / 2,
                        currentBounds.y +
                        currentBounds.height / 2,
                        {
                            steps: 5,
                        }
                    );
                }
            }

            await page.waitForTimeout(500);
        }

        if (!enabled) {
            throw new Error(
                'Reveal Price button remained disabled after hover'
            );
        }

        /*
         * --------------------------------------------------
         * 7. CLICK REVEAL PRICE
         * --------------------------------------------------
         */

        console.log(
            '[Scraper] Clicking Reveal Price...'
        );

        /*
         * Listen for the actual price API request.
         *
         * The site was observed making:
         * /challenge
         * /session
         * /price
         */
        const priceResponsePromise =
            page.waitForResponse(
                response =>
                    response
                        .url()
                        .includes('/price'),
                {
                    timeout: 15000,
                }
            ).catch(() => null);

        await revealButton.click({
            timeout: 5000,
        });

        console.log(
            '[Scraper] Reveal Price clicked'
        );

        /*
         * Wait for the price request if it occurs.
         */
        const priceResponse =
            await priceResponsePromise;

        if (priceResponse) {
            console.log(
                '[Scraper] Price API response:',
                priceResponse.status()
            );
        }

        /*
         * --------------------------------------------------
         * 8. WAIT FOR RENDERED PRICE
         * --------------------------------------------------
         */

        await page.waitForTimeout(1500);

        try {
            await page.waitForFunction(
                ({
                    priceValueClass,
                    saleClass,
                }) => {
                    const selectors = [
                        `.${priceValueClass}`,
                        `.${saleClass}`,
                        'output',
                    ];

                    return selectors.some(
                        selector =>
                            [...document.querySelectorAll(
                                selector
                            )].some(element => {
                                const text =
                                    element.textContent
                                        ?.trim();

                                if (!text) {
                                    return false;
                                }

                                const style =
                                    window.getComputedStyle(
                                        element
                                    );

                                return (
                                    style.display !==
                                    'none' &&
                                    style.visibility !==
                                    'hidden'
                                );
                            })
                    );
                },
                {
                    priceValueClass,
                    saleClass,
                },
                {
                    timeout: 10000,
                }
            );
        } catch {
            console.log(
                '[Scraper] Price wait timed out - extracting anyway'
            );
        }

        /*
         * --------------------------------------------------
         * 9. EXTRACT PRICE
         * --------------------------------------------------
         */

        const priceData =
            await page.evaluate(
                ({
                    priceValueClass,
                    stockClass,
                    saleClass,
                    mrpClass,
                    priceTag,
                }) => {
                    let price = null;
                    let originalPrice = null;
                    let stock = null;

                    const cleanText =
                        value =>
                            (value || '')
                                .replace(
                                    /[\u200B-\u200D\u2060\u00A0]/g,
                                    ' '
                                )
                                .replace(
                                    /\s+/g,
                                    ' '
                                )
                                .trim();

                    const parsePrice =
                        text => {
                            if (!text) {
                                return null;
                            }

                            const cleaned =
                                cleanText(text);

                            const match =
                                cleaned.match(
                                    /(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/
                                );

                            if (!match) {
                                return null;
                            }

                            const value =
                                Number(
                                    match[1]
                                        .replace(
                                            /,/g,
                                            ''
                                        )
                                );

                            return Number.isFinite(
                                value
                            ) && value > 0
                                ? value
                                : null;
                        };

                    const isVisible =
                        element => {
                            if (!element) {
                                return false;
                            }

                            const style =
                                window.getComputedStyle(
                                    element
                                );

                            const rect =
                                element.getBoundingClientRect();

                            return (
                                style.display !==
                                'none' &&
                                style.visibility !==
                                'hidden' &&
                                parseFloat(
                                    style.opacity ||
                                    '1'
                                ) > 0 &&
                                rect.width > 0 &&
                                rect.height > 0
                            );
                        };

                    /*
                     * Current price candidates.
                     */
                    const selectors = [
                        `.${priceValueClass}`,
                        `.${saleClass}`,
                        `.${priceTag}`,
                        '.price-main',
                        '.price-success output',
                        '.price-block output',
                        'output',
                    ];

                    const candidates = [];

                    for (
                        const selector of selectors
                    ) {
                        document
                            .querySelectorAll(
                                selector
                            )
                            .forEach(element => {
                                if (
                                    isVisible(
                                        element
                                    ) &&
                                    !candidates.includes(
                                        element
                                    )
                                ) {
                                    candidates.push(
                                        element
                                    );
                                }
                            });
                    }

                    const validCandidates =
                        candidates.filter(
                            element => {
                                const text =
                                    cleanText(
                                        element.textContent
                                    );

                                if (!text) {
                                    return false;
                                }

                                const className =
                                    typeof element.className ===
                                        'string'
                                        ? element.className
                                        : '';

                                if (
                                    className
                                        .split(
                                            /\s+/
                                        )
                                        .includes(
                                            mrpClass
                                        )
                                ) {
                                    return false;
                                }

                                if (
                                    /mrp|original price|deal price|% off/i.test(
                                        text
                                    )
                                ) {
                                    return false;
                                }

                                if (
                                    element.style
                                        ?.textDecorationLine
                                        ?.includes(
                                            'line-through'
                                        )
                                ) {
                                    return false;
                                }

                                return (
                                    parsePrice(
                                        text
                                    ) !== null
                                );
                            }
                        );

                    /*
                     * Prefer the largest visible price.
                     */
                    validCandidates.sort(
                        (a, b) => {
                            const aSize =
                                parseFloat(
                                    window.getComputedStyle(
                                        a
                                    ).fontSize
                                ) || 0;

                            const bSize =
                                parseFloat(
                                    window.getComputedStyle(
                                        b
                                    ).fontSize
                                ) || 0;

                            return (
                                bSize - aSize
                            );
                        }
                    );

                    if (
                        validCandidates.length
                    ) {
                        price =
                            parsePrice(
                                validCandidates[0]
                                    .textContent
                            );
                    }

                    /*
                     * MRP.
                     */
                    const mrpElement =
                        document.querySelector(
                            `.${mrpClass}`
                        );

                    if (
                        mrpElement &&
                        isVisible(mrpElement)
                    ) {
                        originalPrice =
                            parsePrice(
                                mrpElement.textContent
                            );
                    }

                    /*
                     * Stock.
                     */
                    const stockElement =
                        document.querySelector(
                            `.${stockClass}`
                        );

                    if (
                        stockElement &&
                        isVisible(stockElement)
                    ) {
                        const stockText =
                            cleanText(
                                stockElement.textContent
                            );

                        const stockMatch =
                            stockText.match(
                                /\d+/
                            );

                        if (stockMatch) {
                            stock =
                                Number(
                                    stockMatch[0]
                                );
                        } else if (
                            /out of stock|unavailable/i.test(
                                stockText
                            )
                        ) {
                            stock = 0;
                        }
                    }

                    return {
                        price,
                        originalPrice,
                        stock,
                        candidates:
                            validCandidates
                                .slice(0, 10)
                                .map(
                                    element => ({
                                        text:
                                            cleanText(
                                                element.textContent
                                            ),
                                        className:
                                            typeof element.className ===
                                                'string'
                                                ? element.className
                                                : '',
                                    })
                                ),
                    };
                },
                {
                    priceValueClass,
                    stockClass,
                    saleClass,
                    mrpClass,
                    priceTag,
                }
            );

        console.log(
            '[Scraper] PRICE:',
            priceData.price
        );

        console.log(
            '[Scraper] MRP:',
            priceData.originalPrice
        );

        console.log(
            '[Scraper] STOCK:',
            priceData.stock
        );

        console.log(
            '[Scraper] CANDIDATES:',
            JSON.stringify(
                priceData.candidates
            )
        );

        /*
         * --------------------------------------------------
         * 10. VALIDATE
         * --------------------------------------------------
         */

        if (
            priceData.price === null ||
            priceData.price <= 0
        ) {
            throw new Error(
                'Price extraction returned null'
            );
        }

        return {
            price: priceData.price,
            originalPrice:
                priceData.originalPrice,
            stock: priceData.stock,
        };

    } catch (error) {
        console.error(
            '[Scraper] Playwright error:',
            error.message
        );

        throw error;

    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch {
                // Ignore browser close errors.
            }
        }
    }
}

module.exports = {
    fetchLayout,
    searchCatalog,
    deepSearchCatalog,
    fetchProductDetails,
    scrapeProductPrice,
};