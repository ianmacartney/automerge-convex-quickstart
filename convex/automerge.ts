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
import schema from "./schema";

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
