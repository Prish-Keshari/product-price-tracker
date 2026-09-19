import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Search, TrendingUp, Activity } from 'lucide-react';

function Sidebar() {
    const location = useLocation();

    const navItems = [
        { path: '/', icon: <LayoutDashboard />, label: 'Dashboard' },
        { path: '/search', icon: <Search />, label: 'Search & Track' },
    ];

    return (
        <aside className="sidebar">
            <div className="sidebar-logo">
                <h1>
                    <TrendingUp size={22} />
                    PriceTracker
                </h1>
                <p>INE Mock Store Monitor</p>
            </div>

            <nav className="sidebar-nav">
                {navItems.map(item => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        end={item.path === '/'}
                    >
                        {item.icon}
                        {item.label}
                    </NavLink>
                ))}
            </nav>

            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Activity size={14} style={{ color: 'var(--success)' }} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Scraping every 2 hours
                    </span>
                </div>
                <a
                    href="https://demo.inelabteamdev.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                    }}
                >
                    Mock Store ↗
                </a>
            </div>
        </aside>
    );
}

export default Sidebar;
