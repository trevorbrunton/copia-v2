"use client";

/**
 * Tavus persona radio group, shared between v1 (`/demo`) and v2
 * (`/demo/screen`). Reads ticker IDs from the public env vars; filters
 * out unset slots so a missing env doesn't show an empty option.
 */
export const PERSONA_OPTIONS = [
  { id: process.env.NEXT_PUBLIC_TAVUS_PERSONA_GENERIC ?? "", label: "Generic" },
  { id: process.env.NEXT_PUBLIC_TAVUS_PERSONA_CUSTOM ?? "", label: "Custom" },
].filter((p) => p.id);

export type PersonaOption = (typeof PERSONA_OPTIONS)[number];

interface PersonaSelectorProps {
  selectedId: string;
  onChange: (id: string) => void;
  className?: string;
}

export function PersonaSelector({ selectedId, onChange, className }: PersonaSelectorProps) {
  if (PERSONA_OPTIONS.length === 0) return null;

  return (
    <div className={className ?? "flex items-center gap-4"}>
      {PERSONA_OPTIONS.map((p) => (
        <label
          key={p.id}
          className="flex items-center gap-1.5 cursor-pointer text-xs text-white/70 hover:text-white/90"
        >
          <input
            type="radio"
            name="persona"
            value={p.id}
            checked={selectedId === p.id}
            onChange={() => onChange(p.id)}
            className="accent-white"
          />
          {p.label}
        </label>
      ))}
    </div>
  );
}
