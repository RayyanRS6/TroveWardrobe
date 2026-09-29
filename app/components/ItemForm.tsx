"use client";

import { ChevronDown, LoaderCircle, Palette, Plus, Save } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, apiRequest, errorMessage, isSignedOutError } from "../lib/client/api";
import { cleanText } from "../lib/client/format";
import { PhotoError, preparePhoto } from "../lib/client/photo";
import { toItem } from "../lib/client/wardrobe-state";
import {
  CATEGORY_MAX,
  COLOR_MAX,
  DEFAULT_SEASON,
  NAME_MAX,
  RESERVED_CATEGORY,
  SEASONS,
  type WardrobeItem,
} from "../lib/wardrobe-options";
import { DialogHeader } from "./Dialog";
import { Field, fieldMessageId } from "./Field";
import { PhotoField, type PhotoChoice } from "./PhotoField";

type FieldName = "photo" | "name" | "category" | "color";
type FieldErrors = Partial<Record<FieldName, string>>;

type ItemFormProps = {
  /** Present when editing; the form starts from its values. */
  item?: WardrobeItem;
  categorySuggestions: string[];
  titleId: string;
  readOnlyMessage: string | null;
  onBusyChange: (busy: boolean) => void;
  /** Editing: back to the piece's details. Adding: close. */
  onCancel: () => void;
  onClose: () => void;
  onSaved: (item: WardrobeItem, photoChanged: boolean) => void;
  /** The piece was deleted elsewhere (404 while editing). */
  onMissing: (id: number) => void;
  onOffline: () => void;
};

