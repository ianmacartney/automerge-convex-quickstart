import { DocHandle, DocumentId, Repo } from "@automerge/automerge-repo";
import * as A from "@automerge/automerge/next";
import { hash as sha256 } from "fast-sha256";
import { ConvexReactClient, Watch } from "convex/react";
import { TaskList } from "../convex/types.ts";
import { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { mergeArrays } from "@automerge/automerge-repo/helpers/mergeArrays.js";
import { throttle } from "@automerge/automerge-repo/helpers/debounce.js";

export function sync(repo: Repo, convex: ConvexReactClient) {
  const docSyncs: Record<DocumentId, ConvexDocSync> = {};

  repo.on("document", ({ handle, isNew }) => {
    console.log("on document", { handle, isNew });
    const documentId = handle.documentId;
    if (!docSyncs[documentId]) {
      docSyncs[documentId] = new ConvexDocSync(
        convex,
        repo,
        handle as DocHandle<TaskList>,
        isNew
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

class ConvexDocSync {
  // TODO: pull from local storage
  private lastSeen?: number;
  private watches: Watch<FunctionReturnType<typeof api.sync.pullChanges>>[] =
    [];
  private unsubscribes: (() => void)[] = [];
  public documentId: DocumentId;
  private appliedChanges = new Set<Id<"automerge">>();
  // TODO: pull from local storage
  private lastSyncHeads?: A.Heads;

  constructor(
    private convex: ConvexReactClient,
    private repo: Repo,
    private handle: DocHandle<TaskList>,
    isNew: boolean
  ) {
    this.documentId = handle.documentId;
    const lastSeen = getLastSeen(handle.documentId);
    console.debug("loading lastSeen", lastSeen);
    if (!lastSeen) {
      void this.#load(isNew).then(() => {
        this.#watch(this.lastSeen ?? 0);
      });
    } else {
      this.lastSeen = lastSeen;
      this.#watch(lastSeen);
    }
    handle.on("change", (change) => {
      console.log("on change", change);
      void this.handleChange(false);
    });
    handle.on("delete", () => {
      console.log("handle delete");
    });
    handle.on("heads-changed", (heads) => {
      console.log("handle heads-changed", heads);
    });
    handle.on("unavailable", () => {
      console.log("handle unavailable");
    });
    handle.on("remote-heads", (remoteHeads) => {
      console.log("handle remote-heads", remoteHeads);
    });
    void this.handleChange(isNew);
  }

  async #load(isNew: boolean) {
    // TODO: load from server and create/update
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
          if (doc) {
            this.handle.update((doc) => A.applyChanges(doc, changes)[0]);
          } else {
            const newDoc = A.loadIncremental<TaskList>(
              A.init(),
              mergeArrays(changes)
            );
            const dummyHandle = new DocHandle<TaskList>(this.documentId, {
              initialValue: newDoc,
              isNew,
            });
            this.handle.merge(dummyHandle);
          }
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
        console.log("pull retry");
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
        console.debug("watch onUpdate", results.page.length, {
          isDone: results.isDone,
        });
        if (!results.isDone && !startedNextPage) {
          startedNextPage = true;
          console.debug("starting next page");
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
          // TODO: Unfortunately we currently don't skip since the callback
          // is called before the submitting mutation resolves.
          // We could do a setTimeout here, but holding off for now.
          if (this.appliedChanges.has(result._id)) {
            continue;
          }
          switch (result.type) {
            case "incremental":
              console.debug(
                "watch applyIncremental",
                result._id,
                result._creationTime
              );
              changes.push(new Uint8Array(result.data));
              break;
            case "snapshot":
              console.debug("watch applySnapshot", result._id);
              this.handle.update((doc) =>
                A.loadIncremental<TaskList>(doc, new Uint8Array(result.data))
              );
              break;
          }
          this.appliedChanges.add(result._id);
          if (result._creationTime > latest) {
            latest = result._creationTime;
          }
        }
        if (changes.length > 0) {
          console.debug("watch applyChanges", changes.length);
          this.handle.update((doc) => A.applyChanges(doc, changes)[0]);
        }
        if (latest && (!this.lastSeen || latest > this.lastSeen)) {
          this.lastSeen = latest;
          const headsAfter = A.getHeads(this.handle.docSync()!);
          if (!headsEqual(headsBefore, headsAfter)) {
            console.debug("watch saving lastSeen", latest);
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
        console.debug("flushed & saving lastSeen", lastSeen);
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
  async handleChange(isNew: boolean): Promise<void> {
    if (this.#handling) {
      console.debug("handleChange already in progress");
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
      console.debug("handleStateChange", this.handle.state);
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
          if (isNew || !syncHeads) {
            // If we created it, upload it.
            const id = await this.convex.mutation(api.sync.submitSnapshot, {
              documentId: this.documentId,
              data: toArrayBuffer(A.save(doc)),
            });
            console.debug("submitSnapshot", id, heads);
            this.appliedChanges.add(id);
            this.lastSyncHeads = heads;
          } else if (headsEqual(heads, syncHeads)) {
            console.log("already in sync", syncHeads);
          } else {
            console.log("submitChange", syncHeads, heads);
            const change = A.saveSince(doc, syncHeads);
            const id = await this.convex.mutation(api.sync.submitChange, {
              documentId: this.documentId,
              change: toArrayBuffer(change),
            });
            this.appliedChanges.add(id);
            this.lastSyncHeads = heads;
          }
          break;
        }
      }
      // Then pull changes since the last seen time.
      // TODO: check if we have the change already
      // For new documents or new clients, this will be all changes.
    } finally {
      this.#handling = false;
    }
    if (this.#pending) {
      const { resolve, reject } = this.#pending;
      this.#pending = undefined;
      this.handleChange(false).then(resolve).catch(reject);
    }
  }
}

/**
 * Hash functions
 */

// Based on https://github.com/automerge/automerge-repo/blob/fixes/packages/automerge-repo/src/storage/keyHash.ts
function keyHash(binary: Uint8Array) {
  // calculate hash
  const hash = sha256(binary);
  // To hex string
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function headsHash(heads: A.Heads): string {
  const encoder = new TextEncoder();
  const headsbinary = mergeArrays(heads.map((h) => encoder.encode(h)));
  return keyHash(headsbinary);
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
