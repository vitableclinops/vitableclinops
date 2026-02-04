import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { 
  LayoutDashboard, 
  MapPin, 
  ClipboardList, 
  Users, 
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Receipt,
  BarChart3,
  Shield,
  BookOpen
} from 'lucide-react';
import type { UserRole } from '@/types';

interface AppSidebarProps {
  userRole: UserRole;
  userName: string;
  userEmail: string;
}

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  roles: UserRole[];
}

const navItems: NavItem[] = [
  { 
    label: 'Dashboard', 
    icon: LayoutDashboard, 
    href: '/', 
    roles: ['provider', 'admin', 'leadership'] 
  },
  { 
    label: 'My States', 
    icon: MapPin, 
    href: '/states', 
    roles: ['provider'] 
  },
  { 
    label: 'My Tasks', 
    icon: ClipboardList, 
    href: '/tasks', 
    roles: ['provider'] 
  },
  { 
    label: 'Reimbursements', 
    icon: Receipt, 
    href: '/reimbursements', 
    roles: ['provider', 'admin'] 
  },
  { 
    label: 'All Providers', 
    icon: Users, 
    href: '/providers', 
    roles: ['admin', 'leadership'] 
  },
  { 
    label: 'Provider Intake', 
    icon: Users, 
    href: '/admin/intake', 
    roles: ['admin'] 
  },
  { 
    label: 'Agreements', 
    icon: Shield, 
    href: '/admin/agreements', 
    roles: ['admin'] 
  },
  { 
    label: 'Compliance', 
    icon: ClipboardList, 
    href: '/admin/compliance', 
    roles: ['admin'] 
  },
  { 
    label: 'State Directory', 
    icon: MapPin, 
    href: '/admin/states', 
    roles: ['admin'] 
  },
  { 
    label: 'Reports', 
    icon: BarChart3, 
    href: '/reports', 
    roles: ['admin', 'leadership'] 
  },
  { 
    label: 'Knowledge Base', 
    icon: BookOpen, 
    href: '/knowledge', 
    roles: ['provider', 'admin', 'leadership'] 
  },
];

export function AppSidebar({ userRole, userName, userEmail }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const filteredNavItems = navItems.filter(item => item.roles.includes(userRole));

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen bg-sidebar transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-sidebar-border">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <Shield className="h-6 w-6 text-sidebar-primary" />
              <span className="font-semibold text-sidebar-foreground">Credentialing</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-2 py-4 overflow-y-auto scrollbar-thin">
          {filteredNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            
            return (
              <NavLink
                key={item.href}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive 
                    ? 'bg-sidebar-accent text-sidebar-primary' 
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <Icon className={cn('h-5 w-5 shrink-0', isActive && 'text-sidebar-primary')} />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-sidebar-border p-4">
          <div className={cn(
            'flex items-center gap-3',
            collapsed && 'justify-center'
          )}>
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                {getInitials(userName)}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">{userName}</p>
                <p className="text-xs text-sidebar-muted truncate capitalize">{userRole}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
