import type { DocumentId } from "@automerge/automerge-repo/slim";
import * as Automerge from "@automerge/automerge/slim/next";
import "./_patch";
import { mergeArrays } from "@automerge/automerge-repo/helpers/mergeArrays.js";
// @ts-expect-error wasm is not a module
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64.js";
import { api, internal } from "./_generated/api";
import {
  action,
  DatabaseReader,
  internalMutation,
  internalQuery,
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

const toArrayBuffer = (bytes: Uint8Array) => {
  const { buffer, byteOffset, byteLength } = bytes;
  return buffer.slice(byteOffset, byteOffset + byteLength);
};
