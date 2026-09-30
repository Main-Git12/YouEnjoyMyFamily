interface MemberPickerProps {
  members: string[];
  value: string;
  onChange: (name: string) => void;
  /** Shown as a chip that clears the choice. Omit for a required field. */
  anyoneLabel?: string;
}

/**
 * One tap per name, instead of typing it. Faster on a wall-mounted screen,
 * and it's the thing that actually keeps a child's gems under one name —
 * see knownMembers.
 */
export default function MemberPicker({ members, value, onChange, anyoneLabel }: MemberPickerProps) {
  if (!members.length) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {anyoneLabel && (
        <button
          type="button"
          aria-pressed={value === ""}
          onClick={() => onChange("")}
          className={`rounded-full px-4 py-2 border ${
            value === "" ? "bg-olive-600 text-white border-olive-600" : "bg-white text-olive-700 border-olive-500"
          }`}
        >
          {anyoneLabel}
        </button>
      )}
      {members.map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={value === name}
          onClick={() => onChange(name)}
          className={`rounded-full px-4 py-2 border ${
            value === name ? "bg-olive-600 text-white border-olive-600" : "bg-white text-olive-700 border-olive-500"
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
