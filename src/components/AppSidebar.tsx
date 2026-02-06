import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  BookOpen,
  UserPlus,
  User,
  ChevronDown,
  Database,
  Power
} from 'lucide-react';
import type { UserRole } from '@/types';
import { useAuth } from '@/hooks/useAuth';

interface AppSidebarProps {
  userRole: UserRole;
  userName: string;
  userEmail: string;
  userAvatarUrl?: string;
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
    label: 'My Dashboard', 
    icon: ClipboardList, 
    href: '/provider', 
    roles: ['provider'] 
  },
  // Reimbursements - placeholder route (not yet implemented)
  // { 
  //   label: 'Reimbursements', 
  //   icon: Receipt, 
  //   href: '/reimbursements', 
  //   roles: ['provider', 'admin'] 
  // },
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
    roles: ['admin', 'physician'] 
  },
  { 
    label: 'Physician Portal', 
    icon: Users, 
    href: '/physician', 
    roles: ['physician'] 
  },
  { 
    label: 'States & Compliance', 
    icon: MapPin, 
    href: '/admin/states', 
    roles: ['admin'] 
  },
  { 
    label: 'Provider Grid', 
    icon: BarChart3, 
    href: '/grid', 
    roles: ['admin', 'leadership'] 
  },
  // Reports - placeholder route (not yet implemented)
  // { 
  //   label: 'Reports', 
  //   icon: BarChart3, 
  //   href: '/reports', 
  //   roles: ['admin', 'leadership'] 
  // },
  { 
    label: 'Knowledge Base', 
    icon: BookOpen, 
    href: '/knowledge', 
    roles: ['provider', 'admin', 'leadership'] 
  },
  { 
    label: 'Provider Directory', 
    icon: User, 
    href: '/directory', 
    roles: ['provider', 'admin', 'leadership'] 
  },
  { 
    label: 'Update My Info', 
    icon: UserPlus, 
    href: '/onboarding?mode=edit', 
    roles: ['provider'] 
  },
  { 
    label: 'Activation Queue', 
    icon: Power, 
    href: '/admin/activation', 
    roles: ['admin'] 
  },
  { 
    label: 'System Settings',
    icon: Settings, 
    href: '/admin/settings', 
    roles: ['admin'] 
  },
];

export function AppSidebar({ userRole, userName, userEmail, userAvatarUrl }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, roles } = useAuth();

  // Filter nav items based on ALL user roles, not just the primary one
  const filteredNavItems = navItems.filter(item => 
    item.roles.some(role => roles.includes(role))
  );

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

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

        {/* User section with dropdown */}
        <div className="border-t border-sidebar-border p-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'flex items-center gap-3 w-full rounded-lg p-2 hover:bg-sidebar-accent transition-colors',
                  collapsed && 'justify-center'
                )}
              >
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage src={userAvatarUrl} alt={userName} />
                  <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                    {getInitials(userName)}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-medium text-sidebar-foreground truncate">{userName}</p>
                      <p className="text-xs text-sidebar-muted truncate">{userEmail}</p>
                    </div>
                    <ChevronDown className="h-4 w-4 text-sidebar-muted shrink-0" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent 
              align={collapsed ? "center" : "end"} 
              side="top" 
              className="w-64"
            >
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-2">
                  <p className="text-sm font-medium">{userName}</p>
                  <p className="text-xs text-muted-foreground">{userEmail}</p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {roles.map(role => (
                      <Badge 
                        key={role} 
                        variant="secondary" 
                        className="text-xs capitalize"
                      >
                        {role}
                      </Badge>
                    ))}
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={() => navigate('/profile/settings')}
                className="cursor-pointer"
              >
                <Settings className="mr-2 h-4 w-4" />
                Profile Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={handleSignOut}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </aside>
  );
}
