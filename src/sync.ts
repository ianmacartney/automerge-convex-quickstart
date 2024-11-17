import { DocHandle, DocumentId, Repo } from "@automerge/automerge-repo";
import * as A from "@automerge/automerge/next";
import { ConvexReactClient, Watch } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { mergeArrays } from "@automerge/automerge-repo/helpers/mergeArrays.js";
import { throttle } from "@automerge/automerge-repo/helpers/debounce.js";
import { Channel } from "async-channel";
import { ConvexHttpClient } from "convex/browser";

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
  private lastSeen: number = 0;
  private watches: Watch<number>[] = [];    
  private unsubscribes: (() => void)[] = [];
  public documentId: DocumentId;
  private appliedChanges = new Set<Id<"automerge">>();
  // TODO: pull from local storage
  private lastSyncHeads?: A.Heads;
  private log: (...args: unknown[]) => void;
  private httpClient: ConvexHttpClient;

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
    this.httpClient = new ConvexHttpClient((convex as any).address);
    this.log = (opts.debugLogs || true) ? console.debug : () => {};
    this.documentId = handle.documentId;
    const lastSeen = getLastSeen(handle.documentId);
    this.log({ lastSeen });
    if (!isNew && !lastSeen) {
      void this.#load().then(() => {
        void this.#startWatchingHandle();
      });
    } else {      
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
    void this.#watch();
    void this.handleChange();
  }

  async #load() {
    let backoff = 100;
    for (;;) {
      try {        
        const maxSeqNo = await this.httpClient.query(api.sync.maxSeqNo, {
          documentId: this.documentId,
        });
        this.log("initial load maxSeqNo", maxSeqNo);
        while (this.lastSeen < maxSeqNo) {
          const result = await this.httpClient.query(api.sync.pullChanges, {
            documentId: this.documentId,
            since: this.lastSeen,
            numItems: 1000,
          });
          const changes: Uint8Array[] = [];
          for (const change of result) {            
            if (change.seqNo > this.lastSeen) {
              this.lastSeen = change.seqNo;
            }
            if (!this.appliedChanges.has(change._id)) {            
              changes.push(new Uint8Array(change.data));
              this.appliedChanges.add(change._id);              
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
        }
        this.log("initial load done", this.lastSeen);
        return;
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

  async #watch() {
    const maxSeqNoChannel = new Channel<number>();
    const watch = this.convex.watchQuery(api.sync.maxSeqNo, {
      documentId: this.documentId,
    });
    this.watches.push(watch);
    const currentMaxSeqNo = watch.localQueryResult();
    if (currentMaxSeqNo !== undefined) {
      maxSeqNoChannel.push(currentMaxSeqNo);
    }
    this.unsubscribes.push(watch.onUpdate(() => {
      const maxSeqNo = watch.localQueryResult();
      if (maxSeqNo !== undefined) {
        maxSeqNoChannel.push(maxSeqNo);
      }
    }));    
    for (;;) {
      const maxSeqNo = await maxSeqNoChannel.get();
      while (this.lastSeen < maxSeqNo) {
        const results = await this.httpClient.query(api.sync.pullChanges, {
          documentId: this.documentId,
          since: this.lastSeen,
          numItems: 1000,
        });
        const doc = this.handle.docSync();
        if (!doc) {
          throw new Error("doc is undefined in watch");
        }
        const headsBefore = A.getHeads(doc);
        const changes: Uint8Array[] = [];
        for (const result of results) {
          if (result.seqNo > this.lastSeen) {
            this.lastSeen = result.seqNo;
          }
          if (!this.appliedChanges.has(result._id)) {
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
          }
          console.log("watch applied", result._id, result.seqNo, this.lastSeen);          
        }        
        if (changes.length > 0) {
          this.log("watch applyChanges", changes.length);
          this.handle.update((doc) =>
            A.loadIncremental<T>(doc, mergeArrays(changes))
          );
        }
        const headsAfter = A.getHeads(this.handle.docSync()!);
        if (!headsEqual(headsBefore, headsAfter)) {
          this.log("watch saving lastSeen", this.lastSeen);
          this.#saveLastSeen(this.lastSeen);
        }        
      }
    }
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
    // TODO: this removes all listeners, where we only want to remove
    // the ones we added. Just add this to the unsubscribes on initialization.
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
