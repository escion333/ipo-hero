import { useState } from "react";

import type { NewThreadInput } from "../../lib/community/types";
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
  /** Loaded filing sections — the section choices (plus "General"). */
  sections?: { id: string; title: string }[];
  /** Pre-scope to a section (e.g. opened from a section in the reader). */
  defaultSectionId?: string | null;
  onSubmit?: (input: NewThreadInput) => void;
  onCancel?: () => void;
  className?: string;
};

/**
 * Create-thread form. `sectionId` is validated against the passed `sections` —
 * the UI can only ever submit a valid id or null (general), matching the plan's
 * client-side section validation requirement.
 */
export function NewThreadForm({
  sections = [],
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
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Anchoring to a section keeps debate close to the filing text.
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
