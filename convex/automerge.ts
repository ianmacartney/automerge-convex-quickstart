import type { DocumentId } from "@automerge/automerge-repo/slim";
import * as Automerge from "@automerge/automerge/slim/next";
import "./_patch";
import { mergeArrays } from "@automerge/automerge-repo/helpers/mergeArrays.js";
// @ts-expect-error wasm is not a module
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64.js";
import { hash as sha256 } from "fast-sha256";
import { api, internal } from "./_generated/api";
import {
  action,
  DatabaseReader,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { vDocumentId } from "./schema";
import { TaskList } from "./types";
import { v } from "convex/values";

async function load() {
  console.time("initializeBase64Wasm");
  return Automerge.initializeBase64Wasm(automergeWasmBase64 as string).then(
    () => {
      console.timeEnd("initializeBase64Wasm");
      return Automerge;
    }
  );
}

async function automergeLoaded() {
  await Automerge.wasmInitialized();
  return Automerge;
}

export const doc = query({
  args: { documentId: vDocumentId },
  handler: async (ctx, args) => {
    return loadDoc(ctx, args.documentId);
  },
});

export const compact = action({
  args: { documentId: vDocumentId },
  handler: async (ctx, args) => {
    const { data, ids } = await ctx.runQuery(
      internal.automerge.docBinaryWithIds,
      {
        documentId: args.documentId,
      }
    );
    await ctx.runMutation(internal.automerge.submitSnapshotAndDelete, {
      ids,
      documentId: args.documentId,
      data,
    });
  },
});

export const docBinaryWithIds = internalQuery({
  args: { documentId: vDocumentId },
  handler: async (ctx, args) => {
    void load();
    const result = await ctx.db
      .query("automerge")
      .withIndex("doc_type_hash", (q) => q.eq("documentId", args.documentId))
      .collect();
    const A = await automergeLoaded();
    const doc = A.loadIncremental(
      A.init(),
      mergeArrays(result.map((r) => new Uint8Array(r.data)))
    );
    return {
      data: toArrayBuffer(A.save(doc)),
      ids: result.map((r) => r._id),
    };
  },
});

export const submitSnapshotAndDelete = internalMutation({
  args: {
    ids: v.array(v.id("automerge")),
    documentId: vDocumentId,
    data: v.bytes(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(api.sync.submitSnapshot, {
      data: args.data,
      documentId: args.documentId,
    });
    await Promise.all(args.ids.map((id) => ctx.db.delete(id)));
  },
});

async function loadDoc(ctx: { db: DatabaseReader }, documentId: DocumentId) {
  const result = await ctx.db
    .query("automerge")
    .withIndex("doc_type_hash", (q) => q.eq("documentId", documentId))
    .collect();
  const A = await automergeLoaded();
  return A.loadIncremental<TaskList>(
    A.init(),
    mergeArrays(result.map((r) => new Uint8Array(r.data)))
  );
}

export const deleteDoc = internalMutation({
  args: { documentId: vDocumentId },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("automerge")
      .withIndex("doc_type_hash", (q) => q.eq("documentId", args.documentId))
      .collect();
    await Promise.all(result.map((r) => ctx.db.delete(r._id)));
  },
});

export const testAdd = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (Automerge.isWasmInitialized()) {
      console.log("wasm already initialized");
    } else {
      void load();
    }
    // const doc = A.load<TaskList>();
    const documentId = "eNEmGYHnwmXkhiWVuzT6CNQvKYa" as DocumentId;
    const orig = await loadDoc(ctx, documentId);
    const A = await automergeLoaded();
    const o2 = A.clone(orig);
    // To update and submit a new snapshot:
    const heads = A.getHeads(orig);
    const doc = A.change(orig, (doc) => {
      doc.tasks[0].title = "test2";
    });

    const missing = A.getMissingDeps(doc, heads);
    console.log("missing", missing);

    const missing2 = A.getMissingDeps(orig, A.getHeads(doc));
    console.log("missing2", missing2);

    const missing3 = A.getMissingDeps(o2, A.getHeads(doc));
    console.log("missing3", missing3);

    // To make a new head:
    // const doc = A.from({
    //   tasks: [{ title: "test", done: true }],
    // });
    // const doc = A.from({ tasks: [{ title: "test", done: true }] });
    const binary = A.save(doc);
    await ctx.runMutation(api.sync.submitSnapshot, {
      documentId,
      data: toArrayBuffer(binary),
    });

    // const documentId = "automerge:eNEmGYHnwmXkhiWVuzT6CNQvKYa" as DocumentId;
    // await ctx.runMutation(api.automerge.insert, {
    //   data: toArrayBuffer(A.save(doc)),
    //   documentId,
    //   hash: headsHash(A.getHeads(doc)),
    // });
    // const handle = new DocHandle<TaskList>(docId, {
    //   isNew: true,
    //   initialValue: doc,
    // });
  },
});

export const testToggle = mutation({
  args: { documentId: vDocumentId },
  handler: async (ctx, args) => {
    void load();
    const result = await ctx.db
      .query("automerge")
      .withIndex("doc_type_hash", (q) => q.eq("documentId", args.documentId))
      .collect();
    const A = await automergeLoaded();
    const doc = A.loadIncremental<TaskList>(
      A.init(),
      mergeArrays(result.map((r) => new Uint8Array(r.data)))
    );
    const sinceHeads = A.getHeads(doc);
    const doc2 = A.change<TaskList>(doc, (doc) => {
      doc.tasks[0].done = !doc.tasks[0].done;
    });
    const change = A.getLastLocalChange(doc2);
    const change2 = A.saveSince(doc2, sinceHeads);
    if (!change) throw new Error("no change");
    if (change.length !== change2.length) throw new Error("length mismatch");
    if (!change.every((c, i) => c === change2[i]))
      throw new Error("content mismatch");
    await ctx.runMutation(api.sync.submitChange, {
      documentId: args.documentId,
      change: toArrayBuffer(change),
    });
    // const delta = await ctx.runQuery(api.automerge.getChange, {
    //   documentId: args.documentId,
    //   sinceHeads: sinceHeads,
    // });
    // const change3 = new Uint8Array(delta.change!);
    // if (change3.length !== change.length) throw new Error("length mismatch");
    // if (!change3.every((c, i) => c === change[i]))
    //   throw new Error(
    //     `delta content mismatch: ${change3.toString()} !== ${change.toString()}`
    //   );
    // const doc3 = A.change(doc, (doc) => {
    //   doc.tasks[0].done = false;
    // });
    // await ctx.runMutation(api.automerge.change, {
    //   documentId: args.documentId,
    //   data: toArrayBuffer(A.save(doc3)),
    //   hash: headsHash(A.getHeads(doc3)),
    // });
  },
});

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

function headsHash(heads: Automerge.Heads): string {
  const encoder = new TextEncoder();
  const headsbinary = mergeArrays(heads.map((h: string) => encoder.encode(h)));
  return keyHash(headsbinary);
}

const toArrayBuffer = (bytes: Uint8Array) => {
  const { buffer, byteOffset, byteLength } = bytes;
  return buffer.slice(byteOffset, byteOffset + byteLength);
};
