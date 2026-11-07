import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-lg border border-border bg-background shadow-card", className)}
      {...props}
    />
  );
}

type CardHeaderProps = Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
};

export function CardHeader({ title, description, actions, icon, className, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn("flex items-start justify-between gap-3 border-b border-border px-4 py-3", className)}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-2">
        {icon ? <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}
