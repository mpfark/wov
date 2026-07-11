import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Swords } from 'lucide-react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import AdminSidebar from './AdminSidebar';
import AdminGlobalSearch from './AdminGlobalSearch';

interface AdminLayoutProps {
  children: ReactNode;
  activeTab: string;
  onNavigate: (tab: string) => void;
  isValar: boolean;
}

export default function AdminLayout({ children, activeTab, onNavigate, isValar }: AdminLayoutProps) {
  const navigate = useNavigate();

  const handlePlay = () => {
    // Go to character selection screen
    navigate('/');
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate('/', { replace: true });
  };

  return (
    <SidebarProvider>
      <div className="h-screen flex w-full parchment-bg overflow-hidden">
        <AdminSidebar
          activeTab={activeTab}
          onNavigate={onNavigate}
          isValar={isValar}
        />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header bar */}
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border bg-card/50 shrink-0">
            <SidebarTrigger className="h-7 w-7" />
            <div className="flex-1" />
            <AdminGlobalSearch onNavigate={onNavigate} />
            <Button
              variant="outline"
              size="sm"
              onClick={handlePlay}
              className="font-display text-xs h-7"
              title="Go to character selection"
            >
              <Swords className="w-3 h-3 mr-1" />
              Play
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="font-display text-xs h-7"
              title="Sign out"
            >
              <LogOut className="w-3 h-3 mr-1" />
              Sign Out
            </Button>
          </div>
          {/* Content */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}

