import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { dismiss, getNotices, subscribeNotices, type Notice } from "@/lib/notices";

import { Button } from "./button";

/** How long a notice stays; a refusal stays until it is closed. */
const SECONDS = 6;

const icons = {
  success: <CircleCheck className="text-success" />,
  danger: <CircleX className="text-danger" />,
  neutral: <Info className="text-muted-foreground" />,
};

/** The notices of src/lib/notices.ts, at the bottom of the screen; screen readers read them out. */
export function Notices() {
  const notices = useSyncExternalStore(subscribeNotices, getNotices);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2">
      {notices.map((n) => (
        <NoticeCard key={n.id} notice={n} />
      ))}
    </div>
  );
}

function NoticeCard({ notice }: { notice: Notice }) {
  useEffect(() => {
    if (notice.tone === "danger") return;
    const timer = setTimeout(() => dismiss(notice.id), SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <div
      role={notice.tone === "danger" ? "alert" : "status"}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border border-border bg-background py-2.5 pr-2 pl-3 text-sm shadow-lg [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0"
    >
      {icons[notice.tone]}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{notice.title}</div>
        {notice.description ? <div className="mt-0.5 break-words text-muted-foreground">{notice.description}</div> : null}
      </div>
      {notice.action ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            notice.action!.run();
            dismiss(notice.id);
          }}
        >
          {notice.action.label}
        </Button>
      ) : null}
      <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => dismiss(notice.id)}>
        <X />
      </Button>
    </div>
  );
}
