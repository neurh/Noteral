import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useAppStore } from "../store";

export function Toasts() {
  const toasts = useAppStore((state) => state.toasts);
  const dismiss = useAppStore((state) => state.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-icon" aria-hidden="true">
            {toast.kind === "error" ? <AlertCircle size={16} /> : toast.kind === "success" ? <CheckCircle2 size={16} /> : <Info size={16} />}
          </span>
          <span>{toast.message}</span>
          <button type="button" className="icon-button tiny" aria-label="Dismiss notification" title="Dismiss notification" onClick={() => dismiss(toast.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
