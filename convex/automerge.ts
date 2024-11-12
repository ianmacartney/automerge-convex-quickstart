import "./_patch";
import * as A from "@automerge/automerge/slim/next";
import {
  DocHandle,
  DocumentId,
  PeerId,
  Repo,

} from "@automerge/automerge-repo/slim";
// @ts-expect-error wasm is not a module
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64.js";
// import wasm from "@automerge/automerge/automerge.wasm?url";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  action,
  DatabaseReader,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import schema, { vDocumentId } from "./schema";
import { ConvexStorageAdapter, toArrayBuffer } from "./ConvexStorageAdapter";
import { TaskList } from "./types";

console.time("initializeBase64Wasm");
const wasm = A.initializeBase64Wasm(automergeWasmBase64);

export const version = query({
  args: {},
  handler: async (ctx) => {
    return getMaxVersion(ctx);
  },
});

async function getMaxVersion(ctx: { db: DatabaseReader }) {
  const result = await ctx.db
    .query("messages")
    .withIndex("v")
    .order("desc")
    .first();
  return result?.version ?? 0;
}

export const pull = query({
  args: { after: v.number() },
  handler: async (ctx, args) => {
    return (
      await ctx.db
        .query("messages")
        .withIndex("v", (q) => q.gt("version", args.after))
        .order("desc")
        .take(100)
    ).reverse();
  },
});

export const send = mutation({
  args: schema.tables.messages.validator.fields.message,
  handler: async (ctx, args) => {
    // TODO: add sequence number
    const version = (await getMaxVersion(ctx)) + 1;
    await ctx.db.insert("messages", { message: args, version });
    return version;
  },
});

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

export const testAdd = internalMutation({
  args: {},
  handler: async (ctx, args) => {
    if (A.isWasmInitialized()) {
      console.log("wasm already initialized");
    } else {
      await wasm;
      await A.wasmInitialized();
      console.timeEnd("initializeBase64Wasm");
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
    await repo.flush([handle.documentId]);
    return [handle.documentId, await A.save(handle.docSync()!)];
  },
});

export const sync = mutation({
  args: {
    documentId: vDocumentId,
    headsBefore: v.array(v.string()),
    changes: v.array(v.bytes()),
  },
  handler: async (ctx, args) => {
    const repo = new Repo({
      network: [],
      storage: new ConvexStorageAdapter(ctx),
      peerId,
      isEphemeral: true,
      sharePolicy: async () => false,
    });
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
