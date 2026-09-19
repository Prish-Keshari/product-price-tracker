import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, RefreshCw, TrendingUp, TrendingDown,
    Clock, CheckCircle, XCircle, AlertTriangle,
    BarChart3, List, Package, Activity
} from 'lucide-react';
import {
    LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { getTrackedProducts, getPriceHistory, getScrapeLogs, triggerScrape } from '../api';
import { format, formatDistanceToNow } from 'date-fns';

function ProductDetail({ addToast }) {
    const { id } = useParams();
    const navigate = useNavigate();
    const [product, setProduct] = useState(null);
    const [priceHistory, setPriceHistory] = useState([]);
    const [scrapeLogs, setScrapeLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('chart');
    const [scraping, setScraping] = useState(false);

    useEffect(() => {
        loadData();
    }, [id]);

    const loadData = async () => {
        try {
            setLoading(true);
            const [products, history, logs] = await Promise.all([
                getTrackedProducts(),
                getPriceHistory(id),
                getScrapeLogs(id),
            ]);

            const found = products.find(p => p.id === id);
            setProduct(found);
            setPriceHistory(history);
            setScrapeLogs(logs);
        } catch (error) {
            addToast('Failed to load product data', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleScrape = async () => {
        try {
            setScraping(true);
            await triggerScrape(id);
            addToast('Scrape triggered! Results will appear in a few seconds.', 'success');
            setTimeout(loadData, 15000);
        } catch (error) {
            addToast('Failed to trigger scrape', 'error');
        } finally {
            setScraping(false);
        }
    };

    if (loading) {
        return (
            <div className="loading">
                <div className="spinner" />
                <p>Loading product data...</p>
            </div>
        );
    }

    if (!product) {
        return (
            <div className="empty-state">
                <Package size={64} />
                <h3>Product not found</h3>
                <p>This product may have been untracked.</p>
                <button className="btn btn-primary" onClick={() => navigate('/')}>
                    Go to Dashboard
                </button>
            </div>
        );
    }

    // Format chart data
    const chartData = priceHistory.map(h => ({
        date: format(new Date(h.recorded_at), 'MMM dd HH:mm'),
        price: h.price ? parseFloat(h.price) : null,
        stock: h.stock,
        fullDate: format(new Date(h.recorded_at), 'PPpp'),
    }));

    // Stats
    const prices = priceHistory.filter(h => h.price).map(h => parseFloat(h.price));
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    const avgPrice = prices.length ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2) : 0;
    const totalScrapes = scrapeLogs.length;
    const successfulScrapes = scrapeLogs.filter(l => l.success).length;
    const failedScrapes = totalScrapes - successfulScrapes;
    const successRate = totalScrapes ? ((successfulScrapes / totalScrapes) * 100).toFixed(0) : 0;

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px',
                    fontSize: '0.8rem',
                }}>
                    <p style={{ fontWeight: 600, marginBottom: '4px' }}>{payload[0]?.payload?.fullDate}</p>
                    {payload.map((p, i) => (
                        <p key={i} style={{ color: p.color }}>
                            {p.name}: {p.name === 'Price' ? `₹${p.value?.toLocaleString()}` : p.value}
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="fade-in">
            {/* Header */}
            <div className="detail-header">
                <button className="back-btn" onClick={() => navigate('/')}>
                    <ArrowLeft size={18} /> Back to Dashboard
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
                <div>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '6px' }}>{product.name}</h2>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <span className="badge badge-info">{product.category}</span>
                        <span className="badge badge-neutral">{product.brand}</span>
                        <span className="badge badge-neutral">{product.sku}</span>
                    </div>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={handleScrape}
                    disabled={scraping}
                >
                    <RefreshCw size={16} className={scraping ? 'pulse' : ''} />
                    {scraping ? 'Scraping...' : 'Scrape Now'}
                </button>
            </div>

            {/* Stats */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon purple">
                        <TrendingUp size={20} />
                    </div>
                    <div className="stat-info">
                        <h4>Current Price</h4>
                        <div className="stat-value">
                            {product.current_price ? `₹${parseFloat(product.current_price).toLocaleString()}` : '—'}
                        </div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon green">
                        <TrendingDown size={20} />
                    </div>
                    <div className="stat-info">
                        <h4>Price Range</h4>
                        <div className="stat-value" style={{ fontSize: '1rem' }}>
                            {minPrice ? `₹${minPrice.toLocaleString()} – ₹${maxPrice.toLocaleString()}` : '—'}
                        </div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon blue">
                        <Activity size={20} />
                    </div>
                    <div className="stat-info">
                        <h4>Success Rate</h4>
                        <div className="stat-value">{successRate}%</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon yellow">
                        <Clock size={20} />
                    </div>
                    <div className="stat-info">
                        <h4>Last Scraped</h4>
                        <div className="stat-value" style={{ fontSize: '0.9rem' }}>
                            {product.last_scraped_at
                                ? formatDistanceToNow(new Date(product.last_scraped_at), { addSuffix: true })
                                : 'Never'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'chart' ? 'active' : ''}`}
                    onClick={() => setActiveTab('chart')}
                >
                    <BarChart3 size={14} style={{ marginRight: '6px' }} />
                    Price Chart
                </button>
                <button
                    className={`tab ${activeTab === 'table' ? 'active' : ''}`}
                    onClick={() => setActiveTab('table')}
                >
                    <List size={14} style={{ marginRight: '6px' }} />
                    Price History
                </button>
                <button
                    className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
                    onClick={() => setActiveTab('logs')}
                >
                    <Activity size={14} style={{ marginRight: '6px' }} />
                    Scrape Logs ({totalScrapes})
                </button>
            </div>

            {/* Chart View */}
            {activeTab === 'chart' && (
                <div className="chart-container">
                    <h3>
                        <BarChart3 size={18} /> Price & Stock Over Time
                    </h3>
                    {chartData.length === 0 ? (
                        <div className="empty-state">
                            <BarChart3 size={48} />
                            <h3>No price data yet</h3>
                            <p>Price data will appear here after the first successful scrape.</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height={350}>
                            <AreaChart data={chartData}>
                                <defs>
                                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="stockGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fill: '#8888a0', fontSize: 11 }}
                                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                />
                                <YAxis
                                    yAxisId="price"
                                    tick={{ fill: '#8888a0', fontSize: 11 }}
                                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                    tickFormatter={(v) => `₹${v}`}
                                />
                                <YAxis
                                    yAxisId="stock"
                                    orientation="right"
                                    tick={{ fill: '#8888a0', fontSize: 11 }}
                                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend />
                                <Area
                                    yAxisId="price"
                                    type="monotone"
                                    dataKey="price"
                                    name="Price"
                                    stroke="#818cf8"
                                    fill="url(#priceGradient)"
                                    strokeWidth={2}
                                    dot={{ fill: '#818cf8', r: 3 }}
                                    activeDot={{ r: 5 }}
                                />
                                <Area
                                    yAxisId="stock"
                                    type="stepAfter"
                                    dataKey="stock"
                                    name="Stock"
                                    stroke="#34d399"
                                    fill="url(#stockGradient)"
                                    strokeWidth={2}
                                    dot={{ fill: '#34d399', r: 3 }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            )}

            {/* Table View */}
            {activeTab === 'table' && (
                <div className="card">
                    <div className="table-container">
                        {priceHistory.length === 0 ? (
                            <div className="empty-state">
                                <List size={48} />
                                <h3>No history yet</h3>
                                <p>Price history will appear here after scraping.</p>
                            </div>
                        ) : (
                            <table>
                                <thead>
                                    <tr>
                                        <th>Date & Time</th>
                                        <th>Price</th>
                                        <th>Original Price</th>
                                        <th>Stock</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {priceHistory.slice().reverse().map(record => (
                                        <tr key={record.id}>
                                            <td>{format(new Date(record.recorded_at), 'PPpp')}</td>
                                            <td style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                                                {record.price ? `₹${parseFloat(record.price).toLocaleString()}` : '—'}
                                            </td>
                                            <td style={{ color: 'var(--text-secondary)' }}>
                                                {record.original_price ? `₹${parseFloat(record.original_price).toLocaleString()}` : '—'}
                                            </td>
                                            <td>
                                                {record.stock === null || record.stock === undefined ? (
                                                    <span className="badge badge-warning">Unknown</span>
                                                ) : record.stock === 0 ? (
                                                    <span className="badge badge-error">Out of stock</span>
                                                ) : record.stock === -1 ? (
                                                    <span className="badge badge-success">In stock</span>
                                                ) : (
                                                    <span className="badge badge-success">{record.stock} units</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {/* Scrape Logs */}
            {activeTab === 'logs' && (
                <div className="card">
                    <div className="card-header">
                        <h3>
                            <Activity size={18} /> Scrape Log
                        </h3>
                        <div style={{ display: 'flex', gap: '12px', fontSize: '0.8rem' }}>
                            <span style={{ color: 'var(--success)' }}>✓ {successfulScrapes} success</span>
                            <span style={{ color: 'var(--error)' }}>✗ {failedScrapes} failed</span>
                        </div>
                    </div>
                    <div className="table-container">
                        {scrapeLogs.length === 0 ? (
                            <div className="empty-state">
                                <Activity size={48} />
                                <h3>No scrape logs yet</h3>
                                <p>Logs will appear here after scraping attempts.</p>
                            </div>
                        ) : (
                            <table>
                                <thead>
                                    <tr>
                                        <th>Status</th>
                                        <th>Date & Time</th>
                                        <th>Price</th>
                                        <th>Stock</th>
                                        <th>Method</th>
                                        <th>Duration</th>
                                        <th>Attempts</th>
                                        <th>Error</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {scrapeLogs.map(log => (
                                        <tr key={log.id}>
                                            <td>
                                                {log.success ? (
                                                    <span className="badge badge-success">
                                                        <CheckCircle size={12} /> Success
                                                    </span>
                                                ) : (
                                                    <span className="badge badge-error">
                                                        <XCircle size={12} /> Failed
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ fontSize: '0.8rem' }}>
                                                {format(new Date(log.scraped_at), 'PPpp')}
                                            </td>
                                            <td style={{ fontWeight: 600, color: log.price ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
                                                {log.price ? `₹${parseFloat(log.price).toLocaleString()}` : '—'}
                                            </td>
                                            <td>{log.stock !== null ? log.stock : '—'}</td>
                                            <td>
                                                <span className="badge badge-neutral">{log.method || 'playwright'}</span>
                                            </td>
                                            <td style={{ fontSize: '0.8rem' }}>
                                                {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '—'}
                                            </td>
                                            <td>{log.attempt_count || 1}</td>
                                            <td style={{ fontSize: '0.8rem', color: 'var(--error)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {log.error_message || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default ProductDetail;
