import { defineTable, defineSchema } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  messages: defineTable({
    message: v.any(),
    version: v.number(),
  }).index("v", ["version"]),
});
