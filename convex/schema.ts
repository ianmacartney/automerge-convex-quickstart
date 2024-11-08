import type { PeerId, DocumentId } from "@automerge/automerge-repo";
import { defineTable, defineSchema } from "convex/server";
import { v, VString } from "convex/values";

export const vPeerId = v.string() as VString<PeerId>;
export const vDocumentId = v.string() as VString<DocumentId>;

export default defineSchema({
  messages: defineTable({
    message: v.object({
      data: v.optional(v.bytes()),
      documentId: v.optional(vDocumentId),
      senderId: vPeerId,
      targetId: vPeerId,
      type: v.string(),
    }),
    version: v.number(),
  }).index("v", ["version"]),
  automerge: defineTable({
    documentId: vDocumentId,
    type: v.union(v.literal("incremental"), v.literal("snapshot")),
    hash: v.string(),
    data: v.bytes(),
  }).index("doc_type_hash", ["documentId", "type", "hash"]),
});
