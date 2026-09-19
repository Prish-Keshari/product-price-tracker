import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Package, TrendingUp, TrendingDown, Activity, RefreshCw,
    Eye, Trash2, Clock, BarChart3, AlertTriangle
} from 'lucide-react';
import { getTrackedProducts, triggerScrape, triggerScrapeAll, untrackProduct } from '../api';
import { format, formatDistanceToNow } from 'date-fns';

function Dashboard({ addToast }) {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [scraping, setScraping] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        loadProducts();
    }, []);

    const loadProducts = async () => {
        try {
            setLoading(true);
            const data = await getTrackedProducts();
            setProducts(data);
        } catch (error) {
            addToast('Failed to load tracked products', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleScrapeAll = async () => {
        try {
            setScraping(true);
            await triggerScrapeAll();
            addToast('Scrape triggered for all products! Results will appear shortly.', 'success');
            // Reload after a delay to see updated data
            setTimeout(loadProducts, 10000);
        } catch (error) {
            addToast('Failed to trigger scrape', 'error');
        } finally {
            setScraping(false);
        }
    };

    const handleScrapeOne = async (product) => {
        try {
            await triggerScrape(product.id);
            addToast(`Scrape triggered for ${product.name}`, 'success');
            setTimeout(loadProducts, 10000);
        } catch (error) {
            addToast(`Failed to scrape ${product.name}`, 'error');
        }
    };

    const handleUntrack = async (product) => {
        if (!window.confirm(`Stop tracking "${product.name}"?`)) return;
        try {
            await untrackProduct(product.id);
            addToast(`Stopped tracking ${product.name}`, 'info');
            loadProducts();
        } catch (error) {
            addToast('Failed to untrack product', 'error');
        }
    };

    const totalProducts = products.length;
    const withPrice = products.filter(p => p.current_price).length;
    const outOfStock = products.filter(p => p.current_stock === 0).length;
    const recentlyScraped = products.filter(p => {
        if (!p.last_scraped_at) return false;
        const diff = Date.now() - new Date(p.last_scraped_at).getTime();
        return diff < 3 * 60 * 60 * 1000; // 3 hours
    }).length;

    if (loading) {
        return (
            <div className="loading">
                <div className="spinner" />
                <p>Loading dashboard...</p>
            </div>
        );
    }

    return (
        <div className="fade-in">
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2>Dashboard</h2>
                    <p>Monitor your tracked products and scrape status</p>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={handleScrapeAll}
                    disabled={scraping || products.length === 0}
                >
                    <RefreshCw size={16} className={scraping ? 'pulse' : ''} />
                    {scraping ? 'Scraping...' : 'Scrape All'}
                </button>
            </div>

            {/* Stats */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon purple">
                        <Package size={20} />
                    </div>
                    <div className="stat-info">
                        <h4>Tracked Products</h4>
                        <div className="stat-value">{totalProducts}</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon green">
                        <TrendingUp size={20} />
                    </div>
                    <div className="stat-info">
                        <h4>With Price Data</h4>
                        <div className="stat-value">{withPrice}</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon red">
                        <AlertTriangle size={20} />
                    </div>
                    <div className="stat-info">
                        <h4>Out of Stock</h4>
                        <div className="stat-value">{outOfStock}</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon blue">
                        <Activity size={20} />
                    </div>
                    <div className="stat-info">
                        <h4>Recently Scraped</h4>
                        <div className="stat-value">{recentlyScraped}</div>
                    </div>
                </div>
            </div>

            {/* Product List */}
            {products.length === 0 ? (
                <div className="empty-state">
                    <Package size={64} />
                    <h3>No products tracked yet</h3>
                    <p>Search for products from the INE mock store and start tracking their prices.</p>
                    <button className="btn btn-primary" onClick={() => navigate('/search')}>
                        Search Products
                    </button>
                </div>
            ) : (
                <div className="product-grid">
                    {products.map(product => (
                        <div key={product.id} className="product-card">
                            <div className="product-card-header">
                                <h3>{product.name}</h3>
                                <span className="badge badge-info">{product.category}</span>
                            </div>

                            <div className="product-card-meta">
                                <span className="badge badge-neutral">{product.brand}</span>
                                <span className="badge badge-neutral">{product.sku}</span>
                            </div>

                            {product.current_price ? (
                                <div className="product-card-price">₹{product.current_price.toLocaleString()}</div>
                            ) : (
                                <div className="product-card-price" style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>
                                    Price not scraped yet
                                </div>
                            )}

                            <div className="product-card-stock">
                                {product.current_stock === null || product.current_stock === undefined ? (
                                    <span className="badge badge-warning">Stock unknown</span>
                                ) : product.current_stock === 0 ? (
                                    <span className="badge badge-error">Out of stock</span>
                                ) : product.current_stock === -1 ? (
                                    <span className="badge badge-success">In stock</span>
                                ) : (
                                    <span className="badge badge-success">{product.current_stock} in stock</span>
                                )}
                            </div>

                            <div className="product-card-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/product/${product.id}`)}>
                                    <Eye size={14} /> View Details
                                </button>
                                <button className="btn btn-success btn-sm" onClick={() => handleScrapeOne(product)}>
                                    <RefreshCw size={14} /> Scrape
                                </button>
                                <button className="btn btn-danger btn-sm" onClick={() => handleUntrack(product)}>
                                    <Trash2 size={14} />
                                </button>
                            </div>

                            <div className="product-card-footer">
                                <span>
                                    <Clock size={12} style={{ marginRight: '4px' }} />
                                    {product.last_scraped_at
                                        ? formatDistanceToNow(new Date(product.last_scraped_at), { addSuffix: true })
                                        : 'Never scraped'}
                                </span>
                                <span>ID: {product.store_product_id}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default Dashboard;
