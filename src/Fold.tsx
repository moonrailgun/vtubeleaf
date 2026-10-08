import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from './components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './components/ui/collapsible';

export function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Collapsible className="fold">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="fold-trigger">
          {title}
          <ChevronDown aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="fold-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}