/** Add a piece (photo required) or edit one (photo optional). */
export function ItemForm({
  item,
  categorySuggestions,
  titleId,
  readOnlyMessage,
  onBusyChange,
  onCancel,
  onClose,
  onSaved,
  onMissing,
  onOffline,
}: ItemFormProps) {
  const editing = Boolean(item);
  const id = useId();
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [color, setColor] = useState(item?.color ?? "");
  const [season, setSeason] = useState(item?.season || DEFAULT_SEASON);
  const [photo, setPhoto] = useState<PhotoChoice>({ status: "none" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const latestPick = useRef(0);

  // Each preview URL is released once it is replaced or the form closes.
  const previewUrl = photo.status === "ready" ? photo.previewUrl : null;
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // A photo still being prepared when the form closes is dropped, so no
  // preview URL is made that nothing would release.
  useEffect(() => {
    const picks = latestPick;
    return () => {
      picks.current += 1;
    };
  }, []);

  async function pickPhoto(file: File) {
    const pick = ++latestPick.current;
    setPhoto({ status: "preparing", name: file.name });
    setErrors((current) => ({ ...current, photo: undefined }));
    try {
      const prepared = await preparePhoto(file);
      if (pick !== latestPick.current) return;
      setPhoto({
        status: "ready",
        file: prepared.file,
        previewUrl: prepared.previewable ? URL.createObjectURL(prepared.file) : null,
        name: file.name,
      });
    } catch (error) {
      if (pick !== latestPick.current) return;
      setPhoto({
        status: "error",
        message:
          error instanceof PhotoError
            ? error.message
            : "That photo couldn't be read. Please try another one.",
      });
    }
  }

  function validate() {
    const found: FieldErrors = {};
    if (!cleanText(name)) found.name = "Please give the piece a name.";
    const cleanCategory = cleanText(category);
    if (!cleanCategory) {
      found.category = "Please choose or type a category.";
    } else if (cleanCategory.toLowerCase() === RESERVED_CATEGORY.toLowerCase()) {
      found.category = `“${RESERVED_CATEGORY}” is reserved. Please choose another category name.`;
    }
    if (!editing && photo.status !== "ready") {
      found.photo =
        photo.status === "error" ? photo.message : "Add a photo so you can recognise this piece later.";
    }
    return found;
  }

  // A field's error goes away as soon as it is edited.
  function edit(field: FieldName, set: (value: string) => void) {
    return (value: string) => {
      set(value);
      if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    };
  }

  function focusField(field: FieldName) {
    document.getElementById(`${id}-${field}`)?.focus();
  }

  function changedFields() {
    const body = new FormData();
    const values = {
      name: cleanText(name),
      category: cleanText(category),
      color: cleanText(color),
      season,
    };
    for (const [key, value] of Object.entries(values)) {
      if (!item || value !== item[key as keyof typeof values]) body.set(key, value);
    }
    if (photo.status === "ready") body.set("image", photo.file);
    return body;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setFormError(null);
    if (readOnlyMessage) {
      setFormError(readOnlyMessage);
      return;
    }
    if (photo.status === "preparing") {
      setFormError("Your photo is still being prepared. One moment…");
      return;
    }

    const found = validate();
    setErrors(found);
    const firstInvalid = (["photo", "name", "category", "color"] as const).find(
      (field) => found[field],
    );
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }

    const body = changedFields();
    if (item && [...body.keys()].length === 0) {
      onCancel();
      return;
    }

    setSaving(true);
    onBusyChange(true);
    try {
      const response = await apiRequest<{ item?: unknown }>(
        item ? `/api/items/${item.id}` : "/api/items",
        { method: item ? "PATCH" : "POST", body },
      );
      const saved = toItem(response.item);
      if (!saved) throw new ApiError("server", 200, "Trove sent a reply it couldn't read. Please refresh.");
      onBusyChange(false);
      onSaved(saved, photo.status === "ready");
    } catch (error) {
      if (isSignedOutError(error)) return;
      setSaving(false);
      onBusyChange(false);
      if (item && error instanceof ApiError && error.status === 404) {
        onMissing(item.id);
        return;
      }
      if (error instanceof ApiError && error.kind === "offline") onOffline();
      setFormError(errorMessage(error, "This piece couldn't be saved. Please try again."));
    }
  }

  const listId = `${id}-categories`;
  const submitLabel = saving
    ? editing
      ? "Saving…"
      : "Adding piece…"
    : photo.status === "preparing"
      ? "Preparing photo…"
      : editing
        ? "Save changes"
        : "Add to wardrobe";

  return (
    <>
      <DialogHeader
        titleId={titleId}
        kicker={editing ? "Edit piece" : "New piece"}
        title={editing ? (item?.name ?? "Edit piece") : "Add a new piece"}
        onClose={onClose}
        closeDisabled={saving}
      />
      <form className="entry-form" onSubmit={submit} noValidate>
        <p className="form-legend">
          <span aria-hidden="true">*</span> Required
        </p>
        {readOnlyMessage && <p className="form-note">{readOnlyMessage}</p>}

        <PhotoField
          id={`${id}-photo`}
          choice={errors.photo && photo.status !== "error" ? { status: "error", message: errors.photo } : photo}
          currentUrl={item?.imageUrl}
          required={!editing}
          invalid={Boolean(errors.photo) || photo.status === "error"}
          disabled={saving}
          onPick={pickPhoto}
          onReset={() => {
            latestPick.current += 1;
            setPhoto({ status: "none" });
          }}
        />

        <Field id={`${id}-name`} label="Name" required error={errors.name}>
          <input
            id={`${id}-name`}
            className="input"
            name="name"
            value={name}
            onChange={(event) => edit("name", setName)(event.target.value)}
            placeholder="e.g. Olive linen shirt"
            maxLength={NAME_MAX}
            autoComplete="off"
            enterKeyHint="next"
            required
            aria-invalid={Boolean(errors.name) || undefined}
            aria-describedby={fieldMessageId(`${id}-name`, errors.name)}
          />
        </Field>

        <div className="field-row">
          <Field
            id={`${id}-category`}
            label="Category"
            required
            error={errors.category}
            hint="Pick one or type your own."
          >
            <input
              id={`${id}-category`}
              className="input"
              name="category"
              list={listId}
              value={category}
              onChange={(event) => edit("category", setCategory)(event.target.value)}
              placeholder="e.g. Shirts"
              maxLength={CATEGORY_MAX}
              autoComplete="off"
              enterKeyHint="next"
              required
              aria-invalid={Boolean(errors.category) || undefined}
              aria-describedby={fieldMessageId(
                `${id}-category`,
                errors.category,
                "Pick one or type your own.",
              )}
            />
            <datalist id={listId}>
              {categorySuggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </Field>

          <Field id={`${id}-color`} label="Colour" error={errors.color}>
            <span className="input-with-icon">
              <Palette size={18} aria-hidden="true" />
              <input
                id={`${id}-color`}
                className="input"
                name="color"
                value={color}
                onChange={(event) => edit("color", setColor)(event.target.value)}
                placeholder="e.g. Olive"
                maxLength={COLOR_MAX}
                autoComplete="off"
                enterKeyHint="next"
                aria-invalid={Boolean(errors.color) || undefined}
                aria-describedby={fieldMessageId(`${id}-color`, errors.color)}
              />
            </span>
          </Field>
        </div>

        <Field id={`${id}-season`} label="Season">
          <span className="select-wrap">
            <select
              id={`${id}-season`}
              className="input"
              name="season"
              value={season}
              onChange={(event) => setSeason(event.target.value)}
            >
              {SEASONS.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
            <ChevronDown size={18} aria-hidden="true" />
          </span>
        </Field>

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <div className="form-actions">
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
          <button
            type="submit"
            className="button button-primary"
            aria-disabled={saving || photo.status === "preparing" || undefined}
          >
            {saving || photo.status === "preparing" ? (
              <LoaderCircle className="spin" size={20} aria-hidden="true" />
            ) : editing ? (
              <Save size={20} aria-hidden="true" />
            ) : (
              <Plus size={20} aria-hidden="true" />
            )}
            {submitLabel}
          </button>
        </div>
      </form>
    </>
  );
}
