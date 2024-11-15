import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { vDocumentId } from "./schema";
import { hash as sha256 } from "fast-sha256";

/**
 * Incremental changes version
 */
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
    if (!existing) {
      return ctx.db.insert("automerge", {
        documentId: args.documentId,
        data: args.data,
        hash,
        type: "snapshot",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        debugDump: args.debugDump,
      });
    }
    return existing._id;
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
    if (!existing) {
      return ctx.db.insert("automerge", {
        documentId: args.documentId,
        data: args.change,
        hash,
        type: "incremental",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        debugDump: args.debugDump,
      });
    }
    return existing._id;
  },
});

const MINUTE = 60 * 1000;
const RETENTION_BUFFER = 5 * MINUTE;

export const pullChanges = query({
  args: {
    documentId: vDocumentId,
    since: v.number(),
    numItems: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("automerge")
      .withIndex("documentId", (q) =>
        q.eq("documentId", args.documentId).gt("_creationTime", args.since)
      )
      .paginate({
        numItems: args.numItems ?? 10,
        cursor: args.cursor ?? null,
      });

    // For the first page, also reach further back to avoid missing changes
    // inserted out of order.
    // This isn't part of the paginate call, since the cursors wouldn't
    // stay consistent if they're based on Date.now().
    if (!args.cursor) {
      const retentionBuffer = await ctx.db
        .query("automerge")
        .withIndex("documentId", (q) =>
          q
            .eq("documentId", args.documentId)
            .gt("_creationTime", args.since - RETENTION_BUFFER)
            .lte("_creationTime", args.since)
        )
        .collect();
      result.page = retentionBuffer.concat(result.page);
    }
    return result;
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
