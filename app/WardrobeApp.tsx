"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { AccountPanel, type SyncStatus } from "./components/AccountPanel";
import { ConfirmDelete } from "./components/ConfirmDialog";
import { CategoriesView } from "./components/CategoriesView";
import { Dialog, DialogHeader } from "./components/Dialog";
import { ItemDetail } from "./components/ItemDetail";
import { ItemForm } from "./components/ItemForm";
import { BottomNav, Sidebar, TopBar, type View } from "./components/Navigation";
import { OutfitDetail } from "./components/OutfitDetail";
import { OutfitForm } from "./components/OutfitForm";
import { OutfitsView } from "./components/OutfitsView";
import { StatusPanel } from "./components/StatusPanel";
import { Toaster, type Toast } from "./components/Toaster";
import { WardrobeView, type ListState } from "./components/WardrobeView";
import {
  ApiError,
  apiRequest,
  errorMessage,
  isSignedOutError,
} from "./lib/client/api";
import { plural } from "./lib/client/format";
import { useGreeting } from "./lib/client/hooks";
import {
  pruneCachedImages,
  readSnapshot,
  registerServiceWorker,
  wipeLocalData,
  writeSnapshot,
} from "./lib/client/local-data";
import {
  categoryKey,
  INITIAL_WARDROBE,
  parseSnapshot,
  parseWardrobe,
  photoUrls,
  wardrobeReducer,
} from "./lib/client/wardrobe-state";
import {
  PRESET_CATEGORIES,
  type Outfit,
  type StorageUsage,
  type WardrobeItem,
} from "./lib/wardrobe-options";

type DialogState =
  | { kind: "add-item" }
  | { kind: "item"; id: number }
  | { kind: "edit-item"; id: number }
  | { kind: "add-outfit" }
  | { kind: "outfit"; id: number }
  | { kind: "edit-outfit"; id: number }
  | { kind: "account" };

type DeleteTarget = {
  kind: "item" | "outfit";
  id: number;
  name: string;
  /** Items only: how many outfits include it. */
  usedIn: number;
};

// Re-sync when the tab comes back after this long.
const RESYNC_AFTER_MS = 30_000;
const TOAST_MS = 4000;

const OFFLINE_PAUSED = "You're offline, so changes are paused until you reconnect.";
const UNSYNCED_PAUSED = "Changes are paused until Trove can sync. Try again in a moment.";

