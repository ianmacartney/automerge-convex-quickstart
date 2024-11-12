import * as A from "@automerge/automerge/slim/next";
import { DocHandle, PeerId, Repo } from "@automerge/automerge-repo/slim";
import { v } from "convex/values";
import {
  DatabaseReader,
  internalMutation,
  mutation,
} from "./_generated/server";
import { vDocumentId } from "./schema";
import { ConvexStorageAdapter } from "./ConvexStorageAdapter";
import { TaskList } from "./types";

const peerId = process.env.CONVEX_CLOUD_URL as PeerId;

export const create = mutation({
  args: {
    documentId: vDocumentId,
    data: v.bytes(),
  },
  handler: async (ctx, args) => {
    const repo = new Repo({
      network: [],
      storage: new ConvexStorageAdapter(ctx),
      peerId,
      isEphemeral: true,
      sharePolicy: async () => false,
    });
    const doc = A.load(new Uint8Array(args.data));
    const handle = new DocHandle(args.documentId, {
      isNew: true,
      initialValue: doc,
    });
    repo.emit("document", { handle, isNew: true });
    await repo.flush([args.documentId]);
  },
});

export const syncRepo = mutation({
  args: {
    documentId: vDocumentId,
    headsBefore: v.array(v.string()),
    changes: v.array(v.bytes()),
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx);
    const handle = repo.find<{ tasks: { title: string; done: boolean }[] }>(
      args.documentId
    );
    await handle.whenReady(["ready", "deleted", "unavailable"]);
    if (handle.state === "deleted") {
      // TODO: un-delete document?
      return { deleted: true } as const;
    }
    if (handle.state === "unavailable") {
      throw new Error("Document unavailable - create it first.");
    } else if (handle.state === "ready") {
      handle.change((doc) =>
        A.applyChanges(
          doc,
          args.changes.map((c) => new Uint8Array(c))
        )
      );
    } else {
      throw new Error("handle in bad state:" + handle.state);
    }
    await repo.flush([args.documentId]);
    return;

    /**
           const patches = A.diff(after, A.getHeads(before), A.getHeads(after))
      if (patches.length > 0) {
        this.emit("change", {
          handle: this,
          doc: after,
          patches,
          // TODO: pass along the source (load/change/network)
          patchInfo: { before, after, source: "change" },
        })
      }
     */
  },
});

async function getRepo(ctx: { db: DatabaseReader }) {
  await A.wasmInitialized();
  const repo = new Repo({
    network: [],
    storage: new ConvexStorageAdapter(ctx),
    peerId,
    isEphemeral: true,
    sharePolicy: async () => false,
  });
  return repo;
}

export const testRepo = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (A.isWasmInitialized()) {
      console.log("wasm already initialized");
    } else {
      await A.wasmInitialized();
    }

    const repo = new Repo({
      network: [],
      storage: new ConvexStorageAdapter(ctx),
      peerId,
      isEphemeral: true,
      sharePolicy: async () => false,
    });
    const handle = repo.create<TaskList>({
      tasks: [{ title: "test", done: false }],
    });
    const doc = await handle.doc();
    await repo.flush([handle.documentId]);
    // await repo.flush();
    return [handle.documentId, doc && A.save(doc)];
  },
});
