import { ReactNode } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import AdminSidebar from './AdminSidebar';
import AdminGlobalSearch from './AdminGlobalSearch';

interface AdminLayoutProps {
  children: ReactNode;
  activeTab: string;
  onNavigate: (tab: string) => void;
  isValar: boolean;
}

export default function AdminLayout({ children, activeTab, onNavigate, isValar }: AdminLayoutProps) {
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
