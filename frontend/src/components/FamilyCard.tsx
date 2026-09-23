import type { ReactNode } from "react";

interface FamilyCardProps {
  title: string;
  children: ReactNode;
  /** The olive card — used once, for the day's schedule. */
  accent?: boolean;
  /**
   * The one card the screen is actually for. Takes the full width and a
   * louder heading, so a person walking past knows where to look. Eight
   * cards at identical weight give the eye nowhere to land.
   */
  hero?: boolean;
}

export default function FamilyCard({ title, children, accent = false, hero = false }: FamilyCardProps) {
  return (
    <section
      className={`rounded-card shadow-[var(--shadow-card)] p-5 sm:p-6 ${hero ? "md:col-span-2" : ""} ${
        accent ? "bg-olive-600 text-white" : "bg-white border-2 border-olive-100 text-bark"
      }`}
    >
      <h2 className={`font-display mb-3 ${hero ? "text-2xl sm:text-3xl text-olive-700" : "text-xl"}`}>{title}</h2>
      {children}
    </section>
  );
}
