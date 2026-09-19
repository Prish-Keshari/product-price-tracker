import { useState, useRef, useEffect } from 'react';
import { Search, Plus, Loader2, Package, Tag, ShoppingBag } from 'lucide-react';
import { searchProducts, trackProduct, getProductDetails } from '../api';

function SearchPage({ addToast }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [trackingIds, setTrackingIds] = useState(new Set());
    const [expandedProduct, setExpandedProduct] = useState(null);
    const [productDetails, setProductDetails] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const searchTimeout = useRef(null);

    const handleSearch = async (searchQuery) => {
        if (!searchQuery || searchQuery.trim().length < 2) {
            setResults([]);
            return;
        }

        try {
            setSearching(true);
            const data = await searchProducts(searchQuery);
            setResults(data.results || []);
        } catch (error) {
            addToast('Search failed. Make sure the backend is running.', 'error');
        } finally {
            setSearching(false);
        }
    };

    const handleInputChange = (e) => {
        const val = e.target.value;
        setQuery(val);

        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(() => handleSearch(val), 500);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            if (searchTimeout.current) clearTimeout(searchTimeout.current);
            handleSearch(query);
        }
    };

    const handleTrack = async (product) => {
        try {
            setTrackingIds(prev => new Set([...prev, product.id]));
            await trackProduct(product);
            addToast(`Now tracking "${product.name}"! Initial scrape in progress...`, 'success');
        } catch (error) {
            addToast(`Failed to track "${product.name}"`, 'error');
        } finally {
            setTrackingIds(prev => {
                const next = new Set(prev);
                next.delete(product.id);
                return next;
            });
        }
    };

    const handleViewDetails = async (product) => {
        if (expandedProduct === product.id) {
            setExpandedProduct(null);
            setProductDetails(null);
            return;
        }

        try {
            setExpandedProduct(product.id);
            setLoadingDetails(true);
            const details = await getProductDetails(product.id);
            setProductDetails(details);
        } catch (error) {
            addToast('Failed to load product details', 'error');
            setExpandedProduct(null);
        } finally {
            setLoadingDetails(false);
        }
    };

    const categoryIcons = {
        'Audio': '🎧',
        'Laptops': '💻',
        'Peripherals': '🖱️',
        'Smart Home': '🏠',
        'Power': '🔌',
        'Footwear': '👟',
        'Wearables': '⌚',
        'Cameras': '📷',
        'Storage': '💾',
        'Networking': '🌐',
    };

    return (
        <div className="fade-in">
            <div className="page-header">
                <h2>Search & Track Products</h2>
                <p>Search the INE mock store catalog and start tracking product prices</p>
            </div>

            {/* Search Bar */}
            <div className="search-container">
                <div className="search-input-wrapper">
                    <Search />
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search by product name, brand, category, or SKU..."
                        value={query}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        id="product-search-input"
                    />
                    {searching && (
                        <Loader2
                            size={18}
                            style={{
                                position: 'absolute',
                                right: '16px',
                                color: 'var(--accent-primary)',
                                animation: 'spin 1s linear infinite',
                            }}
                        />
                    )}
                </div>
            </div>

            {/* Results */}
            {results.length > 0 && (
                <div style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    Found {results.length} product{results.length !== 1 ? 's' : ''} matching "{query}"
                </div>
            )}

            {results.length === 0 && query.length >= 2 && !searching && (
                <div className="empty-state">
                    <Search size={64} />
                    <h3>No products found</h3>
                    <p>Try searching with a different term. You can search by product name, brand, category, or SKU.</p>
                </div>
            )}

            {results.length === 0 && query.length < 2 && (
                <div className="empty-state">
                    <ShoppingBag size={64} />
                    <h3>Start searching</h3>
                    <p>Type at least 2 characters to search the INE mock store catalog. Try searching for "headphones", "laptop", or a brand name.</p>
                </div>
            )}

            <div className="product-grid">
                {results.map(product => (
                    <div key={product.id} className="product-card" style={{ cursor: 'default' }}>
                        <div className="product-card-header">
                            <h3>
                                {categoryIcons[product.category] || '📦'} {product.name}
                            </h3>
                        </div>

                        <div className="product-card-meta">
                            <span className="badge badge-info">{product.category}</span>
                            <span className="badge badge-neutral">{product.brand}</span>
                            <span className="badge badge-neutral">{product.sku}</span>
                        </div>

                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.5' }}>
                            {product.description?.slice(0, 120)}{product.description?.length > 120 ? '...' : ''}
                        </p>

                        {/* Expanded Details */}
                        {expandedProduct === product.id && (
                            <div style={{
                                background: 'var(--bg-tertiary)',
                                borderRadius: 'var(--radius-sm)',
                                padding: '16px',
                                marginBottom: '16px',
                                animation: 'fadeIn 0.3s ease',
                            }}>
                                {loadingDetails ? (
                                    <div className="loading" style={{ padding: '20px' }}>
                                        <div className="spinner" style={{ width: '24px', height: '24px' }} />
                                        <p style={{ fontSize: '0.85rem' }}>Loading details...</p>
                                    </div>
                                ) : productDetails ? (
                                    <div>
                                        <h4 style={{ fontSize: '0.9rem', marginBottom: '12px', color: 'var(--accent-primary)' }}>
                                            Product Specifications
                                        </h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                            {Object.entries(productDetails.specs || {}).map(([key, value]) => (
                                                <div key={key} className="detail-info-row" style={{ padding: '6px 0' }}>
                                                    <span className="label" style={{ textTransform: 'capitalize' }}>
                                                        {key.replace(/([A-Z])/g, ' $1').trim()}
                                                    </span>
                                                    <span className="value">{String(value)}</span>
                                                </div>
                                            ))}
                                        </div>
                                        {productDetails.reviews?.length > 0 && (
                                            <div style={{ marginTop: '12px' }}>
                                                <h4 style={{ fontSize: '0.85rem', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                                                    Reviews ({productDetails.reviews.length})
                                                </h4>
                                                {productDetails.reviews.slice(0, 2).map(review => (
                                                    <div key={review.id} style={{
                                                        padding: '8px',
                                                        background: 'var(--bg-card)',
                                                        borderRadius: 'var(--radius-sm)',
                                                        marginBottom: '6px',
                                                        fontSize: '0.8rem',
                                                    }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                            <strong>{review.author}</strong>
                                                            <span>{'⭐'.repeat(review.rating)}</span>
                                                        </div>
                                                        <div style={{ fontWeight: 600, marginBottom: '2px' }}>{review.title}</div>
                                                        <div style={{ color: 'var(--text-secondary)' }}>{review.body.slice(0, 100)}...</div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        )}

                        <div className="product-card-actions">
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleTrack(product)}
                                disabled={trackingIds.has(product.id)}
                            >
                                {trackingIds.has(product.id) ? (
                                    <><Loader2 size={14} className="pulse" /> Tracking...</>
                                ) : (
                                    <><Plus size={14} /> Track Product</>
                                )}
                            </button>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleViewDetails(product)}
                            >
                                {expandedProduct === product.id ? 'Hide Details' : 'View Details'}
                            </button>
                        </div>

                        <div className="product-card-footer">
                            <span>Store ID: {product.id}</span>
                            <span>{product.slug}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default SearchPage;
