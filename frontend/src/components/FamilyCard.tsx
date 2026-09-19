import type { ReactNode } from "react";

interface FamilyCardProps {
  title: string;
  children: ReactNode;
  accent?: boolean;
}

export default function FamilyCard({ title, children, accent = false }: FamilyCardProps) {
  return (
    <section
      className={`rounded-card shadow-[var(--shadow-card)] p-6 ${
        accent ? "bg-clay-300 text-olive-900" : "bg-sand-50 text-bark"
      }`}
    >
      <h2 className="font-display text-xl mb-3">{title}</h2>
      {children}
    </section>
  );
}
