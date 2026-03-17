import { useGameContext } from '@/contexts/GameContext';
import { useNavigate } from 'react-router-dom';
import AdminPage from './AdminPage';

export default function AdminRoute() {
  const { user, authLoading, isAdmin, isValar } = useGameContext();
  const navigate = useNavigate();

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <p className="font-display text-primary text-glow animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!user || !isAdmin) {
    navigate('/', { replace: true });
    return null;
  }

  return <AdminPage onBack={() => { window.close(); navigate('/'); }} isValar={isValar} />;
}
