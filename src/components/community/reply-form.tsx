import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export type ReplyFormProps = {
  /** Receives the trimmed, non-empty body. Clears the field on success. */
  onSubmit?: (body: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  /** Tighter spacing for inline (nested-reply) use. */
  compact?: boolean;
  submitLabel?: string;
  className?: string;
};

export function ReplyForm({
  onSubmit,
  onCancel,
  placeholder = "Add a reply…",
  compact = false,
  submitLabel = "Reply",
  className,
}: ReplyFormProps) {
  const [body, setBody] = useState("");
  const trimmed = body.trim();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    onSubmit?.(trimmed);
    setBody("");
  };

  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-2", className)}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={compact ? 2 : 3}
        className={cn(
          "w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-panel outline-none transition-colors",
          "placeholder:text-muted-foreground",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size={compact ? "sm" : "default"} disabled={!trimmed}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" size={compact ? "sm" : "default"} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
