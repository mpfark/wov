import { useAuth } from '@/hooks/useAuth';
import { useRole } from '@/hooks/useRole';
import { Navigate } from 'react-router-dom';
import AdminPage from './AdminPage';

export default function AdminRoute() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isValar, loading: roleLoading } = useRole(user);

  if (authLoading || roleLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <p className="font-display text-primary text-glow animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/game" replace />;
  }

  return <AdminPage onBack={() => { window.close(); window.location.href = '/'; }} isValar={isValar} />;
}
