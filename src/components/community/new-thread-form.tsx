import { useState } from "react";

import type { NewThreadInput } from "../../lib/community/types";
import { THEMES } from "../../lib/community/themes";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

const GENERAL = "__general__";

export type NewThreadFormProps = {
  /** Pre-scope to a theme (e.g. opened from a "Discuss this section" link). */
  defaultSectionId?: string | null;
  onSubmit?: (input: NewThreadInput) => void;
  onCancel?: () => void;
  className?: string;
};

/**
 * Create-thread form. `sectionId` is one of the fixed discussion themes or null
 * (general), so the UI can only ever submit a valid scope.
 */
export function NewThreadForm({
  defaultSectionId = null,
  onSubmit,
  onCancel,
  className,
}: NewThreadFormProps) {
  const [sectionId, setSectionId] = useState<string>(defaultSectionId ?? GENERAL);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const valid = trimmedTitle.length > 0 && trimmedBody.length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSubmit?.({
      sectionId: sectionId === GENERAL ? null : sectionId,
      title: trimmedTitle,
      body: trimmedBody,
    });
    setTitle("");
    setBody("");
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-panel",
        className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-thread-section">Discussion topic</Label>
        <Select value={sectionId} onValueChange={setSectionId}>
          <SelectTrigger id="new-thread-section" className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GENERAL}>General discussion</SelectItem>
            {THEMES.map((t) => (
              <SelectItem key={t.key} value={t.key}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Picking a topic keeps debate easy to find for others reading the same area.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-thread-title">Title</Label>
        <Input
          id="new-thread-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What do you want to discuss?"
          maxLength={200}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-thread-body">Body</Label>
        <textarea
          id="new-thread-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Share your read of the filing. Opinions welcome — they're yours, not IPO Hero's."
          className={cn(
            "w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-panel outline-none transition-colors",
            "placeholder:text-muted-foreground",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          )}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!valid}>
          Post thread
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
