const axios = require('axios');

const MOCK_STORE_BASE =
    process.env.MOCK_STORE_BASE_URL || 'https://demo.inelabteamdev.com';

/**
 * ---------------------------------------------------------
 * FETCH LAYOUT
 * ---------------------------------------------------------
 */
async function fetchLayout() {
    const res = await axios.get(
        `${MOCK_STORE_BASE}/api/layout`,
        {
            timeout: 15000,
        }
    );

    return res.data;
}

/**
 * ---------------------------------------------------------
 * SEARCH CATALOG
 * ---------------------------------------------------------
 */
async function searchCatalog(
    query,
    page = 1,
    pageSize = 20
) {
    const res = await axios.get(
        `${MOCK_STORE_BASE}/api/catalog`,
        {
            params: {
                page,
                pageSize,
            },
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
 * ---------------------------------------------------------
 * DEEP SEARCH CATALOG
 * ---------------------------------------------------------
 */
async function deepSearchCatalog(
    query,
    maxPages = 10
) {
    const results = [];
    const q = query.toLowerCase().trim();

    for (
        let page = 1;
        page <= maxPages;
        page++
    ) {
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

            const matching =
                res.data.items.filter(
                    (item) =>
                        item.name
                            ?.toLowerCase()
                            .includes(q) ||
                        item.brand
                            ?.toLowerCase()
                            .includes(q) ||
                        item.category
                            ?.toLowerCase()
                            .includes(q) ||
                        item.sku
                            ?.toLowerCase()
                            .includes(q)
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
                `[Catalog] Error fetching page ${page}:`,
                error.message
            );

            break;
        }
    }

    return results.slice(0, 50);
}

/**
 * ---------------------------------------------------------
 * FETCH PRODUCT DETAILS
 * ---------------------------------------------------------
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
 * ---------------------------------------------------------
 * COOKIE ACCEPTANCE
 * ---------------------------------------------------------
 *
 * IMPORTANT:
 * We must NOT simply remove the cookie popup.
 *
 * The website uses the cookie acceptance state during
 * the price reveal flow.
 */
async function acceptCookies(page) {
    console.log(
        '[Scraper] Checking for cookie consent...'
    );

    try {
        const acceptButton = page
            .getByRole('button', {
                name: /^accept$/i,
            })
            .first();

        if (
            await acceptButton.count() > 0 &&
            await acceptButton.isVisible()
        ) {
            console.log(
                '[Scraper] Cookie consent found - accepting'
            );

            await acceptButton.click({
                timeout: 5000,
            });

            await page.waitForTimeout(500);

            console.log(
                '[Scraper] Cookie consent accepted'
            );

            return true;
        }

        // Fallback for stores where the button text differs.
        const fallbackButton = page
            .locator(
                'button:has-text("Accept"), input[type="button"][value="Accept"]'
            )
            .first();

        if (
            await fallbackButton.count() > 0 &&
            await fallbackButton.isVisible()
        ) {
            console.log(
                '[Scraper] Cookie consent found - accepting'
            );

            await fallbackButton.click({
                timeout: 5000,
            });

            await page.waitForTimeout(500);

            console.log(
                '[Scraper] Cookie consent accepted'
            );

            return true;
        }

        console.log(
            '[Scraper] No cookie consent button found - continuing'
        );

        return false;
    } catch (error) {
        console.log(
            '[Scraper] Cookie handling:',
            error.message
        );

        return false;
    }
}

/**
 * ---------------------------------------------------------
 * CHECK IF COOKIE OVERLAY IS STILL PRESENT
 * ---------------------------------------------------------
 */
async function waitForCookieOverlayToDisappear(page) {
    try {
        await page.waitForFunction(
            () => {
                const overlay =
                    document.querySelector(
                        '.cookie-overlay'
                    );

                if (!overlay) {
                    return true;
                }

                const style =
                    window.getComputedStyle(overlay);

                return (
                    style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    style.opacity === '0'
                );
            },
            null,
            {
                timeout: 5000,
            }
        );
    } catch {
        // Not fatal.
    }
}

/**
 * ---------------------------------------------------------
 * SCRAPE PRODUCT PRICE
 * ---------------------------------------------------------
 */
async function scrapeProductPrice(
    productId,
    options = {}
) {
    const startTime = Date.now();

    const maxRetries =
        options.maxRetries || 3;

    let lastError = null;

    for (
        let attempt = 1;
        attempt <= maxRetries;
        attempt++
    ) {
        try {
            console.log(
                `[Scraper] Attempt ${attempt}/${maxRetries}`
            );

            console.log(
                `[Scraper] Starting product: ${productId}`
            );

            const layout =
                await fetchLayout();

            console.log(
                '[Scraper] Layout fetched successfully'
            );

            const result =
                await scrapeWithPlaywright(
                    productId,
                    layout,
                    options.headed || false
                );

            if (
                result &&
                result.price !== null &&
                result.price > 0
            ) {
                return {
                    success: true,
                    productId,

                    price: result.price,

                    originalPrice:
                        result.originalPrice,

                    stock:
                        result.stock,

                    scrapedAt:
                        new Date().toISOString(),

                    duration:
                        Date.now() - startTime,

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

                await new Promise(
                    (resolve) =>
                        setTimeout(
                            resolve,
                            waitMs
                        )
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

        scrapedAt:
            new Date().toISOString(),

        duration:
            Date.now() - startTime,

        attempt: maxRetries,

        method: 'playwright',

        error:
            lastError?.message ||
            'Unknown error',
    };
}

/**
 * ---------------------------------------------------------
 * PLAYWRIGHT SCRAPER
 * ---------------------------------------------------------
 */
async function scrapeWithPlaywright(
    productId,
    layout,
    headed = false
) {
    let browser = null;

    try {
        const {
            chromium,
        } = require('playwright');

        /**
         * -------------------------------------------------
         * LAUNCH BROWSER
         * -------------------------------------------------
         */
        browser =
            await chromium.launch({
                headless: !headed,

                slowMo:
                    headed ? 50 : 0,

                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                ],
            });

        /**
         * -------------------------------------------------
         * CREATE CONTEXT
         * -------------------------------------------------
         */
        const context =
            await browser.newContext({
                userAgent:
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                    'Chrome/120.0.0.0 Safari/537.36',

                viewport: {
                    width: 1366,
                    height: 768,
                },
            });

        const page =
            await context.newPage();

        page.setDefaultTimeout(
            15000
        );

        /**
         * -------------------------------------------------
         * LOG NETWORK REQUESTS
         * -------------------------------------------------
         */
        page.on(
            'request',
            (request) => {
                const url =
                    request.url();

                if (
                    url.includes(
                        '/api/challenge'
                    ) ||
                    url.includes(
                        '/api/session'
                    ) ||
                    url.includes(
                        '/api/price'
                    )
                ) {
                    console.log(
                        `[NETWORK REQUEST] ${request.method()}`
                    );

                    console.log(
                        url
                    );
                }
            }
        );

        page.on(
            'response',
            (response) => {
                const url =
                    response.url();

                if (
                    url.includes(
                        '/api/challenge'
                    ) ||
                    url.includes(
                        '/api/session'
                    ) ||
                    url.includes(
                        '/api/price'
                    )
                ) {
                    console.log(
                        `[NETWORK RESPONSE] ${response.status()}`
                    );

                    console.log(
                        url
                    );
                }
            }
        );

        /**
         * -------------------------------------------------
         * OPEN PRODUCT
         * -------------------------------------------------
         */
        console.log(
            `[Scraper] Opening: ${MOCK_STORE_BASE}/product/${productId}`
        );

        await page.goto(
            `${MOCK_STORE_BASE}/product/${productId}`,
            {
                waitUntil:
                    'domcontentloaded',

                timeout: 30000,
            }
        );

        await page.waitForTimeout(
            2000
        );

        /**
         * -------------------------------------------------
         * ACCEPT COOKIES
         * -------------------------------------------------
         */
        await acceptCookies(
            page
        );

        await waitForCookieOverlayToDisappear(
            page
        );

        /**
         * -------------------------------------------------
         * GET DYNAMIC CLASSES
         * -------------------------------------------------
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
            `[Scraper] Price wrapper: .${priceWrapClass}`
        );

        console.log(
            `[Scraper] Price class: .${priceValueClass}`
        );

        /**
         * -------------------------------------------------
         * FIND PRICE WRAPPER
         * -------------------------------------------------
         */
        const priceWrap =
            page
                .locator(
                    `.${priceWrapClass}`
                )
                .first();

        await priceWrap.waitFor({
            state: 'visible',
            timeout: 25000,
        });

        /**
         * -------------------------------------------------
         * SCROLL TO PRICE
         * -------------------------------------------------
         */
        await priceWrap.scrollIntoViewIfNeeded();

        await page.waitForTimeout(
            500
        );

        /**
         * -------------------------------------------------
         * REAL MOUSE MOVEMENT
         * -------------------------------------------------
         */
        console.log(
            '[Scraper] Hovering over price area...'
        );

        const bounds =
            await priceWrap.boundingBox();

        if (!bounds) {
            throw new Error(
                'Price wrapper has no bounding box'
            );
        }

        const centerX =
            bounds.x +
            bounds.width / 2;

        const centerY =
            bounds.y +
            bounds.height / 2;

        /**
         * Move into the price area.
         */
        await page.mouse.move(
            bounds.x + 5,
            bounds.y + 5,
            {
                steps: 5,
            }
        );

        /**
         * Move across the entire box.
         */
        for (
            let step = 1;
            step <= 20;
            step++
        ) {
            const x =
                bounds.x +
                5 +
                ((bounds.width - 10) *
                    step) /
                20;

            const y =
                bounds.y +
                bounds.height *
                (
                    0.25 +
                    (step % 5) *
                    0.10
                );

            await page.mouse.move(
                x,
                y,
                {
                    steps: 3,
                }
            );

            await page.waitForTimeout(
                100
            );
        }

        /**
         * Stay over the price area.
         */
        await page.mouse.move(
            centerX,
            centerY,
            {
                steps: 5,
            }
        );

        await page.waitForTimeout(
            1500
        );

        console.log(
            '[Scraper] Price area hovered successfully'
        );

        /**
         * -------------------------------------------------
         * FIND REVEAL BUTTON
         * -------------------------------------------------
         */
        const revealButton =
            page
                .getByRole(
                    'button',
                    {
                        name: /reveal price/i,
                    }
                )
                .first();

        await revealButton.waitFor({
            state: 'visible',
            timeout: 10000,
        });

        console.log(
            '[Scraper] Reveal Price button found'
        );

        /**
         * -------------------------------------------------
         * WAIT FOR BUTTON TO ENABLE
         * -------------------------------------------------
         *
         * The important difference from the previous
         * version:
         *
         * We DON'T click while disabled.
         *
         * We wait until the website itself enables it.
         */
        let enabled = false;

        for (
            let attempt = 1;
            attempt <= 20;
            attempt++
        ) {
            enabled =
                await revealButton.isEnabled();

            if (enabled) {
                break;
            }

            console.log(
                `[Scraper] Reveal button still disabled (${attempt}/20)`
            );

            /**
             * Keep the mouse over the price area.
             */
            await page.mouse.move(
                centerX,
                centerY,
                {
                    steps: 3,
                }
            );

            await page.waitForTimeout(
                500
            );
        }

        console.log(
            `[Scraper] Reveal button enabled: ${enabled}`
        );

        if (!enabled) {
            /**
             * Dump the button HTML so we can diagnose
             * another store-side state if necessary.
             */
            const buttonHtml =
                await revealButton.evaluate(
                    (el) =>
                        el.outerHTML
                );

            console.log(
                '[DEBUG] Reveal button HTML:',
                buttonHtml
            );

            throw new Error(
                'Reveal Price button remained disabled after hover'
            );
        }

        /**
         * -------------------------------------------------
         * MOVE TO REVEAL BUTTON
         * -------------------------------------------------
         */
        const buttonBounds =
            await revealButton.boundingBox();

        if (buttonBounds) {
            await page.mouse.move(
                buttonBounds.x +
                buttonBounds.width / 2,

                buttonBounds.y +
                buttonBounds.height / 2,

                {
                    steps: 5,
                }
            );

            await page.waitForTimeout(
                500
            );
        }

        /**
         * -------------------------------------------------
         * WAIT FOR PRICE API
         * -------------------------------------------------
         *
         * Start listening BEFORE clicking.
         */
        const priceResponsePromise =
            page.waitForResponse(
                (response) =>
                    response
                        .url()
                        .includes(
                            '/api/price'
                        ) &&
                    response.status() ===
                    200,
                {
                    timeout: 10000,
                }
            ).catch(
                () => null
            );

        /**
         * -------------------------------------------------
         * CLICK REVEAL PRICE
         * -------------------------------------------------
         */
        console.log(
            '[Scraper] Clicking Reveal Price...'
        );

        await revealButton.click({
            timeout: 5000,
        });

        console.log(
            '[Scraper] Reveal Price clicked'
        );

        /**
         * -------------------------------------------------
         * WAIT FOR PRICE API RESPONSE
         * -------------------------------------------------
         */
        const priceResponse =
            await priceResponsePromise;

        if (priceResponse) {
            console.log(
                '[Scraper] Price API response received'
            );

            /**
             * We deliberately DO NOT try to decrypt the
             * "e" field.
             *
             * The website's own JavaScript handles it and
             * renders the real price into the DOM.
             */
            try {
                const body =
                    await priceResponse.json();

                console.log(
                    '[Scraper] Price API response received:',
                    JSON.stringify({
                        productId:
                            body?.productId,

                        version:
                            body?.v,

                        hasEncryptedPayload:
                            Boolean(body?.e),

                        serverTime:
                            body?.serverTime,
                    })
                );
            } catch {
                console.log(
                    '[Scraper] Price response was not JSON'
                );
            }
        }

        /**
         * -------------------------------------------------
         * WAIT FOR RENDERED PRICE
         * -------------------------------------------------
         */
        console.log(
            '[Scraper] Waiting for rendered price...'
        );

        try {
            await page.waitForFunction(
                ({
                    priceValueClass,
                    saleClass,
                }) => {
                    const selectors = [
                        `.${priceValueClass}`,
                        `.${saleClass}`,
                        '.price-main',
                        '.price-success output',
                        '.price-block output',
                        'output',
                    ];

                    return selectors.some(
                        (selector) => {
                            const elements =
                                document.querySelectorAll(
                                    selector
                                );

                            return [
                                ...elements,
                            ].some(
                                (element) => {
                                    const style =
                                        window.getComputedStyle(
                                            element
                                        );

                                    const text =
                                        element
                                            .textContent
                                            ?.trim();

                                    return (
                                        text &&
                                        style.display !==
                                        'none' &&
                                        style.visibility !==
                                        'hidden' &&
                                        style.opacity !==
                                        '0'
                                    );
                                }
                            );
                        }
                    );
                },
                {
                    priceValueClass,
                    saleClass,
                },
                {
                    timeout: 20000,
                }
            );
        } catch {
            console.log(
                '[Scraper] Price wait timed out - attempting extraction'
            );
        }

        /**
         * Give React/site JavaScript a little extra time.
         */
        await page.waitForTimeout(
            1000
        );

        /**
         * -------------------------------------------------
         * EXTRACT PRICE
         * -------------------------------------------------
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
                    const cleanText =
                        (text) =>
                            (text || '')
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
                        (text) => {
                            if (!text) {
                                return null;
                            }

                            const cleaned =
                                cleanText(
                                    text
                                );

                            /**
                             * Examples:
                             *
                             * ₹22,894
                             * ₹22894
                             * Rs. 22894
                             * INR 22894
                             * 22894
                             */
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

                            if (
                                !Number.isFinite(
                                    value
                                ) ||
                                value <= 0
                            ) {
                                return null;
                            }

                            return value;
                        };

                    const isVisible =
                        (element) => {
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
                                element.getAttribute(
                                    'aria-hidden'
                                ) !== 'true' &&

                                style.display !==
                                'none' &&

                                style.visibility !==
                                'hidden' &&

                                style.opacity !==
                                '0' &&

                                rect.width > 0 &&
                                rect.height > 0
                            );
                        };

                    /**
                     * -------------------------------------------------
                     * PRICE CANDIDATES
                     * -------------------------------------------------
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

                    const candidates =
                        [];

                    for (
                        const selector
                        of selectors
                    ) {
                        document
                            .querySelectorAll(
                                selector
                            )
                            .forEach(
                                (element) => {
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
                                }
                            );
                    }

                    /**
                     * -------------------------------------------------
                     * FILTER PRICE CANDIDATES
                     * -------------------------------------------------
                     */
                    const validCandidates =
                        candidates.filter(
                            (element) => {
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

                                /**
                                 * Ignore MRP.
                                 */
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

                                /**
                                 * Ignore labels.
                                 */
                                if (
                                    /mrp|deal price|original price|% off|discount/i.test(
                                        text
                                    )
                                ) {
                                    return false;
                                }

                                /**
                                 * Ignore crossed-out price.
                                 */
                                const style =
                                    window.getComputedStyle(
                                        element
                                    );

                                if (
                                    style.textDecoration
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

                    /**
                     * Prefer larger visible price elements.
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
                                bSize -
                                aSize
                            );
                        }
                    );

                    let price =
                        null;

                    if (
                        validCandidates.length >
                        0
                    ) {
                        price =
                            parsePrice(
                                validCandidates[0]
                                    .textContent
                            );
                    }

                    /**
                     * -------------------------------------------------
                     * MRP
                     * -------------------------------------------------
                     */
                    let originalPrice =
                        null;

                    const mrpElement =
                        document.querySelector(
                            `.${mrpClass}`
                        );

                    if (
                        mrpElement &&
                        isVisible(
                            mrpElement
                        )
                    ) {
                        originalPrice =
                            parsePrice(
                                mrpElement
                                    .textContent
                            );
                    }

                    /**
                     * -------------------------------------------------
                     * STOCK
                     * -------------------------------------------------
                     */
                    let stock =
                        null;

                    const stockElement =
                        document.querySelector(
                            `.${stockClass}`
                        );

                    if (
                        stockElement &&
                        isVisible(
                            stockElement
                        )
                    ) {
                        const stockText =
                            cleanText(
                                stockElement
                                    .textContent
                            );

                        const stockMatch =
                            stockText.match(
                                /\d+/
                            );

                        if (
                            stockMatch
                        ) {
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
                                .slice(
                                    0,
                                    10
                                )
                                .map(
                                    (
                                        element
                                    ) => ({
                                        text:
                                            cleanText(
                                                element.textContent
                                            ),

                                        className:
                                            typeof element.className ===
                                                'string'
                                                ? element.className
                                                : '',

                                        fontSize:
                                            window.getComputedStyle(
                                                element
                                            ).fontSize,
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

        /**
         * -------------------------------------------------
         * LOG RESULTS
         * -------------------------------------------------
         */
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

        /**
         * -------------------------------------------------
         * VALIDATE
         * -------------------------------------------------
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
            price:
                priceData.price,

            originalPrice:
                priceData.originalPrice,

            stock:
                priceData.stock,
        };
    } catch (error) {
        console.error(
            '[Scraper] Playwright error:',
            error.message
        );

        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * ---------------------------------------------------------
 * EXPORTS
 * ---------------------------------------------------------
 */
module.exports = {
    fetchLayout,
    searchCatalog,
    deepSearchCatalog,
    fetchProductDetails,
    scrapeProductPrice,
    scrapeWithPlaywright,
};