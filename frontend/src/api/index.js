import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const api = axios.create({
    baseURL: `${API_BASE}/api`,
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Search mock store products
export const searchProducts = async (query) => {
    const { data } = await api.get(`/products/search?q=${encodeURIComponent(query)}`);
    return data;
};

// Get product details from mock store
export const getProductDetails = async (id) => {
    const { data } = await api.get(`/products/details/${id}`);
    return data;
};

// Track a product
export const trackProduct = async (product) => {
    const { data } = await api.post('/products/track', {
        storeProductId: product.id,
        name: product.name,
        brand: product.brand,
        category: product.category,
        sku: product.sku,
        slug: product.slug,
        description: product.description,
    });
    return data;
};

// Get all tracked products
export const getTrackedProducts = async () => {
    const { data } = await api.get('/products/tracked');
    return data;
};

// Get price history for a product
export const getPriceHistory = async (id) => {
    const { data } = await api.get(`/products/${id}/history`);
    return data;
};

// Get scrape logs for a product
export const getScrapeLogs = async (id) => {
    const { data } = await api.get(`/products/${id}/logs`);
    return data;
};

// Trigger manual scrape
export const triggerScrape = async (id) => {
    const { data } = await api.post(`/products/${id}/scrape`);
    return data;
};

// Untrack a product
export const untrackProduct = async (id) => {
    const { data } = await api.delete(`/products/${id}/untrack`);
    return data;
};

// Trigger scrape all
export const triggerScrapeAll = async () => {
    const { data } = await api.post('/products/scrape-all');
    return data;
};

export default api;
