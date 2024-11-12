import "./_patch";
import * as Automerge from "@automerge/automerge/slim/next";
import {
  DocHandle,
  DocumentId,
  PeerId,
  Repo,
} from "@automerge/automerge-repo/slim";
// @ts-expect-error wasm is not a module
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64.js";
import { hash as sha256 } from "fast-sha256";
// Can we get this to work?
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
import { mergeArrays } from "@automerge/automerge-repo/helpers/mergeArrays.js";
import { headsAreSame } from "@automerge/automerge-repo/helpers/headsAreSame.js";

console.time("initializeBase64Wasm");
void Automerge.initializeBase64Wasm(automergeWasmBase64 as string).then(() =>
  console.timeEnd("initializeBase64Wasm")
);

async function loadAutomerge() {
  await Automerge.wasmInitialized();
  return Automerge;
}
/**
 * Incremental changes version
 */

export const submitSnapshot = mutation({
  args: {
    documentId: vDocumentId,
    data: v.bytes(),
  },
  handler: async (ctx, args) => {
    const A = await loadAutomerge();
    const newDoc = A.load(new Uint8Array(args.data));
    const hash = headsHash(A.getHeads(newDoc));
    const existing = await ctx.db
      .query("automerge")
      .withIndex("doc_type_hash", (q) =>
        q
          .eq("documentId", args.documentId)
          .eq("type", "snapshot")
          .eq("hash", hash)
      )
      .first();
    if (!existing) {
      await ctx.db.insert("automerge", {
        documentId: args.documentId,
        data: args.data,
        hash,
        type: "snapshot",
      });
    }
  },
});

export const submitChange = mutation({
  args: {
    documentId: vDocumentId,
    change: v.bytes(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("automerge", {
      documentId: args.documentId,
      data: args.change,
      hash: keyHash(new Uint8Array(args.change)),
      type: "incremental",
    });
  },
});

export const getDelta = query({
  args: { documentId: vDocumentId, sinceHeads: v.array(v.string()) },
  handler: async (ctx, args) => {
    const doc = await loadDoc(ctx, args.documentId);
    const A = await loadAutomerge();
    const change = A.saveSince(doc, args.sinceHeads);
    return {
      change: toArrayBuffer(change),
      heads: A.getHeads(doc),
    };
  },
});

export const doc = query({
  args: { documentId: vDocumentId },
  handler: async (ctx, args) => {
    return loadDoc(ctx, args.documentId);
  },
});

// This could be an action that separates the query from the mutation,
// only deleting the changes read in the query.
// However, the delete would need to be more defensive, and we'd need to
// validate that creating snapshots concurrently is ok.
// Also the insert would need to be more defensive (unique on hash).
export const compact = mutation({
  args: { documentId: vDocumentId },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("automerge")
      .withIndex("doc_type_hash", (q) => q.eq("documentId", args.documentId))
      .collect();
    const A = await loadAutomerge();
    const doc = A.loadIncremental(
      A.init(),
      mergeArrays(result.map((r) => new Uint8Array(r.data)))
    );
    const binary = A.save(doc);
    await ctx.db.insert("automerge", {
      documentId: args.documentId,
      data: toArrayBuffer(binary),
      hash: headsHash(A.getHeads(doc)),
      type: "snapshot",
    });
    await Promise.all(result.map((r) => ctx.db.delete(r._id)));
  },
});

async function loadDoc(ctx: { db: DatabaseReader }, documentId: DocumentId) {
  const result = await ctx.db
    .query("automerge")
    .withIndex("doc_type_hash", (q) => q.eq("documentId", documentId))
    .collect();
  const A = await loadAutomerge();
  return A.loadIncremental<TaskList>(
    A.init(),
    mergeArrays(result.map((r) => new Uint8Array(r.data)))
  );
}

export const heads = query({
  args: { documentId: vDocumentId },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("automerge")
      .withIndex("doc_type_hash", (q) => q.eq("documentId", args.documentId))
      .collect();
    const hashes = result.map((r) => r.hash);
    const doc = await loadDoc(ctx, args.documentId);
    const A = await loadAutomerge();
    return { heads: A.getHeads(doc), hashes };
  },
});

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
    }
    // const doc = A.load<TaskList>();
    const documentId = "eNEmGYHnwmXkhiWVuzT6CNQvKYa" as DocumentId;
    const orig = await loadDoc(ctx, documentId);
    const A = await loadAutomerge();
    // To update and submit a new snapshot:
    const doc = A.change(orig, (doc) => {
      doc.tasks[0].title = "test2";
    });
    // To make a new head:
    // const doc = A.from({
    //   tasks: [{ title: "test", done: true }],
    // });
    // const doc = A.from({ tasks: [{ title: "test", done: true }] });
    const binary = A.save(doc);
    await ctx.runMutation(api.automerge.submitSnapshot, {
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
    const result = await ctx.db
      .query("automerge")
      .withIndex("doc_type_hash", (q) => q.eq("documentId", args.documentId))
      .collect();
    const A = await loadAutomerge();
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
    await ctx.runMutation(api.automerge.submitChange, {
      documentId: args.documentId,
      change: toArrayBuffer(change),
    });
    const delta = await ctx.runQuery(api.automerge.getDelta, {
      documentId: args.documentId,
      sinceHeads: sinceHeads,
    });
    const change3 = new Uint8Array(delta.change);
    if (change3.length !== change.length) throw new Error("length mismatch");
    if (!change3.every((c, i) => c === change[i]))
      throw new Error(
        `delta content mismatch: ${change3.toString()} !== ${change.toString()}`
      );
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
export function keyHash(binary: Uint8Array) {
  // calculate hash
  const hash = sha256(binary);
  // To hex string
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

export function headsHash(heads: Automerge.Heads): string {
  const encoder = new TextEncoder();
  const headsbinary = mergeArrays(heads.map((h: string) => encoder.encode(h)));
  return keyHash(headsbinary);
}
