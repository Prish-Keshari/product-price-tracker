const axios = require("axios");
const { chromium } = require("playwright");

const MOCK_STORE_BASE =
    process.env.MOCK_STORE_BASE_URL ||
    "https://demo.inelabteamdev.com";

/* =========================================================
   API HELPERS
========================================================= */

async function fetchLayout() {
    const res = await axios.get(
        `${MOCK_STORE_BASE}/api/layout`,
        { timeout: 15000 }
    );

    return res.data;
}

async function searchCatalog(query, page = 1, pageSize = 20) {
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

        data.items = (data.items || []).filter((item) => {
            return (
                String(item.name || "").toLowerCase().includes(q) ||
                String(item.brand || "").toLowerCase().includes(q) ||
                String(item.category || "").toLowerCase().includes(q) ||
                String(item.sku || "").toLowerCase().includes(q)
            );
        });
    }

    return data;
}

async function deepSearchCatalog(query, maxPages = 10) {
    const results = [];
    const q = String(query || "").toLowerCase().trim();

    if (!q) {
        return results;
    }

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

            const data = res.data;
            const items = Array.isArray(data.items)
                ? data.items
                : [];

            const matching = items.filter((item) => {
                return (
                    String(item.name || "").toLowerCase().includes(q) ||
                    String(item.brand || "").toLowerCase().includes(q) ||
                    String(item.category || "").toLowerCase().includes(q) ||
                    String(item.sku || "").toLowerCase().includes(q)
                );
            });

            results.push(...matching);

            if (
                results.length >= 50 ||
                !data.pages ||
                page >= data.pages
            ) {
                break;
            }
        } catch (error) {
            console.error(
                `[Catalog] Page ${page} failed:`,
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
        { timeout: 15000 }
    );

    return res.data;
}

/* =========================================================
   COOKIE CONSENT
========================================================= */

async function acceptCookies(page) {
    const patterns = [
        /accept all cookies/i,
        /accept all/i,
        /accept cookies/i,
        /allow all cookies/i,
        /allow cookies/i,
        /^accept$/i,
        /^allow$/i,
        /agree/i,
        /got it/i,
    ];

    console.log("[Scraper] Checking for cookie consent...");

    for (const pattern of patterns) {
        try {
            const button = page
                .getByRole("button", { name: pattern })
                .first();

            if (await button.count() === 0) {
                continue;
            }

            if (!(await button.isVisible().catch(() => false))) {
                continue;
            }

            console.log(
                `[Scraper] Cookie button found: ${pattern}`
            );

            await button.click({
                timeout: 5000,
            });

            await page.waitForTimeout(1000);

            console.log(
                "[Scraper] Cookies accepted successfully"
            );

            return true;
        } catch {
            // Try next selector
        }
    }

    const fallbackSelectors = [
        'text="Accept All"',
        'text="Accept All Cookies"',
        'text="Accept Cookies"',
        'text="Allow All"',
        'text="Allow Cookies"',
        'text="I Agree"',
        'text="Got it"',
    ];

    for (const selector of fallbackSelectors) {
        try {
            const element =
                page.locator(selector).first();

            if (
                await element.count() > 0 &&
                await element.isVisible()
            ) {
                console.log(
                    `[Scraper] Cookie fallback found: ${selector}`
                );

                await element.click({
                    timeout: 5000,
                });

                await page.waitForTimeout(1000);

                console.log(
                    "[Scraper] Cookies accepted successfully"
                );

                return true;
            }
        } catch {
            // Continue
        }
    }

    console.log(
        "[Scraper] No cookie consent button found - continuing"
    );

    return false;
}

/* =========================================================
   PRICE PARSER
========================================================= */

