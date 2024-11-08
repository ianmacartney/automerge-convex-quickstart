import type { PeerId, DocumentId } from "@automerge/automerge-repo";
import { defineTable, defineSchema } from "convex/server";
import { v, VString } from "convex/values";

const PeerId = v.string() as VString<PeerId>;
const DocumentId = v.string() as VString<DocumentId>;

export default defineSchema({
  messages: defineTable({
    message: v.object({
      data: v.optional(v.bytes()),
      documentId: v.optional(DocumentId),
      senderId: PeerId,
      targetId: PeerId,
      type: v.string(),
    }),
    version: v.number(),
  }).index("v", ["version"]),
});
