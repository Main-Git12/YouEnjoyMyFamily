import type { ComponentType } from "react";
import type { TomorrowBrief, TomorrowSignal } from "../lib/tomorrow";
import { CalendarIcon, CoatIcon, PlateIcon, SchoolBagIcon, StopwatchIcon, type IconProps } from "./icons";

interface TomorrowBriefingProps {
  brief: TomorrowBrief | null;
  /** Opens the panel a question points at. */
  onOpen?: (panel: NonNullable<TomorrowSignal["question"]>["panel"]) => void;
}

/**
 * Tomorrow, on tonight's screen.
 *
 * The one panel in this app that looks forward, and the design follows from
 * that. Each line is a fact with its evidence directly underneath in
 * smaller type — a claim about a day that has not happened yet is the
 * easiest kind to get wrong and the hardest to check, so it shows its
 * working more insistently than anything else here, not less.
 *
 * The outlook word — clear, busy, tight — is a summary and is never the
 * only thing on screen: the reasons that produced it sit right beside it,
 * because "tomorrow looks tight" with nothing behind it is a mood, and a
 * mood on a kitchen wall at nine in the evening is not help.
 */

const OUTLOOK_COPY: Record<string, { label: string; className: string }> = {
  clear: { label: "Looks clear", className: "bg-olive-100 text-olive-800" },
  busy: { label: "Looks busy", className: "bg-sand-100 text-clay-900" },
  tight: { label: "Looks tight", className: "bg-clay-100 text-clay-900 ring-2 ring-clay-300" },
};

const MARK: Record<TomorrowSignal["kind"], ComponentType<IconProps>> = {
  calendar: CalendarIcon,
  school: SchoolBagIcon,
  meal: PlateIcon,
  morning: StopwatchIcon,
  weather: CoatIcon,
};

export default function TomorrowBriefing({ brief, onOpen }: TomorrowBriefingProps) {
  if (!brief) {
    return (
      <p className="text-olive-700 italic">
        Nothing standing out about tomorrow — this fills in during the evening when there is.
      </p>
    );
  }

  const outlook = brief.outlook ? OUTLOOK_COPY[brief.outlook.tightness] : null;

  return (
    <div className="space-y-4">
      {brief.outlook && outlook && (
        <div>
          <span className={`inline-block rounded-full px-4 py-1.5 font-body ${outlook.className}`}>
            {outlook.label}
          </span>
          {/* The reasons, never the verdict alone. */}
          <p className="text-olive-700 mt-2 leading-snug">{brief.outlook.because}.</p>
        </div>
      )}

      <ul className="space-y-3">
        {brief.signals.map((signal) => {
          const Mark = MARK[signal.kind];
          return (
          <li key={signal.id} className="bg-olive-50 rounded-card px-4 py-3">
            <div className="flex items-start gap-3">
              <Mark size={22} className="shrink-0 mt-0.5 text-olive-600" />
              <div className="min-w-0">
                <p className="text-olive-900 leading-snug">{signal.headline}</p>
                <p className="text-sm text-olive-600 mt-0.5">{signal.because}</p>
                {signal.question && (
                  <button
                    type="button"
                    onClick={() => onOpen?.(signal.question!.panel)}
                    className="mt-2 text-olive-700 underline underline-offset-2 py-1"
                  >
                    {signal.question.label}
                  </button>
                )}
              </div>
            </div>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
