"use client";

import { ChevronDown, LoaderCircle, Save, Sparkles } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import {
  ApiError,
  apiRequest,
  errorMessage,
  isSignedOutError,
  jsonRequest,
} from "../lib/client/api";
import { cleanText } from "../lib/client/format";
import { toOutfit } from "../lib/client/wardrobe-state";
import {
  DEFAULT_OCCASION,
  NAME_MAX,
  OCCASIONS,
  OUTFIT_ITEMS_MAX,
  type Outfit,
  type WardrobeItem,
} from "../lib/wardrobe-options";
import { DialogHeader } from "./Dialog";
import { Field, fieldMessageId } from "./Field";
import { PiecePicker, toggledSelection } from "./PiecePicker";

type OutfitFormProps = {
  /** Present when editing. */
  outfit?: Outfit;
  items: WardrobeItem[];
  titleId: string;
  readOnlyMessage: string | null;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onClose: () => void;
  onSaved: (outfit: Outfit) => void;
  onMissing: (id: number) => void;
  onOffline: () => void;
  /** Some chosen pieces were deleted elsewhere: refresh the wardrobe. */
  onStale: () => void;
};

const sameIds = (a: number[], b: number[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Create an outfit or edit its name, occasion and pieces. */
export function OutfitForm({
  outfit,
  items,
  titleId,
  readOnlyMessage,
  onBusyChange,
  onCancel,
  onClose,
  onSaved,
  onMissing,
  onOffline,
  onStale,
}: OutfitFormProps) {
  const id = useId();
  const [name, setName] = useState(outfit?.name ?? "");
  const [occasion, setOccasion] = useState(outfit?.occasion || DEFAULT_OCCASION);
  const [selected, setSelected] = useState<number[]>(() => {
    const existing = new Set(items.map((item) => item.id));
    return (outfit?.itemIds ?? []).filter((itemId) => existing.has(itemId));
  });
  const [errors, setErrors] = useState<{ name?: string; pieces?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setFormError(null);
    if (readOnlyMessage) {
      setFormError(readOnlyMessage);
      return;
    }

    const cleanName = cleanText(name);
    const found: typeof errors = {};
    if (!cleanName) found.name = "Please give the outfit a name.";
    // An outfit whose pieces were all deleted can still be renamed.
    const piecesChanged = !outfit || !sameIds(selected, outfit.itemIds);
    if (!selected.length && piecesChanged) {
      found.pieces = "Choose at least one piece for this outfit.";
    }
    if (selected.length > OUTFIT_ITEMS_MAX) {
      found.pieces = `An outfit can have at most ${OUTFIT_ITEMS_MAX} pieces.`;
    }
    setErrors(found);
    if (found.name) {
      document.getElementById(`${id}-name`)?.focus();
      return;
    }
    if (found.pieces) {
      document.getElementById(`${id}-pieces-error`)?.scrollIntoView({ block: "center" });
      return;
    }

    const changes: Record<string, unknown> = {};
    if (!outfit || cleanName !== outfit.name) changes.name = cleanName;
    if (!outfit || occasion !== outfit.occasion) changes.occasion = occasion;
    if (piecesChanged) changes.itemIds = selected;
    if (outfit && !Object.keys(changes).length) {
      onCancel();
      return;
    }

    setSaving(true);
    onBusyChange(true);
    try {
      const response = await apiRequest<{ outfit?: unknown }>(
        outfit ? `/api/outfits/${outfit.id}` : "/api/outfits",
        jsonRequest(outfit ? "PATCH" : "POST", changes),
      );
      const saved = toOutfit(response.outfit);
      if (!saved) throw new ApiError("server", 200, "Trove sent a reply it couldn't read. Please refresh.");
      onBusyChange(false);
      onSaved(saved);
    } catch (error) {
      if (isSignedOutError(error)) return;
      setSaving(false);
      onBusyChange(false);
      if (outfit && error instanceof ApiError && error.status === 404) {
        onMissing(outfit.id);
        return;
      }
      if (error instanceof ApiError && error.kind === "offline") onOffline();
      if (error instanceof ApiError && /no longer exist/i.test(error.message)) onStale();
      setFormError(errorMessage(error, "This outfit couldn't be saved. Please try again."));
    }
  }

  const editing = Boolean(outfit);

  return (
    <>
      <DialogHeader
        titleId={titleId}
        kicker={editing ? "Edit outfit" : "New outfit"}
        title={editing ? (outfit?.name ?? "Edit outfit") : "Create an outfit"}
        onClose={onClose}
        closeDisabled={saving}
      />
      <form className="entry-form" onSubmit={submit} noValidate>
        <p className="form-legend">
          <span aria-hidden="true">*</span> Required
        </p>
        {readOnlyMessage && <p className="form-note">{readOnlyMessage}</p>}

        <div className="field-row">
          <Field id={`${id}-name`} label="Outfit name" required error={errors.name}>
            <input
              id={`${id}-name`}
              className="input"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
              }}
              placeholder="e.g. Friday dinner"
              maxLength={NAME_MAX}
              autoComplete="off"
              required
              aria-invalid={Boolean(errors.name) || undefined}
              aria-describedby={fieldMessageId(`${id}-name`, errors.name)}
            />
          </Field>
          <Field id={`${id}-occasion`} label="Occasion">
            <span className="select-wrap">
              <select
                id={`${id}-occasion`}
                className="input"
                value={occasion}
                onChange={(event) => setOccasion(event.target.value)}
              >
                {OCCASIONS.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              <ChevronDown size={18} aria-hidden="true" />
            </span>
          </Field>
        </div>

        <PiecePicker
          items={items}
          selected={selected}
          onToggle={(itemId) => {
            setSelected((current) => toggledSelection(current, itemId));
            setErrors((current) => (current.pieces ? { ...current, pieces: undefined } : current));
          }}
          onClear={() => setSelected([])}
          error={errors.pieces}
          errorId={`${id}-pieces-error`}
        />

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <div className="form-actions form-actions-sticky">
          {editing && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                if (!saving) onCancel();
              }}
              aria-disabled={saving || undefined}
            >
              Cancel
            </button>
          )}
          <button type="submit" className="button button-primary" aria-disabled={saving || undefined}>
            {saving ? (
              <LoaderCircle className="spin" size={20} aria-hidden="true" />
            ) : editing ? (
              <Save size={20} aria-hidden="true" />
            ) : (
              <Sparkles size={20} aria-hidden="true" />
            )}
            {saving ? "Saving…" : editing ? "Save changes" : "Save outfit"}
          </button>
        </div>
      </form>
    </>
  );
}
