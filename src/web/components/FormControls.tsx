import type { ReactNode } from "react";

export function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? "field--wide" : ""}`}>
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | number | null;
  onChange: (value: string) => void;
  options: Array<[string | number, string]>;
}) {
  return (
    <Field label={label}>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">未设定</option>
        {options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select>
    </Field>
  );
}

