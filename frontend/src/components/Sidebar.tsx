import { NavLink, useNavigate } from 'react-router-dom';
import { Home, TrendingUp, Zap, Activity, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/trading/long-term', label: 'Long-Term', icon: TrendingUp },
  { to: '/trading/day', label: 'Day Trading', icon: Zap },
  { to: '/sports-betting', label: 'Sports Betting', icon: Activity },
];

export default function Sidebar() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <aside className="hidden md:flex flex-col w-56 bg-zinc-900 border-r border-zinc-800 min-h-screen shrink-0">
      <div className="px-6 py-6 border-b border-zinc-800">
        <span className="text-sm font-semibold tracking-[0.2em] uppercase text-zinc-100">SCHLIMA</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-zinc-800">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors duration-150"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
