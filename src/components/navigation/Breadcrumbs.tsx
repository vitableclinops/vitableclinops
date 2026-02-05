import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items?: BreadcrumbItem[];
  className?: string;
}

// Auto-generate breadcrumbs from path if items not provided
const pathLabels: Record<string, string> = {
  '': 'Dashboard',
  'admin': 'Admin',
  'states': 'States',
  'providers': 'Providers',
  'directory': 'Provider Directory',
  'agreements': 'Agreements',
  'compliance': 'Compliance',
  'grid': 'Provider Grid',
  'intake': 'Provider Intake',
  'import': 'Data Import',
  'roles': 'User Roles',
  'tasks': 'Tasks',
  'knowledge': 'Knowledge Base',
  'profile': 'Profile',
  'settings': 'Settings',
  'physicians': 'Physicians',
  'meetings': 'Meetings',
};

export const Breadcrumbs = ({ items, className }: BreadcrumbsProps) => {
  const location = useLocation();

  // Generate breadcrumbs from path if not provided
  const breadcrumbs: BreadcrumbItem[] = items || (() => {
    const pathParts = location.pathname.split('/').filter(Boolean);
    const crumbs: BreadcrumbItem[] = [];
    
    let currentPath = '';
    pathParts.forEach((part, index) => {
      currentPath += `/${part}`;
      const isLast = index === pathParts.length - 1;
      
      // Check if it's a UUID (detail page)
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part);
      
      crumbs.push({
        label: isUuid ? 'Details' : (pathLabels[part] || part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' ')),
        href: isLast ? undefined : currentPath,
      });
    });
    
    return crumbs;
  })();

  if (breadcrumbs.length === 0) return null;

  return (
    <nav className={cn('flex items-center gap-1 text-sm', className)}>
      <Link
        to="/"
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <Home className="h-4 w-4" />
      </Link>
      
      {breadcrumbs.map((item, index) => (
        <div key={index} className="flex items-center gap-1">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          {item.href ? (
            <Link
              to={item.href}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium">{item.label}</span>
          )}
        </div>
      ))}
    </nav>
  );
};
