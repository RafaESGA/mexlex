import type { PropsWithChildren, ReactNode } from "react";

type SectionCardProps = PropsWithChildren<{
  eyebrow?: string;
  title: string;
  description?: ReactNode;
}>;

export function SectionCard({ eyebrow, title, description, children }: SectionCardProps) {
  return (
    <section className="panel">
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <h2>{title}</h2>
      {description ? <p className="muted">{description}</p> : null}
      {children}
    </section>
  );
}

