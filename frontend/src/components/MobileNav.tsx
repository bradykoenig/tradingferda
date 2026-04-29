import { NavLink } from 'react-router-dom';
import { Home, TrendingUp, Zap, Activity } from 'lucide-react';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/trading/long-term', label: 'Long-Term', icon: TrendingUp },
  { to: '/trading/day', label: 'Day', icon: Zap },
  { to: '/sports-betting', label: 'Sports', icon: Activity },
];

export default function MobileNav() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 z-50">
      <div className="flex">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors duration-150 ${
                isActive ? 'text-zinc-100' : 'text-zinc-500'
              }`
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
