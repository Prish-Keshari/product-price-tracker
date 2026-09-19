import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

function ToastContainer({ toasts, onDismiss }) {
    return (
        <div className="toast-container">
            {toasts.map(toast => (
                <div key={toast.id} className={`toast toast-${toast.type}`}>
                    {toast.type === 'success' && <CheckCircle size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />}
                    {toast.type === 'error' && <AlertCircle size={18} style={{ color: 'var(--error)', flexShrink: 0 }} />}
                    {toast.type === 'info' && <Info size={18} style={{ color: 'var(--info)', flexShrink: 0 }} />}
                    <span className="toast-message">{toast.message}</span>
                    <button
                        className="btn-ghost btn-icon"
                        onClick={() => onDismiss(toast.id)}
                        style={{ padding: '4px' }}
                    >
                        <X size={14} />
                    </button>
                </div>
            ))}
        </div>
    );
}

export default ToastContainer;
