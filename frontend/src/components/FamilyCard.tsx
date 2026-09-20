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
        accent ? "bg-olive-500 text-white" : "bg-white border-2 border-olive-100 text-bark"
      }`}
    >
      <h2 className="font-display text-xl mb-3">{title}</h2>
      {children}
    </section>
  );
}
