import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Frosted inspector sheet sliding in from the right over the current view. Stays mounted so open and close
 * run the same path (transitions, not keyframes, so a re-trigger mid-flight reverses). Esc or the scrim closes.
 */
export default function SlideOver({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <>
      <div
        className="al-scrim"
        data-open={open}
        onClick={onClose}
        style={{ pointerEvents: open ? "auto" : "none" }}
        aria-hidden="true"
      />
      <aside
        className="al-sheet"
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-hidden={!open}
        style={{ pointerEvents: open ? "auto" : "none" }}
      >
        {children}
      </aside>
    </>,
    document.body,
  );
}
