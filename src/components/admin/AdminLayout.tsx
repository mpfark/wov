import { ReactNode } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import AdminSidebar from './AdminSidebar';
import AdminGlobalSearch from './AdminGlobalSearch';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AdminLayoutProps {
  children: ReactNode;
  activeTab: string;
  onNavigate: (tab: string) => void;
  onBack: () => void;
  isValar: boolean;
}

const TAB_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  world: 'World Map',
  creatures: 'Creatures',
  npcs: 'NPCs',
  items: 'Items',
  'loot-tables': 'Loot Tables',
  'item-forge': 'Item Forge',
  users: 'Users',
  'races-classes': 'Races & Classes',
  'xp-boost': 'XP Boost',
  issues: 'Issues',
  roadmap: 'Roadmap',
  rulebook: 'Rulebook',
  manual: 'Manual',
};

export default function AdminLayout({ children, activeTab, onNavigate, onBack, isValar }: AdminLayoutProps) {
  return (
    <SidebarProvider>
      <div className="h-screen flex w-full parchment-bg overflow-hidden">
        <AdminSidebar
          activeTab={activeTab}
          onNavigate={onNavigate}
          onBack={onBack}
          isValar={isValar}
        />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header bar */}
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border bg-card/50 shrink-0">
            <SidebarTrigger className="h-7 w-7" />
            <h1 className="font-display text-sm text-primary text-glow truncate">
              {TAB_TITLES[activeTab] || 'Admin'}
            </h1>
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