function parsePrice(text) {
    if (!text) {
        return null;
    }

    const cleaned = String(text)
        .replace(/[\u200B-\u200D\u2060\u00A0]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const match = cleaned.match(
        /(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/
    );

    if (!match) {
        return null;
    }

    const value = Number(
        match[1].replace(/,/g, "")
    );

    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }

    return value;
}

/* =========================================================
   PLAYWRIGHT SCRAPER
========================================================= */

async function scrapeWithPlaywright(
    productId,
    layout = {},
    headed = false
) {
    let browser = null;

    try {
        console.log(
            `[Scraper] Starting product: ${productId}`
        );

        browser = await chromium.launch({
            headless: !headed,
            slowMo: headed ? 50 : 0,

            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ],
        });

        const context = await browser.newContext({
            viewport: {
                width: 1366,
                height: 768,
            },

            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/120.0.0.0 Safari/537.36",
        });

        const page = await context.newPage();

        page.setDefaultTimeout(15000);

        /* -----------------------------------------
           OPEN PRODUCT
        ----------------------------------------- */

        const productUrl =
            `${MOCK_STORE_BASE}/product/${productId}`;

        console.log(
            `[Scraper] Opening: ${productUrl}`
        );

        await page.goto(productUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        await page.waitForTimeout(1500);

        /* -----------------------------------------
           ACCEPT COOKIES
        ----------------------------------------- */

        await acceptCookies(page);

        await page.waitForTimeout(1000);

        /* -----------------------------------------
           DYNAMIC CLASSES
        ----------------------------------------- */

        const priceWrapClass =
            layout?.classes?.priceWrap || "pw-m4";

        const priceValueClass =
            layout?.classes?.priceValue || "pv-m4";

        const stockClass =
            layout?.classes?.stock || "st-m4";

        const saleClass =
            layout?.classes?.sale || "sl-m4";

        const mrpClass =
            layout?.classes?.mrp || "mr-m4";

        const priceTag =
            layout?.priceTag || "output";

        console.log(
            `[Scraper] Price wrapper: .${priceWrapClass}`
        );

        console.log(
            `[Scraper] Price class: .${priceValueClass}`
        );

        /* -----------------------------------------
           FIND PRICE WRAPPER
        ----------------------------------------- */

        const priceWrap =
            page
                .locator(`.${priceWrapClass}`)
                .first();

        if (await priceWrap.count() === 0) {
            throw new Error(
                `Price wrapper not found: .${priceWrapClass}`
            );
        }

        await priceWrap.waitFor({
            state: "visible",
            timeout: 20000,
        });

        /* -----------------------------------------
           SCROLL TO PRICE
        ----------------------------------------- */

        await priceWrap.scrollIntoViewIfNeeded();

        await page.waitForTimeout(500);

        /* -----------------------------------------
           HOVER PRICE AREA
        ----------------------------------------- */

        console.log(
            "[Scraper] Hovering over price area..."
        );

        try {
            await priceWrap.hover({
                force: true,
                timeout: 10000,
            });

            console.log(
                "[Scraper] Price area hovered successfully"
            );
        } catch (error) {
            console.log(
                "[Scraper] Price wrapper hover failed:",
                error.message
            );

            const bounds =
                await priceWrap.boundingBox();

            if (bounds) {
                await page.mouse.move(
                    bounds.x + bounds.width / 2,
                    bounds.y + bounds.height / 2,
                    {
                        steps: 25,
                    }
                );
            }
        }

        /*
         * The website specifically requires hovering
         * over the price area before enabling the
         * Reveal Price button.
         */

        await page.waitForTimeout(1500);

        /* -----------------------------------------
           FIND REVEAL BUTTON
        ----------------------------------------- */

        const revealButton =
            page
                .getByRole("button", {
                    name: /reveal price/i,
                })
                .first();

        if (await revealButton.count() === 0) {
            throw new Error(
                "Reveal Price button not found"
            );
        }

        console.log(
            "[Scraper] Reveal Price button found"
        );

        /* -----------------------------------------
           KEEP HOVERING UNTIL ENABLED
        ----------------------------------------- */

        let buttonEnabled = false;

        for (let i = 0; i < 10; i++) {
            buttonEnabled =
                await revealButton
                    .isEnabled()
                    .catch(() => false);

            if (buttonEnabled) {
                break;
            }

            console.log(
                `[Scraper] Reveal button still disabled ` +
                `(${i + 1}/10)`
            );

            /*
             * Hover again because the website's
             * state is controlled by hover.
             */

            try {
                await priceWrap.hover({
                    force: true,
                    timeout: 5000,
                });
            } catch {
                const bounds =
                    await priceWrap.boundingBox();

                if (bounds) {
                    await page.mouse.move(
                        bounds.x + bounds.width / 2,
                        bounds.y + bounds.height / 2,
                        {
                            steps: 20,
                        }
                    );
                }
            }

            await page.waitForTimeout(500);
        }

        console.log(
            "[Scraper] Reveal button enabled:",
            buttonEnabled
        );

        /* -----------------------------------------
           CLICK ONLY IF ENABLED
        ----------------------------------------- */

        if (!buttonEnabled) {
            throw new Error(
                "Reveal Price button remained disabled after hover"
            );
        }

        await revealButton.click({
            timeout: 5000,
        });

        console.log(
            "[Scraper] Reveal Price clicked"
        );

        /* -----------------------------------------
           WAIT FOR REVEAL
        ----------------------------------------- */

        try {
            await page.waitForFunction(
                ({
                    priceValueClass,
                    saleClass,
                    priceWrapClass,
                }) => {
                    const selectors = [
                        `.${priceValueClass}`,
                        `.${saleClass}`,
                        `.${priceWrapClass} output`,
                        ".price-main",
                        ".price-success",
                        "output",
                    ];

                    return selectors.some(
                        (selector) => {
                            return [
                                ...document.querySelectorAll(
                                    selector
                                ),
                            ].some((element) => {
                                const text =
                                    element.textContent?.trim();

                                const style =
                                    window.getComputedStyle(
                                        element
                                    );

                                const hidden =
                                    element.classList.contains(
                                        "price-idle"
                                    );

                                return (
                                    text &&
                                    !hidden &&
                                    style.display !== "none" &&
                                    style.visibility !== "hidden" &&
                                    style.opacity !== "0"
                                );
                            });
                        }
                    );
                },
                {
                    priceValueClass,
                    saleClass,
                    priceWrapClass,
                },
                {
                    timeout: 15000,
                }
            );

            console.log(
                "[Scraper] Price appeared successfully"
            );
        } catch {
            console.log(
                "[Scraper] Price wait timed out"
            );
        }

        /* -----------------------------------------
           EXTRACT PRICE / MRP / STOCK
        ----------------------------------------- */

        const priceData =
            await page.evaluate(
                ({
                    priceValueClass,
                    stockClass,
                    saleClass,
                    mrpClass,
                    priceTag,
                    priceWrapClass,
                }) => {
                    const cleanText = (text) => {
                        return String(text || "")
                            .replace(
                                /[\u200B-\u200D\u2060\u00A0]/g,
                                " "
                            )
                            .replace(/\s+/g, " ")
                            .trim();
                    };

                    const parsePrice = (text) => {
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
                                match[1].replace(
                                    /,/g,
                                    ""
                                )
                            );

                        return Number.isFinite(value) &&
                            value > 0
                            ? value
                            : null;
                    };

                    const isVisible = (element) => {
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
                                "aria-hidden"
                            ) !== "true" &&
                            style.display !== "none" &&
                            style.visibility !== "hidden" &&
                            style.opacity !== "0" &&
                            rect.width > 0 &&
                            rect.height > 0
                        );
                    };

                    /* --------------------------------
                       PRICE CANDIDATES
                    -------------------------------- */

                    const selectors = [
                        `.${priceValueClass}`,
                        `.${saleClass}`,
                        `.${priceWrapClass} output`,
                        `.${priceWrapClass} .price-status`,
                        ".price-main",
                        ".price-success",
                        "output",
                    ];

                    const candidates = [];

                    for (const selector of selectors) {
                        document
                            .querySelectorAll(selector)
                            .forEach((element) => {
                                if (
                                    isVisible(element) &&
                                    !candidates.includes(element)
                                ) {
                                    candidates.push(element);
                                }
                            });
                    }

                    const validCandidates =
                        candidates.filter((element) => {
                            const text =
                                cleanText(
                                    element.textContent
                                );

                            if (!text) {
                                return false;
                            }

                            const className =
                                typeof element.className ===
                                    "string"
                                    ? element.className
                                    : "";

                            if (
                                className
                                    .split(/\s+/)
                                    .includes(mrpClass)
                            ) {
                                return false;
                            }

                            if (
                                /price hidden|hover over|reveal price/i.test(
                                    text
                                )
                            ) {
                                return false;
                            }

                            const style =
                                window.getComputedStyle(
                                    element
                                );

                            if (
                                style.textDecorationLine.includes(
                                    "line-through"
                                )
                            ) {
                                return false;
                            }

                            return (
                                parsePrice(text) !== null
                            );
                        });

                    validCandidates.sort((a, b) => {
                        const aClass =
                            typeof a.className === "string"
                                ? a.className
                                : "";

                        const bClass =
                            typeof b.className === "string"
                                ? b.className
                                : "";

                        const aPriority =
                            aClass.includes(priceValueClass)
                                ? 0
                                : aClass.includes(saleClass)
                                    ? 1
                                    : 2;

                        const bPriority =
                            bClass.includes(priceValueClass)
                                ? 0
                                : bClass.includes(saleClass)
                                    ? 1
                                    : 2;

                        if (
                            aPriority !==
                            bPriority
                        ) {
                            return (
                                aPriority -
                                bPriority
                            );
                        }

                        const aSize =
                            parseFloat(
                                window
                                    .getComputedStyle(a)
                                    .fontSize
                            ) || 0;

                        const bSize =
                            parseFloat(
                                window
                                    .getComputedStyle(b)
                                    .fontSize
                            ) || 0;

                        return bSize - aSize;
                    });

                    let price = null;

                    if (
                        validCandidates.length > 0
                    ) {
                        price =
                            parsePrice(
                                validCandidates[0]
                                    .textContent
                            );
                    }

                    /* --------------------------------
                       FALLBACK: SEARCH PRICE BLOCK
                    -------------------------------- */

                    if (price === null) {
                        const priceBlock =
                            document.querySelector(
                                `.${priceWrapClass}`
                            );

                        if (priceBlock) {
                            const text =
                                cleanText(
                                    priceBlock.textContent
                                );

                            const match =
                                text.match(
                                    /(?:₹|Rs\.?|INR)\s*[\d,]+(?:\.\d{1,2})?/
                                );

                            if (match) {
                                price =
                                    parsePrice(
                                        match[0]
                                    );
                            }
                        }
                    }

                    /* --------------------------------
                       MRP
                    -------------------------------- */

                    let originalPrice = null;

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

                    /* --------------------------------
                       STOCK
                    -------------------------------- */

                    let stock = null;

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
                            stockText.match(/\d+/);

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
                                .map((element) => ({
                                    text:
                                        cleanText(
                                            element.textContent
                                        ),
                                    className:
                                        typeof element.className ===
                                            "string"
                                            ? element.className
                                            : "",
                                })),
                    };
                },
                {
                    priceValueClass,
                    stockClass,
                    saleClass,
                    mrpClass,
                    priceTag,
                    priceWrapClass,
                }
            );

        /* -----------------------------------------
           LOG RESULTS
        ----------------------------------------- */

        console.log(
            "[Scraper] PRICE:",
            priceData.price
        );

        console.log(
            "[Scraper] MRP:",
            priceData.originalPrice
        );

        console.log(
            "[Scraper] STOCK:",
            priceData.stock
        );

        console.log(
            "[Scraper] CANDIDATES:",
            JSON.stringify(
                priceData.candidates
            )
        );

        /* -----------------------------------------
           VALIDATE PRICE
        ----------------------------------------- */

        if (
            priceData.price === null ||
            priceData.price <= 0
        ) {
            throw new Error(
                "Price extraction returned null"
            );
        }

        return {
            price: priceData.price,
            originalPrice:
                priceData.originalPrice,
            stock:
                priceData.stock,
        };
    } catch (error) {
        console.error(
            "[Scraper] Playwright error:",
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
   PUBLIC SCRAPER WITH RETRIES
========================================================= */

async function scrapeProductPrice(
    productId,
    options = {}
) {
    const startTime = Date.now();

    const maxRetries =
        Number(options.maxRetries) > 0
            ? Number(options.maxRetries)
            : 3;

    let lastError = null;

    /* -----------------------------------------
       FETCH LAYOUT
    ----------------------------------------- */

    let layout;

    try {
        layout = await fetchLayout();

        console.log(
            "[Scraper] Layout fetched successfully"
        );
    } catch (error) {
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
            attempt: 0,
            method: "playwright",
            error:
                `Layout fetch failed: ${error.message}`,
        };
    }

    /* -----------------------------------------
       RETRIES
    ----------------------------------------- */

    for (
        let attempt = 1;
        attempt <= maxRetries;
        attempt++
    ) {
        try {
            console.log(
                `[Scraper] Attempt ${attempt}/${maxRetries}`
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
                console.log(
                    "[Scraper] SUCCESS"
                );

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
                    method: "playwright",
                };
            }

            throw new Error(
                "Invalid price returned"
            );
        } catch (error) {
            lastError = error;

            console.error(
                `[Scraper] Attempt ${attempt} failed:`,
                error.message
            );

            if (
                attempt < maxRetries
            ) {
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

    /* -----------------------------------------
       FINAL FAILURE
    ----------------------------------------- */

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
        method: "playwright",
        error:
            lastError?.message ||
            "Unknown scraping error",
    };
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
    fetchLayout,
    searchCatalog,
    deepSearchCatalog,
    fetchProductDetails,
    scrapeProductPrice,
    scrapeWithPlaywright,
};