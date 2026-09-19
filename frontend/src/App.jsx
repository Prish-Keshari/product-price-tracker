import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import SearchPage from './pages/SearchPage';
import ProductDetail from './pages/ProductDetail';
import ToastContainer from './components/ToastContainer';
import './App.css';

function App() {
  const [toasts, setToasts] = useState([]);

  const addToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  return (
    <Router>
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard addToast={addToast} />} />
            <Route path="/search" element={<SearchPage addToast={addToast} />} />
            <Route path="/product/:id" element={<ProductDetail addToast={addToast} />} />
          </Routes>
        </main>
        <ToastContainer toasts={toasts} onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
      </div>
    </Router>
  );
}

export default App;
