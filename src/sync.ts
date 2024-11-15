import { DocHandle, DocumentId, Repo } from "@automerge/automerge-repo";
import * as A from "@automerge/automerge/next";
import { ConvexReactClient, Watch } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { mergeArrays } from "@automerge/automerge-repo/helpers/mergeArrays.js";
import { throttle } from "@automerge/automerge-repo/helpers/debounce.js";

export function sync<T = unknown>(
  repo: Repo,
  convex: ConvexReactClient,
  opts: {
    debugDump?: boolean;
    debugLogs?: boolean;
  } = {}
) {
  const docSyncs: Record<DocumentId, ConvexDocSync<T>> = {};
  const log = opts.debugLogs ? console.debug : () => {};

  repo.on("document", ({ handle, isNew }) => {
    log("on document", { handle, isNew, state: handle.state });
    const documentId = handle.documentId;
    if (handle.inState(["awaitingNetwork", "loading", "requesting"])) {
      handle.request();
    }
    if (!docSyncs[documentId]) {
      docSyncs[documentId] = new ConvexDocSync(
        convex,
        repo,
        handle as DocHandle<T>,
        isNew,
        opts
      );
    }
  });
}

function getLastSeen(documentId: DocumentId) {
  const lastSeen = localStorage.getItem(`lastSeen-${documentId}`);
  if (!lastSeen) {
    return null;
  }
  return JSON.parse(lastSeen) as number;
}

class ConvexDocSync<T> {
  private lastSeen?: number;
  private watches: Watch<FunctionReturnType<typeof api.sync.pullChanges>>[] =
    [];
  private unsubscribes: (() => void)[] = [];
  public documentId: DocumentId;
  private appliedChanges = new Set<Id<"automerge">>();
  // TODO: pull from local storage
  private lastSyncHeads?: A.Heads;
  private log: (...args: unknown[]) => void;