export default function WardrobeApp() {
  const [wardrobe, dispatch] = useReducer(wardrobeReducer, INITIAL_WARDROBE);
  const [status, setStatus] = useState<SyncStatus>({ state: "loading" });
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [view, setView] = useState<View>("wardrobe");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [update, setUpdate] = useState<{ apply: () => void } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const toastTimer = useRef<number | undefined>(undefined);
  const inFlightSync = useRef<Promise<void> | null>(null);
  const lastSyncedAt = useRef(0);
  // Bumped by every saved change, so a sync that started earlier is redone.
  const changeCount = useRef(0);
  const sheetTitleId = useId();
  const greeting = useGreeting();

  const { items, outfits, categories } = wardrobe.data;
  const hasData = wardrobe.source !== "none";
  const readOnlyMessage =
    status.state === "offline"
      ? OFFLINE_PAUSED
      : status.state === "error" && wardrobe.source !== "server"
        ? UNSYNCED_PAUSED
        : null;

  const notify = useCallback((message: string, tone: Toast["tone"] = "success") => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  // For a toast that goes with closing a dialog: the page's live region is
  // inert until the dialog is gone, so post it just after.
  const notifyAfterClose = useCallback(
    (message: string, tone: Toast["tone"] = "success") => {
      window.setTimeout(() => notify(message, tone), 120);
    },
    [notify],
  );

  const loadUsage = useCallback(async () => {
    try {
      const body = await apiRequest<Partial<StorageUsage>>("/api/usage");
      if (typeof body.bytesUsed === "number" && typeof body.limitBytes === "number") {
        setUsage({ bytesUsed: body.bytesUsed, limitBytes: body.limitBytes });
      }
    } catch {
      // The meter is optional; it keeps its last value.
    }
  }, []);

  /** Loads everything from the API. Concurrent calls share one request. */
  const sync = useCallback((): Promise<void> => {
    if (inFlightSync.current) return inFlightSync.current;
    const run = (async () => {
      try {
        for (;;) {
          const changesBefore = changeCount.current;
          const [itemsBody, outfitsBody, categoriesBody] = await Promise.all([
            apiRequest<unknown>("/api/items"),
            apiRequest<unknown>("/api/outfits"),
            apiRequest<unknown>("/api/categories"),
          ]);
          // A change saved meanwhile may be missing from these lists.
          if (changesBefore !== changeCount.current) continue;

          const data = parseWardrobe(itemsBody, outfitsBody, categoriesBody);
          if (!data) {
            throw new ApiError("server", 200, "Trove sent a reply it couldn't read. Please try again.");
          }
          dispatch({ type: "synced", data });
          setStatus({ state: "synced" });
          lastSyncedAt.current = Date.now();
          pruneCachedImages(photoUrls(data.items));
          void loadUsage();
          return;
        }
      } catch (error) {
        if (isSignedOutError(error)) return;
        setStatus(
          error instanceof ApiError && error.kind === "offline"
            ? { state: "offline" }
            : {
                state: "error",
                message: errorMessage(error, "Your wardrobe couldn't be loaded. Please try again."),
              },
        );
      } finally {
        inFlightSync.current = null;
      }
    })();
    inFlightSync.current = run;
    return run;
  }, [loadUsage]);

  const resync = useCallback(() => void sync(), [sync]);

  // The problem panel stays up (with a spinner) until the retry resolves.
  const retry = useCallback(async () => {
    setRetrying(true);
    await sync();
    setRetrying(false);
    // The Retry button is gone once synced: keep keyboard focus in the view.
    if (!document.activeElement || document.activeElement === document.body) {
      document.getElementById("view-title")?.focus();
    }
  }, [sync]);

  // First load: show this device's copy at once, then sync with the API.
  useEffect(() => {
    let active = true;
    void readSnapshot().then((raw) => {
      const cached = parseSnapshot(raw);
      if (active && cached) dispatch({ type: "cache-loaded", data: cached });
    });
    void sync();
    return () => {
      active = false;
    };
  }, [sync]);

  // Keep the offline copy current after every sync and saved change.
  useEffect(() => {
    if (wardrobe.revision > 0) void writeSnapshot(wardrobe.data);
  }, [wardrobe.revision, wardrobe.data]);

  // Re-sync when the connection returns or the tab is shown again.
  useEffect(() => {
    const goOffline = () => setStatus({ state: "offline" });
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastSyncedAt.current > RESYNC_AFTER_MS
      ) {
        resync();
      }
    };
    window.addEventListener("online", resync);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", resync);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [resync]);

  useEffect(() => registerServiceWorker((apply) => setUpdate({ apply })), []);

  // A file dropped outside the photo area must not replace the app.
  useEffect(() => {
    const guard = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // --- Derived data -------------------------------------------------------

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const piecesOf = useCallback(
    (outfit: Outfit) =>
      outfit.itemIds
        .map((id) => itemsById.get(id))
        .filter((item): item is WardrobeItem => Boolean(item)),
    [itemsById],
  );

  // A filter whose last piece was deleted falls back to "All".
  const activeKey =
    activeCategory && categories.some((category) => categoryKey(category.name) === categoryKey(activeCategory))
      ? categoryKey(activeCategory)
      : null;

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!activeKey || categoryKey(item.category) === activeKey) &&
        (!needle ||
          [item.name, item.category, item.color, item.season].join(" ").toLowerCase().includes(needle)),
    );
  }, [items, activeKey, search]);

  const categorySuggestions = useMemo(() => {
    const seen = new Set<string>();
    return [...categories.map((category) => category.name), ...PRESET_CATEGORIES].filter((name) => {
      const key = categoryKey(name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [categories]);

  const coverOf = useCallback(
    (category: string) => items.find((item) => categoryKey(item.category) === categoryKey(category)),
    [items],
  );

  const listState: ListState = hasData
    ? "ready"
    : status.state === "loading"
      ? "loading"
      : status.state === "synced"
        ? "ready"
        : "unavailable";

  // --- Actions --------------------------------------------------------------

  function openDialog(next: DialogState) {
    setDialogBusy(false);
    setDialog(next);
  }

  function closeDialog() {
    if (!dialogBusy) setDialog(null);
  }

  function goHome() {
    setView("wardrobe");
    setSearch("");
    setActiveCategory(null);
    window.scrollTo({ top: 0 });
  }

  function navigate(next: View) {
    setView(next);
    window.scrollTo({ top: 0 });
  }

  const addLabel = view === "outfits" && items.length ? "New outfit" : "Add piece";

  function startAdd(kind: "item" | "outfit" = view === "outfits" && items.length ? "outfit" : "item") {
    if (readOnlyMessage) {
      notify(readOnlyMessage, "info");
      return;
    }
    openDialog(kind === "outfit" ? { kind: "add-outfit" } : { kind: "add-item" });
  }

  function markChanged() {
    changeCount.current += 1;
  }

  function handleItemSaved(item: WardrobeItem, photoChanged: boolean, added: boolean) {
    markChanged();
    dispatch({ type: "item-saved", item });
    if (photoChanged) void loadUsage();
    if (added) {
      // Show the new piece: it might not match the current filter.
      setView("wardrobe");
      setSearch("");
      setActiveCategory(null);
      setDialog(null);
      notifyAfterClose(`“${item.name}” added to your wardrobe`);
    } else {
      setDialog({ kind: "item", id: item.id });
      notify("Changes saved");
    }
  }

  function handleOutfitSaved(outfit: Outfit, added: boolean) {
    markChanged();
    dispatch({ type: "outfit-saved", outfit });
    if (added) {
      setView("outfits");
      setDialog(null);
      notifyAfterClose(`“${outfit.name}” is ready`);
    } else {
      setDialog({ kind: "outfit", id: outfit.id });
      notify("Changes saved");
    }
  }

  function handleMissing(kind: "item" | "outfit", id: number) {
    markChanged();
    dispatch(kind === "item" ? { type: "item-removed", id } : { type: "outfit-removed", id });
    setDialog(null);
    notifyAfterClose(
      kind === "item" ? "That piece was already deleted." : "That outfit was already deleted.",
      "info",
    );
  }

  const goOffline = () => setStatus({ state: "offline" });

  function askDelete(kind: "item" | "outfit", id: number) {
    if (readOnlyMessage) {
      notify(readOnlyMessage, "info");
      return;
    }
    const name =
      kind === "item" ? itemsById.get(id)?.name : outfits.find((outfit) => outfit.id === id)?.name;
    if (name === undefined) return;
    const usedIn =
      kind === "item" ? outfits.filter((outfit) => outfit.itemIds.includes(id)).length : 0;
    setDeleteError(null);
    setDeleting(false);
    setDeleteTarget({ kind, id, name, usedIn });
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError(null);

    let alreadyGone = false;
    try {
      await apiRequest(`/api/${target.kind === "item" ? "items" : "outfits"}/${target.id}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (isSignedOutError(error)) return;
      if (error instanceof ApiError && error.status === 404) {
        alreadyGone = true;
      } else {
        if (error instanceof ApiError && error.kind === "offline") goOffline();
        setDeleteError(errorMessage(error, "This couldn't be deleted. Please try again."));
        setDeleting(false);
        return;
      }
    }

    markChanged();
    dispatch(
      target.kind === "item"
        ? { type: "item-removed", id: target.id }
        : { type: "outfit-removed", id: target.id },
    );
    if (target.kind === "item") void loadUsage();
    setDeleting(false);
    setDeleteTarget(null);
    setDialog(null);
    notifyAfterClose(
      alreadyGone ? `“${target.name}” was already deleted` : `“${target.name}” deleted`,
    );
  }

  async function logOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    await wipeLocalData();
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
      // 401: this session had already ended, which is just as signed out.
      if (response.ok || response.status === 401) {
        window.location.replace("/login");
        return;
      }
      notify("Trove couldn't log you out. Please try again.", "error");
    } catch {
      notify(
        "You're offline, so Trove couldn't finish logging out. This device's saved copy was removed. Try again when you're online.",
        "error",
      );
    }
    setLoggingOut(false);
  }

  // --- Dialog content ---------------------------------------------------------

  const sharedFormProps = {
    titleId: sheetTitleId,
    readOnlyMessage,
    onBusyChange: setDialogBusy,
    onClose: closeDialog,
    onOffline: goOffline,
  };

  function missingContent(what: string) {
    return (
      <>
        <DialogHeader titleId={sheetTitleId} kicker="Trove" title="Not found" onClose={closeDialog} />
        <p className="detail-empty">That {what} no longer exists. It may have been deleted on another device.</p>
      </>
    );
  }

  function renderDialog(current: DialogState) {
    switch (current.kind) {
      case "add-item":
        return (
          <ItemForm
            {...sharedFormProps}
            categorySuggestions={categorySuggestions}
            onCancel={closeDialog}
            onSaved={(item, photoChanged) => handleItemSaved(item, photoChanged, true)}
            onMissing={(id) => handleMissing("item", id)}
          />
        );
      case "edit-item": {
        const item = itemsById.get(current.id);
        if (!item) return missingContent("piece");
        return (
          <ItemForm
            {...sharedFormProps}
            item={item}
            categorySuggestions={categorySuggestions}
            onCancel={() => setDialog({ kind: "item", id: item.id })}
            onSaved={(saved, photoChanged) => handleItemSaved(saved, photoChanged, false)}
            onMissing={(id) => handleMissing("item", id)}
          />
        );
      }
      case "item": {
        const item = itemsById.get(current.id);
        if (!item) return missingContent("piece");
        return (
          <ItemDetail
            item={item}
            outfits={outfits.filter((outfit) => outfit.itemIds.includes(item.id))}
            titleId={sheetTitleId}
            readOnlyMessage={readOnlyMessage}
            onClose={closeDialog}
            onEdit={() => {
              if (!readOnlyMessage) setDialog({ kind: "edit-item", id: item.id });
            }}
            onDelete={() => askDelete("item", item.id)}
            onOpenOutfit={(id) => setDialog({ kind: "outfit", id })}
          />
        );
      }
      case "add-outfit":
        return (
          <OutfitForm
            {...sharedFormProps}
            items={items}
            onCancel={closeDialog}
            onSaved={(outfit) => handleOutfitSaved(outfit, true)}
            onMissing={(id) => handleMissing("outfit", id)}
            onStale={resync}
          />
        );
      case "edit-outfit": {
        const outfit = outfits.find((entry) => entry.id === current.id);
        if (!outfit) return missingContent("outfit");
        return (
          <OutfitForm
            {...sharedFormProps}
            outfit={outfit}
            items={items}
            onCancel={() => setDialog({ kind: "outfit", id: outfit.id })}
            onSaved={(saved) => handleOutfitSaved(saved, false)}
            onMissing={(id) => handleMissing("outfit", id)}
            onStale={resync}
          />
        );
      }
      case "outfit": {
        const outfit = outfits.find((entry) => entry.id === current.id);
        if (!outfit) return missingContent("outfit");
        return (
          <OutfitDetail
            outfit={outfit}
            pieces={piecesOf(outfit)}
            titleId={sheetTitleId}
            readOnlyMessage={readOnlyMessage}
            onClose={closeDialog}
            onEdit={() => {
              if (!readOnlyMessage) setDialog({ kind: "edit-outfit", id: outfit.id });
            }}
            onDelete={() => askDelete("outfit", outfit.id)}
            onOpenItem={(id) => setDialog({ kind: "item", id })}
          />
        );
      }
      case "account":
        return (
          <>
            <DialogHeader titleId={sheetTitleId} kicker="Trove" title="Account" onClose={closeDialog} />
            <AccountPanel status={status} usage={usage} loggingOut={loggingOut} onLogOut={logOut} />
          </>
        );
    }
  }

  const dialogKey = dialog ? `${dialog.kind}-${"id" in dialog ? dialog.id : ""}` : "";
  const addAction = { label: addLabel, onAdd: () => startAdd(), paused: Boolean(readOnlyMessage) };
  const account = (
    <AccountPanel status={status} usage={usage} loggingOut={loggingOut} onLogOut={logOut} />
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <Sidebar
        view={view}
        counts={{
          wardrobe: hasData ? items.length : null,
          outfits: hasData ? outfits.length : null,
          categories: hasData ? categories.length : null,
        }}
        onNavigate={navigate}
        onHome={goHome}
        add={addAction}
        account={account}
      />
      <TopBar onHome={goHome} status={status} />

      <main id="main" className="main" tabIndex={-1}>
        <section className="intro" aria-labelledby="intro-title">
          <div>
            <p className="kicker intro-greeting">{greeting ?? " "}</p>
            <h1 id="intro-title">
              Your wardrobe, <br />
              remembered.
            </h1>
          </div>
          <dl className="intro-stats">
            <div>
              <dt>Pieces</dt>
              <dd>{hasData ? items.length : "–"}</dd>
            </div>
            <div>
              <dt>Outfits</dt>
              <dd>{hasData ? outfits.length : "–"}</dd>
            </div>
          </dl>
        </section>

        <div className="content-panel">
          <StatusPanel
            status={status}
            source={wardrobe.source}
            retrying={retrying}
            onRetry={() => void retry()}
          />

          {view === "wardrobe" && (
            <WardrobeView
              items={items}
              visibleItems={visibleItems}
              categories={categories}
              activeCategory={activeKey ? activeCategory : null}
              onCategoryChange={setActiveCategory}
              search={search}
              onSearchChange={setSearch}
              state={listState}
              onOpenItem={(id) => openDialog({ kind: "item", id })}
              onAdd={() => startAdd("item")}
            />
          )}
          {view === "outfits" && (
            <OutfitsView
              outfits={outfits}
              piecesOf={piecesOf}
              hasItems={items.length > 0}
              state={listState}
              onOpenOutfit={(id) => openDialog({ kind: "outfit", id })}
              onAdd={() => startAdd(items.length ? "outfit" : "item")}
            />
          )}
          {view === "categories" && (
            <CategoriesView
              categories={categories}
              coverOf={coverOf}
              state={listState}
              onOpenCategory={(category) => {
                setActiveCategory(category);
                setSearch("");
                navigate("wardrobe");
              }}
              onAdd={() => startAdd("item")}
            />
          )}
        </div>
      </main>

      <BottomNav
        view={view}
        onNavigate={navigate}
        add={addAction}
        onAccount={() => openDialog({ kind: "account" })}
      />

      {dialog && (
        <Dialog
          labelledBy={sheetTitleId}
          onClose={closeDialog}
          busy={dialogBusy}
          contentKey={dialogKey}
          overlay={<Toaster toast={toast} onUpdate={null} />}
        >
          {renderDialog(dialog)}
        </Dialog>
      )}

      {deleteTarget && (
        <ConfirmDelete
          name={deleteTarget.name}
          message={
            deleteTarget.kind === "item"
              ? "The piece and its photo are removed for good."
              : "The outfit is removed. Its pieces stay in your wardrobe."
          }
          warning={
            deleteTarget.usedIn
              ? `Used in ${plural(deleteTarget.usedIn, "outfit")}. It will be removed from ${
                  deleteTarget.usedIn === 1 ? "it" : "them"
                }.`
              : null
          }
          busy={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <Toaster toast={toast} onUpdate={update?.apply ?? null} />
    </div>
  );
}
