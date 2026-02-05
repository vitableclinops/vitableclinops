import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RelatedLink {
  label: string;
  href: string;
  description?: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string }>;
  external?: boolean;
}

interface RelatedLinksCardProps {
  title?: string;
  links: RelatedLink[];
  className?: string;
}

export const RelatedLinksCard = ({ 
  title = 'Related', 
  links,
  className 
}: RelatedLinksCardProps) => {
  if (links.length === 0) return null;

  return (
    <Card className={cn('', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {links.map((link, index) => {
          const Icon = link.icon;
          const content = (
            <div className="flex items-center gap-3 p-2 rounded-md hover:bg-muted transition-colors group cursor-pointer">
              {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                  {link.label}
                </p>
                {link.description && (
                  <p className="text-xs text-muted-foreground truncate">
                    {link.description}
                  </p>
                )}
              </div>
              {link.count !== undefined && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {link.count}
                </span>
              )}
              {link.external ? (
                <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>
          );

          if (link.external) {
            return (
              <a
                key={index}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {content}
              </a>
            );
          }

          return (
            <Link key={index} to={link.href}>
              {content}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
};
