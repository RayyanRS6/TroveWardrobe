"use client";

import {
  Camera,
  Check,
  ChevronDown,
  Cloud,
  ImagePlus,
  LayoutGrid,
  LoaderCircle,
  PackageOpen,
  Palette,
  Plus,
  Search,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type WardrobeItem = {
  id: number;
  name: string;
  category: string;
  color: string;
  season: string;
  imageUrl: string;
  createdAt: string;
};

type Outfit = {
  id: number;
  name: string;
  occasion: string;
  itemIds: number[];
  createdAt: string;
};

type CachedWardrobe = {
  items: WardrobeItem[];
  outfits: Outfit[];
};

type DeleteTarget = {
  kind: "item" | "outfit";
  id: number;
  name: string;
};

const categories = [
  "All",
  "Shirts",
  "T-shirts",
  "Pants",
  "Trousers",
  "Jeans",
  "Coats",
  "Jackets",
  "Pant coat",
  "Shalwar kameez",
  "Kurtas",
  "Sweaters",
  "Shoes",
  "Accessories",
];

const seasons = ["All season", "Summer", "Winter", "Spring", "Autumn"];
const occasions = ["Everyday", "Work", "Formal", "Casual", "Festive", "Travel"];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function openCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("trove-cache", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("wardrobe");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeCache(data: CachedWardrobe) {
  try {
    const db = await openCache();
    db.transaction("wardrobe", "readwrite")
      .objectStore("wardrobe")
      .put(data, "latest");
  } catch {
    // Offline cache is a convenience; cloud data remains authoritative.
  }
}

async function readCache(): Promise<CachedWardrobe | null> {
  try {
    const db = await openCache();
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction("wardrobe", "readonly")
        .objectStore("wardrobe")
        .get("latest");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function optimizedImage(file: File) {
  if (file.size < 900_000) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 1600;
    const ratio = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.82),
    );
    return blob
      ? new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, {
          type: "image/webp",
        })
      : file;
  } catch {
    return file;
  }
}

function plural(value: number, singular: string, multiple = `${singular}s`) {
  return `${value} ${value === 1 ? singular : multiple}`;
}

