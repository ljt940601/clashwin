import React from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Button, TextField } from "./basic";
import { t } from "@/i18n";

/* ---------- Modal ---------- */
export function Modal({
  open,
  onClose,
  title,
  desc,
  width = 440,
  footer,
  children,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  desc?: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  closeOnBackdrop?: boolean;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="ui-modal-backdrop" onMouseDown={() => closeOnBackdrop && onClose()}>
      <div className="ui-modal" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        {title && <div className="ui-modal-head">{title}</div>}
        {desc && <div className="ui-modal-desc">{desc}</div>}
        {children && <div className="ui-modal-body">{children}</div>}
        {footer && <div className="ui-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Promise-based confirm / prompt ---------- */
interface DialogReq {
  id: number;
  kind: "confirm" | "prompt";
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  defaultValue?: string;
  placeholder?: string;
  resolve: (v: any) => void;
}
const useDialogStore = create<{ queue: DialogReq[]; push: (d: DialogReq) => void; pop: (id: number) => void }>((set) => ({
  queue: [],
  push: (d) => set((s) => ({ queue: [...s.queue, d] })),
  pop: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),
}));
let dialogSeq = 0;

export function confirm(opts: { title: string; message?: string; confirmText?: string; cancelText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => useDialogStore.getState().push({ id: ++dialogSeq, kind: "confirm", ...opts, resolve }));
}

export function prompt(opts: { title: string; message?: string; defaultValue?: string; placeholder?: string; confirmText?: string }): Promise<string | null> {
  return new Promise((resolve) => useDialogStore.getState().push({ id: ++dialogSeq, kind: "prompt", ...opts, resolve }));
}

function DialogView({ d }: { d: DialogReq }) {
  const pop = useDialogStore((s) => s.pop);
  const [val, setVal] = React.useState(d.defaultValue ?? "");
  const done = (v: any) => {
    pop(d.id);
    d.resolve(v);
  };
  const cancelValue = d.kind === "confirm" ? false : null;
  const okValue = d.kind === "confirm" ? true : val;
  return (
    <Modal
      open
      width={380}
      onClose={() => done(cancelValue)}
      title={
        <>
          {d.danger && <AlertTriangle size={16} color="var(--orange)" />}
          {d.title}
        </>
      }
      desc={d.message}
      footer={
        <>
          <Button onClick={() => done(cancelValue)}>{d.cancelText ?? t("common.cancel")}</Button>
          <Button variant={d.danger ? "danger" : "primary"} onClick={() => done(okValue)} autoFocus>
            {d.confirmText ?? t("common.ok")}
          </Button>
        </>
      }
    >
      {d.kind === "prompt" ? (
        <TextField
          value={val}
          onChange={setVal}
          placeholder={d.placeholder}
          autoFocus
          style={{ width: "100%" }}
          onKeyDown={(e) => e.key === "Enter" && done(val)}
        />
      ) : null}
    </Modal>
  );
}

export function DialogHost() {
  const queue = useDialogStore((s) => s.queue);
  const d = queue[0];
  return d ? <DialogView key={d.id} d={d} /> : null;
}

/* ---------- Toasts ---------- */
type ToastKind = "info" | "success" | "error" | "warning";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: React.ReactNode;
}
const useToastStore = create<{ items: ToastItem[]; add: (t: ToastItem) => void; remove: (id: number) => void }>((set) => ({
  items: [],
  add: (t) => set((s) => ({ items: [...s.items.slice(-3), t] })),
  remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));
let toastSeq = 0;
function pushToast(kind: ToastKind, message: React.ReactNode, ms = 2600) {
  const id = ++toastSeq;
  useToastStore.getState().add({ id, kind, message });
  window.setTimeout(() => useToastStore.getState().remove(id), ms);
}
export const toast = {
  info: (m: React.ReactNode) => pushToast("info", m),
  success: (m: React.ReactNode) => pushToast("success", m),
  warning: (m: React.ReactNode) => pushToast("warning", m, 3600),
  error: (m: React.ReactNode) => pushToast("error", m, 4200),
};

const toastIcon: Record<ToastKind, React.ReactNode> = {
  info: <Info size={14} color="var(--accent)" />,
  success: <CheckCircle2 size={14} color="var(--green)" />,
  warning: <AlertTriangle size={14} color="var(--orange)" />,
  error: <XCircle size={14} color="var(--red)" />,
};

export function ToastHost() {
  const items = useToastStore((s) => s.items);
  if (!items.length) return null;
  return createPortal(
    <div className="ui-toasts">
      {items.map((t) => (
        <div key={t.id} className="ui-toast">
          {toastIcon[t.kind]}
          <span>{t.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
