import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import {
  LayoutDashboard,
  Map,
  PawPrint,
  User,
  Swords,
  Hammer,
  Dice3,
  Users,
  Dna,
  Zap,
  Bug,
  MapPin,
  BookOpen,
  BookText,
  Store,
  Wrench,
} from 'lucide-react';


interface AdminSidebarProps {
  activeTab: string;
  onNavigate: (tab: string) => void;
  isValar: boolean;
}

const NAV_GROUPS = [
  {
    label: 'World',
    items: [
      { key: 'world', label: 'World Map', icon: Map },
    ],
  },
  {
    label: 'Content',
    items: [
      { key: 'creatures', label: 'Creatures', icon: PawPrint },
      { key: 'npcs', label: 'NPCs', icon: User },
      { key: 'items', label: 'Items', icon: Swords },
      { key: 'item-forge', label: 'Item Forge', icon: Hammer },
      { key: 'loot-tables', label: 'Loot Tables', icon: Dice3 },
    ],
  },

  {
    label: 'Players',
    items: [
      { key: 'users', label: 'Users', icon: Users },
    ],
  },
  {
    label: 'Systems',
    items: [
      { key: 'races-classes', label: 'Races & Classes', icon: Dna },
      { key: 'xp-boost', label: 'XP Boost', icon: Zap },
    ],
  },
  {
    label: 'Operations',
    items: [
      { key: 'tools', label: 'Tools', icon: Wrench },
      { key: 'issues', label: 'Issues', icon: Bug },
      { key: 'marketplace', label: 'Marketplace', icon: Store },
      { key: 'roadmap', label: 'Roadmap', icon: MapPin },
    ],
  },
  {
    label: 'Reference',
    items: [
      { key: 'rulebook', label: 'Rulebook', icon: BookOpen },
      { key: 'manual', label: 'Manual', icon: BookText },
    ],
  },
];

export default function AdminSidebar({ activeTab, onNavigate, isValar }: AdminSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="p-3 border-b border-border">
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="outline" className="text-[10px] font-display shrink-0 border-primary/40 text-primary">
              {isValar ? '⚡ Overlord' : '✨ Steward'}
            </Badge>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {/* Dashboard */}
        <SidebarMenu className="px-2 pt-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => onNavigate('dashboard')}
              isActive={activeTab === 'dashboard'}
              tooltip="Dashboard"
            >
              <LayoutDashboard className="h-4 w-4" />
              {!collapsed && <span>Dashboard</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="t-label text-[10px] tracking-wider opacity-70">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      onClick={() => onNavigate(item.key)}
                      isActive={activeTab === item.key}
                      tooltip={item.label}
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.label}</span>}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-2 border-t border-border">
        {!collapsed && (
          <p className="t-meta text-center">World Editor</p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
