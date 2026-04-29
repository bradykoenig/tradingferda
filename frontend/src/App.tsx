import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import TradingSelect from './pages/TradingSelect';
import LongTermInvesting from './pages/LongTermInvesting';
import DayTrading from './pages/DayTrading';
import SportsBetting from './pages/SportsBetting';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Home />} />
              <Route path="/trading" element={<TradingSelect />} />
              <Route path="/trading/long-term" element={<LongTermInvesting />} />
              <Route path="/trading/day" element={<DayTrading />} />
              <Route path="/sports-betting" element={<SportsBetting />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
