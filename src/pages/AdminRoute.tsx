import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRole } from '@/hooks/useRole';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import AdminPage from './AdminPage';

export default function AdminRoute() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isValar, loading: roleLoading } = useRole(user);

  const needsLogin = !authLoading && !user;
  const accessDenied = !authLoading && !roleLoading && !!user && !isAdmin;

  useEffect(() => {
    if (accessDenied) toast.error('Admin access required');
  }, [accessDenied]);

  if (authLoading || roleLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <p className="font-display text-primary text-glow animate-pulse">Loading...</p>
      </div>
    );
  }

  if (needsLogin) {
    return <Navigate to="/" replace state={{ from: '/admin' }} />;
  }

  if (accessDenied) {
    return <Navigate to="/game" replace />;
  }

  return <AdminPage isValar={isValar} />;
}