  constructor(
    private convex: ConvexReactClient,
    private repo: Repo,
    private handle: DocHandle<T>,
    // This is true when the document is just created locally.
    isNew: boolean,
    private opts: {
      debugDump?: boolean;
      debugLogs?: boolean;
    } = {}
  ) {
    this.log = opts.debugLogs ? console.debug : () => {};
    this.documentId = handle.documentId;
    const lastSeen = getLastSeen(handle.documentId);
    this.log({ lastSeen });
    if (!isNew && !lastSeen) {
      void this.#load().then(() => {
        void this.#startWatchingHandle();
      });
    } else {
      this.lastSeen = lastSeen ?? 0;
      void this.#startWatchingHandle();
    }
    handle.on("change", (change) => {
      this.log("on change", change);
      void this.handleChange();
    });
    handle.on("delete", () => {
      this.log("handle delete");
    });
    handle.on("heads-changed", (heads) => {
      this.log("handle heads-changed", heads);
    });
    handle.on("unavailable", () => {
      this.log("handle unavailable");
    });
    handle.on("remote-heads", (remoteHeads) => {
      this.log("handle remote-heads", remoteHeads);
    });
  }

  #startWatchingHandle() {
    this.#watch(this.lastSeen ?? 0);
    void this.handleChange();
  }

  async #load() {
    let cursor: string | undefined;
    let backoff = 100;
    for (;;) {
      try {
        const result = await this.convex.query(api.sync.pullChanges, {
          documentId: this.documentId,
          since: 0,
          numItems: 1000,
          cursor,
        });
        const changes: Uint8Array[] = [];
        for (const change of result.page) {
          if (this.appliedChanges.has(change._id)) {
            this.log("in load but already applied", change._id);
            continue;
          }
          changes.push(new Uint8Array(change.data));
          this.appliedChanges.add(change._id);
          if (!this.lastSeen || change._creationTime > this.lastSeen) {
            this.lastSeen = change._creationTime;
          }
        }
        if (changes.length > 0) {
          const doc = this.handle.docSync();
          this.log("initial load: updating", doc, changes.length);
          this.handle.update((doc) =>
            A.loadIncremental<T>(doc, mergeArrays(changes))
          );
          this.#saveLastSeen(this.lastSeen!);
        }
        if (result.isDone) {
          break;
        } else {
          cursor = result.continueCursor;
        }
      } catch (error) {
        console.error(
          `pull failed - waiting for ${(backoff / 1000).toFixed(1)}s`,
          error
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff *= 2;
        this.log("pull retry");
      }
    }
  }

  #watch(since: number, cursor?: string) {
    const watch = this.convex.watchQuery(api.sync.pullChanges, {
      documentId: this.documentId,
      since,
      cursor,
    });
    this.watches.push(watch);
    let startedNextPage = false;
    this.unsubscribes.push(
      watch.onUpdate(() => {
        const results = watch.localQueryResult();
        if (!results) return;
        this.log("watch onUpdate", results.page.length, {
          cursor,
          isDone: results.isDone,
        });
        if (!results.isDone && !startedNextPage) {
          startedNextPage = true;
          this.log("starting next page");
          this.#watch(since, results.continueCursor);
        }

        let latest = this.lastSeen ?? 0;
        const doc = this.handle.docSync();
        if (!doc) {
          throw new Error("doc is undefined in watch");
        }
        const headsBefore = A.getHeads(doc);
        const changes: Uint8Array[] = [];
        for (const result of results.page) {
          if (this.appliedChanges.has(result._id)) {
            continue;
          }
          switch (result.type) {
            case "incremental":
              this.log(
                "watch applyIncremental",
                result._id,
                result._creationTime
              );
              changes.push(new Uint8Array(result.data));
              break;
            case "snapshot":
              this.log("watch applySnapshot", result._id, result._creationTime);
              this.handle.update((doc) =>
                A.loadIncremental<T>(doc, new Uint8Array(result.data))
              );
              break;
          }
          this.appliedChanges.add(result._id);
          if (result._creationTime > latest) {
            latest = result._creationTime;
          }
        }
        if (changes.length > 0) {
          this.log("watch applyChanges", changes.length);
          this.handle.update((doc) =>
            A.loadIncremental<T>(doc, mergeArrays(changes))
          );
        }
        if (latest && (!this.lastSeen || latest > this.lastSeen)) {
          this.lastSeen = latest;
          const headsAfter = A.getHeads(this.handle.docSync()!);
          if (!headsEqual(headsBefore, headsAfter)) {
            this.log("watch saving lastSeen", latest);
            this.#saveLastSeen(latest);
          }
        }
      })
    );
  }

  // With throttle only the last call within the interval will be executed.
  #saveLastSeen = throttle(this.#flushAndSaveLastSeen.bind(this), 1000);

  #flushAndSaveLastSeen(lastSeen: number) {
    // This might be overkill, but ensure we only save the last seen
    // time if the changes get flushed.
    this.repo
      .flush([this.documentId])
      .then(() => {
        this.log("flushed & saving lastSeen", lastSeen);
        localStorage.setItem(
          `lastSeen-${this.documentId}`,
          lastSeen.toString()
        );
      })
      .catch((error) => {
        console.error("flush failed", error);
      });
  }

  stop() {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.handle.off("change");
    this.handle.off("delete");
    this.handle.off("heads-changed");
    this.handle.off("unavailable");
    this.handle.off("remote-heads");
  }

  // Ensure only one state change is in progress at a time.
  #pending?: {
    resolve: () => void;
    reject: () => void;
    promise: Promise<void>;
  };
  #handling = false;
  async handleChange(): Promise<void> {
    if (this.#handling) {
      this.log("handleChange already in progress");
      if (this.#pending) {
        return this.#pending.promise;
      }
      let resolve = () => {};
      let reject = () => {};
      const promise = new Promise<void>((resolve_, reject_) => {
        resolve = resolve_;
        reject = reject_;
      });
      this.#pending = { resolve, reject, promise };
      return promise;
    }
    this.#handling = true;
    try {
      this.log("handleStateChange", this.handle.state);
      switch (this.handle.state) {
        case "requesting":
        case "unavailable":
        case "awaitingNetwork": {
          // Download the document from the server.
          break;
        }
        case "deleted":
          // TODO: handle deleted document
          break;
        case "ready": {
          const doc = this.handle.docSync();
          if (!doc) {
            throw new Error("doc is ready but undefined");
          }
          const heads = A.getHeads(doc);
          const syncHeads = this.lastSyncHeads;
          // TODO: only upload if server doesn't have it..
          if (!syncHeads) {
            // If we created it, upload it.
            const id = await this.convex.mutation(api.sync.submitSnapshot, {
              documentId: this.documentId,
              data: toArrayBuffer(A.save(doc)),
              debugDump: this.opts.debugDump
                ? {
                    heads,
                    content: doc,
                  }
                : undefined,
            });
            this.log("submitSnapshot", id, heads);
            this.appliedChanges.add(id);
            this.lastSyncHeads = heads;
          } else if (headsEqual(heads, syncHeads)) {
            this.log("already in sync", syncHeads);
          } else {
            this.log("submitChange", syncHeads, heads);
            // TODO: See if A.saveSince is more efficient.
            const docBefore = A.view(doc, syncHeads);
            const changes = A.getChanges(docBefore, doc);
            this.log("changes", changes.length);
            const id = await this.convex.mutation(api.sync.submitChange, {
              documentId: this.documentId,
              change: toArrayBuffer(mergeArrays(changes)),
              debugDump: this.opts.debugDump
                ? {
                    heads,
                    change: changes.map((c) => A.decodeChange(c)),
                  }
                : undefined,
            });
            // TODO: Unfortunately we currently don't skip since watch
            // is called before the submitting mutation resolves.
            // We could track the hash before submitting if we wanted.
            this.appliedChanges.add(id);
            this.lastSyncHeads = heads;
            this.log("submittedChange", id);
          }
          break;
        }
      }
    } finally {
      this.#handling = false;
    }
    if (this.#pending) {
      const { resolve, reject } = this.#pending;
      this.#pending = undefined;
      this.handleChange().then(resolve).catch(reject);
    }
  }
}

const toArrayBuffer = (bytes: Uint8Array) => {
  const { buffer, byteOffset, byteLength } = bytes;
  return buffer.slice(byteOffset, byteOffset + byteLength);
};

function headsEqual(heads1: A.Heads, heads2: A.Heads) {
  return (
    heads1.length === heads2.length && heads1.every((h, i) => h === heads2[i])
  );
}
