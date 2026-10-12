import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

/* ---------------- Rating (1–5 stars) ---------------- */
export function RatingInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="rating">
      <div className="rating-pips">
        {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => (
          <button
            type="button"
            key={n}
            className={value != null && n <= value ? "on" : ""}
              aria-label={`${n} out of 5`}
            onClick={() => onChange(value === n ? null : n)}
          />
        ))}
      </div>
        <span className="rating-value">{value != null ? `${value}/5` : "—"}</span>
    </div>
  );
}

export function RatingBadge({ value, count }: { value: number | null; count?: number }) {
  if (value == null) return <span className="faint" style={{ fontSize: 12 }}>no ratings yet</span>;
  return (
      <span className="rating-badge" aria-label={`${value.toFixed(1)} out of 5 from ${count ?? 0} rating${count === 1 ? "" : "s"}`}>
        ★ {value.toFixed(1)} / 5
      {count != null && <span className="faint"> ({count})</span>}
    </span>
  );
}

/* ---------------- Button ---------------- */
type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  variant = "secondary",
  size,
  block,
  loading,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm";
  block?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      className={[
        "btn",
        `btn-${variant}`,
        size === "sm" ? "btn-sm" : "",
        block ? "btn-block" : "",
        className,
      ].join(" ")}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : children}
    </button>
  );
}

/* ---------------- Field ---------------- */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/* ---------------- Card ---------------- */
export function Card({
  title,
  children,
  className = "",
  ...rest
}: { title?: string; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${className}`} {...rest}>
      {title && <div className="card-title">{title}</div>}
      {children}
    </div>
  );
}

/* ---------------- Badge ---------------- */
export function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

/* ---------------- PageHeader ---------------- */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

/* ---------------- EmptyState ---------------- */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/* ---------------- Spinner block ---------------- */
export function Loading({ label }: { label?: string }) {
  return (
    <div className="center-pad">
      <span className="spinner" />
      {label && <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>{label}</div>}
    </div>
  );
}

/* ---------------- Toast ---------------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 2400);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}
