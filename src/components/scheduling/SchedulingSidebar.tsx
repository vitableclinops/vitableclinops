import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertCircle,
  CalendarCheck,
  Brain,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  HelpCircle,
  LogOut,
  LayoutDashboard,
  Map as MapIcon,
  Send,
  User,
  ChevronDown,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface SchedulingSidebarProps {
  userName: string;
  userEmail: string;
  userAvatarUrl?: string;
  showAdminDashboardLink?: boolean;
}

const items = [
  { label: 'Readiness', icon: CalendarCheck, href: '/scheduling/workbench?section=readiness&scope=all' },
  { label: 'Review', icon: AlertCircle, href: '/scheduling/workbench?section=review&view=decisions&scope=all' },
  { label: 'Coverage Plan', icon: MapIcon, href: '/scheduling/workbench?section=coverage-plan&view=coverage&scope=all' },
  { label: 'Publish', icon: Send, href: '/scheduling/workbench?section=publish&view=provider&scope=all' },
  { label: 'Homebase Schedule', icon: Database, href: '/scheduling/homebase-schedule' },
  { label: 'Mental Health', icon: Brain, href: '/scheduling/workbench?section=readiness&scope=mental_health' },
  { label: 'Exceptions', icon: ClipboardList, href: '/scheduling/workbench?section=exceptions&scope=all' },
  { label: 'Data Sources', icon: HelpCircle, href: '/scheduling/workbench?section=data-sources&scope=all' },
];

export function SchedulingSidebar({
  userName,
  userEmail,
  userAvatarUrl,
  showAdminDashboardLink = false,
}: SchedulingSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const visibleItems = showAdminDashboardLink
    ? [{ label: 'Admin Dashboard', icon: LayoutDashboard, href: '/admin' }, ...items]
    : items;

  const initials = userName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen bg-sidebar border-r transition-all duration-300',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className="flex h-full flex-col">
        <div className={cn('flex items-center gap-2 px-4 py-4 border-b', collapsed && 'justify-center px-2')}>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-sidebar-foreground">Vitable Scheduling</span>
              <span className="text-xs text-muted-foreground">Publish workspace</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-7 w-7 ml-auto', collapsed && 'ml-0')}
            onClick={() => setCollapsed(c => !c)}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-1">
          {visibleItems.map(item => {
            const [path, query = ''] = item.href.split('?');
            const itemParams = new URLSearchParams(query);
            const currentParams = new URLSearchParams(location.search);
            const active =
              location.pathname === path &&
              (query
                ? Array.from(itemParams.entries()).every(
                    ([key, value]) => currentParams.get(key) === value,
                  )
                : location.search === '');
            return (
              <NavLink
                key={item.href}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
                  collapsed && 'justify-center px-2',
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn('w-full justify-start gap-2 px-2', collapsed && 'justify-center')}
              >
                <Avatar className="h-7 w-7">
                  <AvatarImage src={userAvatarUrl} />
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <>
                    <div className="flex flex-col items-start text-left min-w-0">
                      <span className="text-xs font-medium truncate max-w-[140px]">{userName}</span>
                      <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                        {userEmail}
                      </span>
                    </div>
                    <ChevronDown className="h-3 w-3 ml-auto opacity-60" />
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{userName}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/profile/settings')}>
                <User className="h-4 w-4 mr-2" /> Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </aside>
  );
}
