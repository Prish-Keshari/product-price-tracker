const axios = require('axios');

const MOCK_STORE_BASE =
    process.env.MOCK_STORE_BASE_URL ||
    'https://demo.inelabteamdev.com';

/* =========================================================
   API HELPERS
========================================================= */

async function fetchLayout() {
    const res = await axios.get(
        `${MOCK_STORE_BASE}/api/layout`,
        {
            timeout: 15000,
        }
    );

    return res.data;
}

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

async function fetchProductDetails(productId) {
    const res = await axios.get(
        `${MOCK_STORE_BASE}/api/product/${productId}`,
        {
            timeout: 15000,
        }
    );

    return res.data;
}

/* =========================================================
   MAIN SCRAPER
========================================================= */

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
                console.log(
                    `[Scraper] SUCCESS price: ${result.price}`
                );

                return {
                    success: true,
                    productId,
                    price: result.price,
                    originalPrice:
                        result.originalPrice,
                    stock: result.stock,
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

/* =========================================================
   PLAYWRIGHT SCRAPER
========================================================= */

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

        const context =
            await browser.newContext({
                userAgent:
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                    'AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) ' +
                    'Chrome/120.0.0.0 Safari/537.36',

                viewport: {
                    width: 1366,
                    height: 768,
                },
            });

        const page =
            await context.newPage();

        page.setDefaultTimeout(15000);

        console.log(
            `[Scraper] Opening: ${MOCK_STORE_BASE}/product/${productId}`
        );

        /* =====================================================
           DYNAMIC CLASS NAMES
        ===================================================== */

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

        /* =====================================================
           OPEN PAGE
        ===================================================== */

        await page.goto(
            `${MOCK_STORE_BASE}/product/${productId}`,
            {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
            }
        );

        await page.waitForTimeout(1500);

        /* =====================================================
           COOKIE HANDLING
           
           IMPORTANT:
           We DO NOT remove the cookie overlay during
           initialization.
        ===================================================== */

        async function acceptCookieIfPresent() {
            try {
                console.log(
                    '[Scraper] Checking for cookie consent...'
                );

                const acceptButton =
                    page.getByRole(
                        'button',
                        {
                            name: /^accept$/i,
                        }
                    ).first();

                if (
                    await acceptButton.count()
                ) {
                    const visible =
                        await acceptButton.isVisible()
                            .catch(() => false);

                    if (visible) {
                        console.log(
                            '[Scraper] Cookie ACCEPT button found'
                        );

                        await acceptButton.click({
                            force: true,
                            timeout: 5000,
                        });

                        console.log(
                            '[Scraper] Cookie accepted'
                        );

                        await page.waitForTimeout(
                            1000
                        );

                        return true;
                    }
                }

                console.log(
                    '[Scraper] No cookie consent button found - continuing'
                );

                return false;
            } catch (error) {
                console.log(
                    '[Scraper] Cookie check:',
                    error.message
                );

                return false;
            }
        }

        /* =====================================================
           DETECT STUCK DIM OVERLAY
        ===================================================== */

        async function isPageBlocked() {
            try {
                return await page.evaluate(() => {
                    const width =
                        window.innerWidth;

                    const height =
                        window.innerHeight;

                    const points = [
                        [
                            width * 0.05,
                            height * 0.05,
                        ],
                        [
                            width * 0.5,
                            height * 0.1,
                        ],
                        [
                            width * 0.5,
                            height * 0.5,
                        ],
                        [
                            width * 0.9,
                            height * 0.5,
                        ],
                    ];

                    let blockedPoints = 0;

                    for (
                        const [x, y] of points
                    ) {
                        const elements =
                            document.elementsFromPoint(
                                x,
                                y
                            );

                        const blocker =
                            elements.find(
                                (el) => {
                                    if (
                                        !el ||
                                        el ===
                                        document.body ||
                                        el ===
                                        document.documentElement
                                    ) {
                                        return false;
                                    }

                                    const style =
                                        window.getComputedStyle(
                                            el
                                        );

                                    const rect =
                                        el.getBoundingClientRect();

                                    const zIndex =
                                        parseInt(
                                            style.zIndex
                                        );

                                    const fixedOrAbsolute =
                                        style.position ===
                                        'fixed' ||
                                        style.position ===
                                        'absolute';

                                    const coversLargeArea =
                                        rect.width >
                                        width * 0.65 &&
                                        rect.height >
                                        height * 0.65;

                                    return (
                                        fixedOrAbsolute &&
                                        coversLargeArea &&
                                        (
                                            zIndex >=
                                            100 ||
                                            style.opacity !==
                                            '1'
                                        )
                                    );
                                }
                            );

                        if (blocker) {
                            blockedPoints++;
                        }
                    }

                    return (
                        blockedPoints >= 2
                    );
                });
            } catch {
                return false;
            }
        }

        /* =====================================================
           PAGE RECOVERY
           
           The site occasionally loads with a permanent
           dim layer. One reload sometimes isn't enough.
           
           We therefore allow up to 3 reloads.
        ===================================================== */

        async function recoverPageIfBlocked() {
            const maxReloads = 3;

            for (
                let reloadAttempt = 0;
                reloadAttempt <= maxReloads;
                reloadAttempt++
            ) {
                await acceptCookieIfPresent();

                const blocked =
                    await isPageBlocked();

                if (!blocked) {
                    console.log(
                        '[Scraper] Page is interactive'
                    );

                    return true;
                }

                if (
                    reloadAttempt ===
                    maxReloads
                ) {
                    console.log(
                        '[Scraper] Page still blocked after 3 reloads'
                    );

                    return false;
                }

                console.log(
                    `[Scraper] Page stuck/dim - reload ${reloadAttempt + 1}/3`
                );

                await page.reload({
                    waitUntil:
                        'domcontentloaded',
                    timeout: 30000,
                });

                await page.waitForTimeout(
                    1500
                );
            }

            return false;
        }

        /* =====================================================
           INITIAL PAGE RECOVERY
        ===================================================== */

        const pageRecovered =
            await recoverPageIfBlocked();

        if (!pageRecovered) {
            throw new Error(
                'Page remained blocked after 3 reloads'
            );
        }

        /* =====================================================
           WAIT FOR PRICE WRAPPER
        ===================================================== */

        const priceWrap =
            page.locator(
                `.${priceWrapClass}`
            ).first();

        await priceWrap.waitFor({
            state: 'visible',
            timeout: 25000,
        });

        await priceWrap.scrollIntoViewIfNeeded();

        await page.waitForTimeout(500);

        /* =====================================================
           COOKIE CHECK AGAIN
        ===================================================== */

        await acceptCookieIfPresent();

        /* =====================================================
           CHECK PAGE AGAIN BEFORE HOVER
        ===================================================== */

        const recoveredBeforeHover =
            await recoverPageIfBlocked();

        if (!recoveredBeforeHover) {
            throw new Error(
                'Page became blocked before price hover'
            );
        }

        /* =====================================================
           REAL MOUSE HOVER
        ===================================================== */

        const bounds =
            await priceWrap.boundingBox();

        if (!bounds) {
            throw new Error(
                'Price wrapper has no bounding box'
            );
        }

        console.log(
            '[Scraper] Price wrapper bounds:',
            bounds
        );

        console.log(
            '[Scraper] Hovering over price area...'
        );

        const startX =
            bounds.x + 10;

        const centerY =
            bounds.y +
            bounds.height / 2;

        await page.mouse.move(
            startX,
            centerY
        );

        for (
            let step = 1;
            step <= 20;
            step++
        ) {
            const x =
                bounds.x +
                10 +
                ((bounds.width - 20) *
                    step) /
                20;

            const y =
                bounds.y +
                bounds.height *
                (
                    0.30 +
                    ((step % 4) *
                        0.12)
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

        console.log(
            '[Scraper] Price area hovered successfully'
        );

        await page.waitForTimeout(
            1500
        );

        /* =====================================================
           FIND REVEAL BUTTON
        ===================================================== */

        const revealButton =
            page.getByRole(
                'button',
                {
                    name: /reveal price/i,
                }
            ).first();

        await revealButton.waitFor({
            state: 'visible',
            timeout: 10000,
        });

        console.log(
            '[Scraper] Reveal Price button found'
        );

        /* =====================================================
           WAIT FOR BUTTON TO BECOME ENABLED
        ===================================================== */

        let buttonEnabled = false;

        for (
            let i = 1;
            i <= 20;
            i++
        ) {
            await page.waitForTimeout(
                500
            );

            await acceptCookieIfPresent();

            const disabled =
                await revealButton.isDisabled()
                    .catch(() => true);

            console.log(
                `[Scraper] Reveal button ${disabled
                    ? 'still disabled'
                    : 'enabled'
                } (${i}/20)`
            );

            if (!disabled) {
                buttonEnabled = true;
                break;
            }

            /*
             * Continue real mouse movement over
             * the price wrapper while waiting.
             */
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

        console.log(
            '[Scraper] Reveal button enabled:',
            buttonEnabled
        );

        if (!buttonEnabled) {
            /*
             * The page may have entered the stuck
             * dim state again.
             */
            const blockedAgain =
                await isPageBlocked();

            if (blockedAgain) {
                throw new Error(
                    'Page became blocked while waiting for Reveal Price'
                );
            }

            throw new Error(
                'Reveal Price button remained disabled after hover'
            );
        }

        /* =====================================================
           MOVE TO BUTTON
        ===================================================== */

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
                300
            );
        }

        /* =====================================================
           CAPTURE PRICE API RESPONSE
           
           The browser showed a /price network request
           after the reveal action, so listen for it.
        ===================================================== */

        let priceApiData = null;

        const priceResponsePromise =
            page
                .waitForResponse(
                    async (response) => {
                        try {
                            const url =
                                response.url();

                            return (
                                response.ok() &&
                                /\/price(?:\/|$|\?)/i.test(
                                    url
                                )
                            );
                        } catch {
                            return false;
                        }
                    },
                    {
                        timeout: 10000,
                    }
                )
                .catch(() => null);

        /* =====================================================
           CLICK REVEAL
        ===================================================== */

        console.log(
            '[Scraper] Clicking Reveal Price...'
        );

        await revealButton.click({
            force: true,
            timeout: 5000,
        });

        console.log(
            '[Scraper] Reveal Price clicked'
        );

        /* =====================================================
           READ PRICE API
        ===================================================== */

        const priceResponse =
            await priceResponsePromise;

        if (priceResponse) {
            try {
                priceApiData =
                    await priceResponse.json();

                console.log(
                    '[Scraper] Price API response:',
                    JSON.stringify(
                        priceApiData
                    )
                );
            } catch {
                console.log(
                    '[Scraper] Price API response was not JSON'
                );
            }
        }

        /* =====================================================
           WAIT FOR DOM PRICE
        ===================================================== */

        await page.waitForTimeout(
            1500
        );

        /* =====================================================
           EXTRACT DOM PRICE
        ===================================================== */

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
                        (value) =>
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
                        (text) => {
                            if (!text)
                                return null;

                            const cleaned =
                                cleanText(
                                    text
                                );

                            const match =
                                cleaned.match(
                                    /(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/
                                );

                            if (!match)
                                return null;

                            const value =
                                Number(
                                    match[1].replace(
                                        /,/g,
                                        ''
                                    )
                                );

                            return Number.isFinite(
                                value
                            ) &&
                                value > 0
                                ? value
                                : null;
                        };

                    const isVisible =
                        (element) => {
                            if (!element)
                                return false;

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
                                style.opacity !==
                                '0' &&
                                rect.width > 0 &&
                                rect.height > 0
                            );
                        };

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

                    const valid =
                        candidates.filter(
                            (element) => {
                                const text =
                                    cleanText(
                                        element.textContent
                                    );

                                if (!text)
                                    return false;

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

                                return (
                                    parsePrice(
                                        text
                                    ) !== null
                                );
                            }
                        );

                    valid.sort(
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

                    let price = null;

                    if (
                        valid.length
                    ) {
                        price =
                            parsePrice(
                                valid[0]
                                    .textContent
                            );
                    }

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
                                mrpElement.textContent
                            );
                    }

                    let stock = null;

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
                        const text =
                            cleanText(
                                stockElement.textContent
                            );

                        const number =
                            text.match(
                                /\d+/
                            );

                        if (number) {
                            stock =
                                Number(
                                    number[0]
                                );
                        } else if (
                            /out of stock|unavailable/i.test(
                                text
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
                            valid
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

        /* =====================================================
           LOG RESULTS
        ===================================================== */

        console.log(
            '[Scraper] DOM PRICE:',
            priceData.price
        );

        console.log(
            '[Scraper] DOM MRP:',
            priceData.originalPrice
        );

        console.log(
            '[Scraper] DOM STOCK:',
            priceData.stock
        );

        console.log(
            '[Scraper] PRICE API:',
            JSON.stringify(
                priceApiData
            )
        );

        console.log(
            '[Scraper] PRICE CANDIDATES:',
            JSON.stringify(
                priceData.candidates
            )
        );

        /* =====================================================
           API PRICE FALLBACK
        ===================================================== */

        let apiPrice = null;

        if (priceApiData) {
            const possibleValues = [
                priceApiData.price,
                priceApiData.currentPrice,
                priceApiData.salePrice,
                priceApiData.data?.price,
                priceApiData.data?.currentPrice,
                priceApiData.data?.salePrice,
            ];

            for (
                const value of possibleValues
            ) {
                if (
                    typeof value ===
                    'number' &&
                    value > 0
                ) {
                    apiPrice = value;
                    break;
                }

                if (
                    typeof value ===
                    'string'
                ) {
                    const match =
                        value.match(
                            /[\d,]+(?:\.\d{1,2})?/
                        );

                    if (match) {
                        const parsed =
                            Number(
                                match[0].replace(
                                    /,/g,
                                    ''
                                )
                            );

                        if (
                            parsed > 0
                        ) {
                            apiPrice =
                                parsed;
                            break;
                        }
                    }
                }
            }
        }

        const finalPrice =
            apiPrice ||
            priceData.price;

        console.log(
            '[Scraper] FINAL PRICE:',
            finalPrice
        );

        /* =====================================================
           VALIDATION
        ===================================================== */

        if (
            finalPrice === null ||
            finalPrice === undefined ||
            finalPrice <= 0
        ) {
            throw new Error(
                'Price extraction returned null'
            );
        }

        return {
            price: finalPrice,

            originalPrice:
                priceData.originalPrice,

            stock:
                priceData.stock,
        };
    } catch (error) {
        console.error(
            '[Scraper] Error:',
            error.message
        );

        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
    scrapeProductPrice,
    searchCatalog,
    deepSearchCatalog,
    fetchProductDetails,
    fetchLayout,
};