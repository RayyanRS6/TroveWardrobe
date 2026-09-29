"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiError, apiRequest, errorMessage, isSignedOutError } from "../lib/client/api";
import { cleanText } from "../lib/client/format";
import { PhotoError, preparePhoto } from "../lib/client/photo";
import { categoryKey, toItem } from "../lib/client/wardrobe-state";
import {
  CATEGORY_MAX,
  COLOR_MAX,
  NAME_MAX,
  RESERVED_CATEGORY,
  type WardrobeItem,
} from "../lib/wardrobe-options";
import { DialogHeader } from "./Dialog";
import { Field, fieldMessageId } from "./Field";
import { PhotoField, type PhotoChoice } from "./PhotoField";
import { Select } from "./Select";

type FieldName = "photo" | "name" | "category" | "newCategory" | "color";
type FieldErrors = Partial<Record<FieldName, string>>;

// The Category list's last option. Category names never keep control
// characters, so no real category can have this value.
const NEW_CATEGORY = "\u0000new";
const CATEGORY_HINT = "Or choose “New category…” to add one.";
const NEW_CATEGORY_HINT = "It joins your categories when you save.";

type ItemFormProps = {
  /** Present when editing; the form starts from its values. */
  item?: WardrobeItem;
  /** Every category, in list order. */
  categories: string[];
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
  categories,
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
  // The piece's category in the list's spelling; a new wardrobe with no
  // categories at all starts on "New category".
  const [category, setCategory] = useState(() =>
    item
      ? (categories.find((entry) => categoryKey(entry) === categoryKey(item.category)) ?? item.category)
      : categories.length
        ? ""
        : NEW_CATEGORY,
  );
  const [newCategory, setNewCategory] = useState("");
  const [color, setColor] = useState(item?.color ?? "");
  const [photo, setPhoto] = useState<PhotoChoice>({ status: "none" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const latestPick = useRef(0);
  // Set when "New category…" is chosen, so its name field takes focus.
  const focusNewCategory = useRef(false);

  const categoryOptions = useMemo(() => {
    const names = [...categories];
    // A piece whose category was deleted elsewhere keeps it until changed.
    if (item && !names.some((entry) => categoryKey(entry) === categoryKey(item.category))) {
      names.push(item.category);
    }
    return [
      ...names.map((entry) => ({ value: entry, label: entry })),
      { value: NEW_CATEGORY, label: "New category…" },
    ];
  }, [categories, item]);

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

  useEffect(() => {
    if (!focusNewCategory.current || category !== NEW_CATEGORY) return;
    focusNewCategory.current = false;
    document.getElementById(`${id}-newCategory`)?.focus();
  }, [category, id]);

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

  const chosenCategory = category === NEW_CATEGORY ? cleanText(newCategory) : category;

  function validate() {
    const found: FieldErrors = {};
    if (!cleanText(name)) found.name = "Please give the piece a name.";
    if (category === NEW_CATEGORY) {
      if (!chosenCategory) {
        found.newCategory = "Please name the new category.";
      } else if (categoryKey(chosenCategory) === categoryKey(RESERVED_CATEGORY)) {
        found.newCategory = `“${RESERVED_CATEGORY}” is reserved. Please choose another category name.`;
      }
    } else if (!category) {
      found.category = "Please choose a category.";
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

  function changedFields() {
    const body = new FormData();
    const values = { name: cleanText(name), color: cleanText(color) };
    for (const [key, value] of Object.entries(values)) {
      if (!item || value !== item[key as keyof typeof values]) body.set(key, value);
    }
    // The API matches categories case-insensitively: a new spelling alone is no change.
    if (!item || categoryKey(chosenCategory) !== categoryKey(item.category)) {
      body.set("category", chosenCategory);
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
    const firstInvalid = (["photo", "name", "category", "newCategory", "color"] as const).find(
      (field) => found[field],
    );
    if (firstInvalid) {
      document.getElementById(`${id}-${firstInvalid}`)?.focus();
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
          <div className="field-stack">
            <Field
              id={`${id}-category`}
              label="Category"
              required
              select
              error={errors.category}
              hint={category === NEW_CATEGORY ? undefined : CATEGORY_HINT}
            >
              <Select
                id={`${id}-category`}
                labelId={`${id}-category-label`}
                value={category}
                options={categoryOptions}
                placeholder="Choose a category"
                onChange={(value) => {
                  if (value === NEW_CATEGORY) focusNewCategory.current = true;
                  edit("category", setCategory)(value);
                  if (errors.newCategory) setErrors((current) => ({ ...current, newCategory: undefined }));
                }}
                invalid={Boolean(errors.category)}
                describedBy={fieldMessageId(
                  `${id}-category`,
                  errors.category,
                  category === NEW_CATEGORY ? undefined : CATEGORY_HINT,
                )}
              />
            </Field>

            {category === NEW_CATEGORY && (
              <Field
                id={`${id}-newCategory`}
                label="New category name"
                required
                error={errors.newCategory}
                hint={NEW_CATEGORY_HINT}
              >
                <input
                  id={`${id}-newCategory`}
                  className="input"
                  name="newCategory"
                  value={newCategory}
                  onChange={(event) => edit("newCategory", setNewCategory)(event.target.value)}
                  placeholder="e.g. Scarves"
                  maxLength={CATEGORY_MAX}
                  autoComplete="off"
                  enterKeyHint="next"
                  required
                  aria-invalid={Boolean(errors.newCategory) || undefined}
                  aria-describedby={fieldMessageId(
                    `${id}-newCategory`,
                    errors.newCategory,
                    NEW_CATEGORY_HINT,
                  )}
                />
              </Field>
            )}
          </div>

          <Field id={`${id}-color`} label="Colour" error={errors.color}>
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
          </Field>
        </div>

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
            {submitLabel}
          </button>
        </div>
      </form>
    </>
  );
}