export default function WardrobeApp() {
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [activeView, setActiveView] = useState<
    "wardrobe" | "outfits" | "tags"
  >("wardrobe");
  const [activeCategory, setActiveCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [modal, setModal] = useState<"item" | "outfit" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [itemsResponse, outfitsResponse] = await Promise.all([
        fetch("/api/items", { cache: "no-store" }),
        fetch("/api/outfits", { cache: "no-store" }),
      ]);
      if (!itemsResponse.ok || !outfitsResponse.ok) {
        throw new Error("Could not reach your wardrobe.");
      }
      const itemsData = (await itemsResponse.json()) as {
        items: WardrobeItem[];
      };
      const outfitsData = (await outfitsResponse.json()) as {
        outfits: Outfit[];
      };
      setItems(itemsData.items);
      setOutfits(outfitsData.outfits);
      setOffline(false);
      await writeCache({
        items: itemsData.items,
        outfits: outfitsData.outfits,
      });
    } catch {
      const cached = await readCache();
      if (cached) {
        setItems(cached.items);
        setOutfits(cached.outfits);
        setOffline(true);
      } else {
        setError("Your wardrobe could not be loaded. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => void refresh(), 0);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => window.clearTimeout(refreshTimer);
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesCategory =
        activeCategory === "All" || item.category === activeCategory;
      const matchesSearch =
        !needle ||
        [item.name, item.category, item.color, item.season]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, items, search]);

  const categoryCounts = useMemo(() => {
    return categories.slice(1).map((category) => ({
      category,
      count: items.filter((item) => item.category === category).length,
    }));
  }, [items]);

  function openAdd() {
    setError(null);
    setSelectedItems([]);
    setModal(activeView === "outfits" ? "outfit" : "item");
  }

  function closeModal(force = false) {
    if (submitting && !force) return;
    setModal(null);
    setSelectedItems([]);
    setImageFile(null);
    setImagePreview(null);
    setError(null);
  }

  async function selectImage(file?: File) {
    if (!file) return;
    const prepared = await optimizedImage(file);
    setImageFile(prepared);
    setImagePreview(URL.createObjectURL(prepared));
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!imageFile) {
      setError("Add a photo so you can recognize this piece later.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      form.set("image", imageFile);
      const response = await fetch("/api/items", { method: "POST", body: form });
      const data = (await response.json()) as {
        item?: WardrobeItem;
        error?: string;
      };
      if (!response.ok || !data.item) {
        throw new Error(data.error || "Could not add this piece.");
      }
      const nextItems = [data.item, ...items];
      setItems(nextItems);
      await writeCache({ items: nextItems, outfits });
      closeModal(true);
      notify(`${data.item.name} added to your wardrobe`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not add this piece.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function addOutfit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedItems.length === 0) {
      setError("Choose at least one piece for this outfit.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/outfits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          occasion: form.get("occasion"),
          itemIds: selectedItems,
        }),
      });
      const data = (await response.json()) as {
        outfit?: Outfit;
        error?: string;
      };
      if (!response.ok || !data.outfit) {
        throw new Error(data.error || "Could not save this outfit.");
      }
      const nextOutfits = [data.outfit, ...outfits];
      setOutfits(nextOutfits);
      await writeCache({ items, outfits: nextOutfits });
      closeModal(true);
      setActiveView("outfits");
      notify(`${data.outfit.name} is ready`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save this outfit.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function removeTarget() {
    if (!deleteTarget) return;
    setSubmitting(true);
    const target = deleteTarget;
    try {
      const endpoint =
        target.kind === "item"
          ? `/api/items/${target.id}`
          : `/api/outfits/${target.id}`;
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete this item.");

      const nextItems =
        target.kind === "item"
          ? items.filter((item) => item.id !== target.id)
          : items;
      const nextOutfits =
        target.kind === "outfit"
          ? outfits.filter((outfit) => outfit.id !== target.id)
          : outfits;
      setItems(nextItems);
      setOutfits(nextOutfits);
      await writeCache({ items: nextItems, outfits: nextOutfits });
      setDeleteTarget(null);
      notify(`${target.name} deleted`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not delete this.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function toggleOutfitItem(id: number) {
    setSelectedItems((current) =>
      current.includes(id)
        ? current.filter((itemId) => itemId !== id)
        : [...current, id],
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Trove home">
          trove<span>.</span>
        </a>
        <div className={`sync-status ${offline ? "offline" : ""}`}>
          {offline ? <WifiOff size={14} /> : <Cloud size={14} />}
          <span>{offline ? "Offline copy" : "Cloud synced"}</span>
        </div>
      </header>

      <section className="intro">
        <div>
          <p className="eyebrow">{greeting()}</p>
          <h1>
            Your wardrobe,
            <br />
            remembered.
          </h1>
        </div>
        <div className="wardrobe-count">
          <strong>{items.length}</strong>
          <span>pieces</span>
        </div>
      </section>

      <div className="content-panel">
        {activeView === "wardrobe" && (
          <>
            <div className="section-heading">
              <div>
                <p className="section-kicker">Your collection</p>
                <h2>Wardrobe</h2>
              </div>
              <button className="filter-button" aria-label="Filter wardrobe">
                <SlidersHorizontal size={18} />
              </button>
            </div>

            <label className="search-box">
              <Search size={19} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search shirts, colors, seasons..."
                aria-label="Search wardrobe"
              />
              {search && (
                <button onClick={() => setSearch("")} aria-label="Clear search">
                  <X size={16} />
                </button>
              )}
            </label>

            <div className="category-scroll" aria-label="Clothing categories">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={activeCategory === category ? "active" : ""}
                >
                  {category}
                </button>
              ))}
            </div>

            {loading ? (
              <LoadingGrid />
            ) : filteredItems.length ? (
              <div className="wardrobe-grid">
                {filteredItems.map((item) => (
                  <article className="clothing-card" key={item.id}>
                    <div className="card-image">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.imageUrl} alt={item.name} />
                      <button
                        className="delete-icon"
                        onClick={() =>
                          setDeleteTarget({
                            kind: "item",
                            id: item.id,
                            name: item.name,
                          })
                        }
                        aria-label={`Delete ${item.name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="card-copy">
                      <span>{item.category}</span>
                      <h3>{item.name}</h3>
                      <p>
                        {[item.color, item.season].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyWardrobe
                filtered={Boolean(search || activeCategory !== "All")}
                onAdd={() => setModal("item")}
                onReset={() => {
                  setSearch("");
                  setActiveCategory("All");
                }}
              />
            )}
          </>
        )}

        {activeView === "outfits" && (
          <>
            <div className="section-heading">
              <div>
                <p className="section-kicker">Looks you love</p>
                <h2>Outfits</h2>
              </div>
              <span className="quiet-count">
                {plural(outfits.length, "look")}
              </span>
            </div>
            {loading ? (
              <LoadingGrid />
            ) : outfits.length ? (
              <div className="outfit-grid">
                {outfits.map((outfit) => {
                  const outfitItems = outfit.itemIds
                    .map((id) => items.find((item) => item.id === id))
                    .filter(Boolean) as WardrobeItem[];
                  return (
                    <article className="outfit-card" key={outfit.id}>
                      <div
                        className={`outfit-collage count-${Math.min(
                          3,
                          outfitItems.length,
                        )}`}
                      >
                        {outfitItems.slice(0, 3).map((item) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={item.id} src={item.imageUrl} alt="" />
                        ))}
                        {!outfitItems.length && <Shirt size={42} />}
                      </div>
                      <div className="outfit-copy">
                        <div>
                          <span>{outfit.occasion}</span>
                          <h3>{outfit.name}</h3>
                          <p>{plural(outfitItems.length, "piece")}</p>
                        </div>
                        <button
                          onClick={() =>
                            setDeleteTarget({
                              kind: "outfit",
                              id: outfit.id,
                              name: outfit.name,
                            })
                          }
                          aria-label={`Delete ${outfit.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyOutfits
                hasItems={items.length > 0}
                onAdd={() => setModal(items.length ? "outfit" : "item")}
              />
            )}
          </>
        )}

        {activeView === "tags" && (
          <>
            <div className="section-heading">
              <div>
                <p className="section-kicker">Browse by type</p>
                <h2>Categories</h2>
              </div>
              <span className="quiet-count">{categories.length - 1} tags</span>
            </div>
            <div className="tag-list">
              {categoryCounts.map(({ category, count }, index) => (
                <button
                  key={category}
                  onClick={() => {
                    setActiveCategory(category);
                    setActiveView("wardrobe");
                  }}
                >
                  <span className={`tag-swatch swatch-${(index % 5) + 1}`}>
                    <Shirt size={20} />
                  </span>
                  <span className="tag-name">{category}</span>
                  <span className="tag-count">{count}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <nav className="bottom-nav" aria-label="Main navigation">
        <button
          className={activeView === "wardrobe" ? "active" : ""}
          onClick={() => setActiveView("wardrobe")}
        >
          <LayoutGrid size={21} />
          <span>Wardrobe</span>
        </button>
        <button
          className={activeView === "outfits" ? "active" : ""}
          onClick={() => setActiveView("outfits")}
        >
          <Sparkles size={21} />
          <span>Outfits</span>
        </button>
        <button className="add-nav" onClick={openAdd} aria-label="Add new">
          <Plus size={27} />
        </button>
        <button
          className={activeView === "tags" ? "active" : ""}
          onClick={() => setActiveView("tags")}
        >
          <Tags size={21} />
          <span>Categories</span>
        </button>
        <button onClick={() => setModal("item")}>
          <Camera size={21} />
          <span>Quick add</span>
        </button>
      </nav>

      {modal === "item" && (
        <Modal title="Add a new piece" onClose={() => closeModal()}>
          <form className="entry-form" onSubmit={addItem}>
            <button
              className={`image-drop ${imagePreview ? "has-image" : ""}`}
              type="button"
              onClick={() => imageInput.current?.click()}
            >
              {imagePreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imagePreview} alt="Selected clothing preview" />
              ) : (
                <>
                  <span className="upload-icon">
                    <ImagePlus size={26} />
                  </span>
                  <strong>Add a clear photo</strong>
                  <small>Tap to choose from your camera or gallery</small>
                </>
              )}
              {imagePreview && (
                <span className="change-photo">Change photo</span>
              )}
            </button>
            <input
              ref={imageInput}
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => selectImage(event.target.files?.[0])}
            />

            <label className="field">
              <span>Piece name</span>
              <input
                name="name"
                placeholder="e.g. Olive linen shirt"
                required
                maxLength={60}
              />
            </label>

            <div className="field-row">
              <label className="field select-field">
                <span>Category</span>
                <select name="category" defaultValue="" required>
                  <option value="" disabled>
                    Choose one
                  </option>
                  {categories.slice(1).map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
                <ChevronDown size={17} />
              </label>
              <label className="field">
                <span>Color</span>
                <span className="input-with-icon">
                  <Palette size={17} />
                  <input name="color" placeholder="Olive" maxLength={30} />
                </span>
              </label>
            </div>

            <label className="field select-field">
              <span>Season</span>
              <select name="season" defaultValue="All season">
                {seasons.map((season) => (
                  <option key={season}>{season}</option>
                ))}
              </select>
              <ChevronDown size={17} />
            </label>

            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" disabled={submitting}>
              {submitting ? (
                <LoaderCircle className="spin" size={20} />
              ) : (
                <Plus size={20} />
              )}
              {submitting ? "Adding piece..." : "Add to wardrobe"}
            </button>
          </form>
        </Modal>
      )}

      {modal === "outfit" && (
        <Modal title="Create an outfit" onClose={() => closeModal()}>
          <form className="entry-form" onSubmit={addOutfit}>
            <label className="field">
              <span>Outfit name</span>
              <input
                name="name"
                placeholder="e.g. Friday dinner"
                required
                maxLength={60}
              />
            </label>
            <label className="field select-field">
              <span>Occasion</span>
              <select name="occasion" defaultValue="Everyday">
                {occasions.map((occasion) => (
                  <option key={occasion}>{occasion}</option>
                ))}
              </select>
              <ChevronDown size={17} />
            </label>

            <div className="picker-heading">
              <div>
                <strong>Choose pieces</strong>
                <span>{plural(selectedItems.length, "selected")}</span>
              </div>
              {selectedItems.length > 0 && (
                <button type="button" onClick={() => setSelectedItems([])}>
                  Clear
                </button>
              )}
            </div>
            <div className="outfit-picker">
              {items.map((item) => {
                const selected = selectedItems.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={selected ? "selected" : ""}
                    onClick={() => toggleOutfitItem(item.id)}
                    aria-pressed={selected}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.imageUrl} alt={item.name} />
                    <span>{item.name}</span>
                    {selected && (
                      <i>
                        <Check size={14} />
                      </i>
                    )}
                  </button>
                );
              })}
            </div>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" disabled={submitting}>
              {submitting ? (
                <LoaderCircle className="spin" size={20} />
              ) : (
                <Sparkles size={20} />
              )}
              {submitting ? "Saving outfit..." : "Save outfit"}
            </button>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <div className="modal-backdrop confirm-backdrop" role="presentation">
          <div className="confirm-dialog" role="alertdialog" aria-modal="true">
            <span className="danger-icon">
              <Trash2 size={22} />
            </span>
            <h2>Delete “{deleteTarget.name}”?</h2>
            <p>This will remove it from your wardrobe permanently.</p>
            {error && <p className="form-error">{error}</p>}
            <div className="confirm-actions">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={submitting}
              >
                Keep it
              </button>
              <button
                className="danger-button"
                onClick={removeTarget}
                disabled={submitting}
              >
                {submitting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">
          <Check size={16} />
          {toast}
        </div>
      )}
    </main>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-handle" />
        <header>
          <div>
            <p className="section-kicker">Trove</p>
            <h2>{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="wardrobe-grid loading-grid" aria-label="Loading wardrobe">
      {[0, 1, 2, 3].map((item) => (
        <div className="loading-card" key={item}>
          <span />
          <i />
          <b />
        </div>
      ))}
    </div>
  );
}

function EmptyWardrobe({
  filtered,
  onAdd,
  onReset,
}: {
  filtered: boolean;
  onAdd: () => void;
  onReset: () => void;
}) {
  return (
    <section className="empty-state">
      <div className="empty-art">
        <span className="art-card art-card-left" />
        <span className="art-card art-card-right" />
        <span className="art-icon">
          <Shirt size={44} strokeWidth={1.5} />
        </span>
      </div>
      <p className="section-kicker">
        {filtered ? "Nothing here" : "A fresh start"}
      </p>
      <h2>
        {filtered ? "No pieces match that." : "Meet your digital wardrobe."}
      </h2>
      <p>
        {filtered
          ? "Try another search or see your full collection."
          : "Photograph your first piece and never forget what you own again."}
      </p>
      <button
        className="secondary-button"
        onClick={filtered ? onReset : onAdd}
      >
        {filtered ? <X size={18} /> : <Plus size={18} />}
        {filtered ? "Clear filters" : "Add your first piece"}
      </button>
    </section>
  );
}

function EmptyOutfits({
  hasItems,
  onAdd,
}: {
  hasItems: boolean;
  onAdd: () => void;
}) {
  return (
    <section className="empty-state">
      <div className="empty-art outfit-art">
        <span className="art-card art-card-left" />
        <span className="art-card art-card-right" />
        <span className="art-icon">
          <Sparkles size={42} strokeWidth={1.5} />
        </span>
      </div>
      <p className="section-kicker">Your lookbook</p>
      <h2>{hasItems ? "Turn pieces into outfits." : "Your looks begin here."}</h2>
      <p>
        {hasItems
          ? "Combine what you own into ready-to-wear looks."
          : "Add a few clothes first, then combine them into outfits."}
      </p>
      <button className="secondary-button" onClick={onAdd}>
        {hasItems ? <Sparkles size={18} /> : <PackageOpen size={18} />}
        {hasItems ? "Create an outfit" : "Add clothing"}
      </button>
    </section>
  );
}
