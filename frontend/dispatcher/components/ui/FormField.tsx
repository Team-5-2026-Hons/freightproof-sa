interface FormFieldProps {
  label: string
  name: string
  type?: string
  value: string
  onChange: (name: string, value: string) => void
}

export function FormField({ label, name, type = 'text', value, onChange }: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-surface-on-variant">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest
                   text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </label>
  )
}
