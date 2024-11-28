import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { vDocumentId } from "./schema";
import { hash as sha256 } from "fast-sha256";

export const submitSnapshot = mutation({
  args: {
    documentId: vDocumentId,
    data: v.bytes(),
    debugDump: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const hash = keyHash(new Uint8Array(args.data));
    const existing = await ctx.db
      .query("automerge")
      .withIndex("doc_type_hash", (q) =>
        q
          .eq("documentId", args.documentId)
          .eq("type", "snapshot")
          .eq("hash", hash)
      )
      .first();
    if (existing) {
      return existing._id;
    }
    const max = await ctx.db
      .query("automerge")
      .withIndex("documentId", (q) => q.eq("documentId", args.documentId))
      .order("desc")
      .first();
    const nextSeqNo = (max?.seqNo ?? 0) + 1;
    return ctx.db.insert("automerge", {
      documentId: args.documentId,
      seqNo: nextSeqNo,

      data: args.data,
      hash,
      type: "snapshot",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      debugDump: args.debugDump,
    });
  },
});

export const submitChange = mutation({
  args: {
    documentId: vDocumentId,
    change: v.bytes(),
    debugDump: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const hash = keyHash(new Uint8Array(args.change));
    const existing = await ctx.db
      .query("automerge")
      .withIndex("doc_type_hash", (q) =>
        q
          .eq("documentId", args.documentId)
          .eq("type", "incremental")
          .eq("hash", hash)
      )
      .first();
    if (existing) {
      return existing._id;
    }
    const max = await ctx.db
      .query("automerge")
      .withIndex("documentId", (q) => q.eq("documentId", args.documentId))
      .order("desc")
      .first();
    const nextSeqNo = (max?.seqNo ?? 0) + 1;

    return ctx.db.insert("automerge", {
      documentId: args.documentId,
      seqNo: nextSeqNo,
      data: args.change,
      hash,
      type: "incremental",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      debugDump: args.debugDump,
    });
  },
});

export const pullChanges = query({
  args: {
    documentId: vDocumentId,
    since: v.number(),
    numItems: v.optional(v.number()),    
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("automerge")
      .withIndex("documentId", (q) =>
        q.eq("documentId", args.documentId).gt("seqNo", args.since)
      )
      .take(args.numItems ?? 10);
    return result;
  },
});

export const maxSeqNo = query({
  args: { documentId: vDocumentId },
  handler: async (ctx, args) => {
    const max = await ctx.db
      .query("automerge")
      .withIndex("documentId", (q) => q.eq("documentId", args.documentId))
      .order("desc")
      .first();
    return max ? max.seqNo : 0;
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
