import {
  Chunk,
  DocumentId,
  StorageAdapterInterface,
  StorageKey,
} from "@automerge/automerge-repo/slim";
import { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { StorageId } from "convex/server";

function parseKey(keyOrPrefix: StorageKey) {
  const [documentId, type, hash] = keyOrPrefix;
  if (!documentId) {
    throw new Error(
      `A key must include a documentId: ${keyOrPrefix.join(",")}`
    );
  }
  if (type && type !== "incremental" && type !== "snapshot") {
    throw new Error("Unexpected type: " + type);
  }
  return [
    documentId as DocumentId,
    type as "incremental" | "snapshot" | undefined,
    hash,
  ] as const;
}

export class ConvexStorageAdapter implements StorageAdapterInterface {
  constructor(
    public ctx: { db: DatabaseReader | DatabaseWriter },
    public storageId: StorageId = process.env.CONVEX_CLOUD_URL as StorageId
  ) {}
  keyQuery(key: StorageKey, prefix: boolean = false) {
    console.debug("keyQuery", key, prefix);
    if (key.length > 3) {
      throw new Error("Invalid key length");
    }
    const [documentId, type, hash] = parseKey(key);
    return this.ctx.db.query("automerge").withIndex("doc_type_hash", (q) => {
      const docQ = q.eq("documentId", documentId);
      if (!type) {
        if (!prefix) throw new Error(`Key missing type: ${key.join(",")}`);
        return docQ;
      }
      const typeQ = docQ.eq("type", type);
      if (!hash) {
        if (!prefix) throw new Error(`Key missing hash: ${key.join(",")}`);
        return typeQ;
      }
      return typeQ.eq("hash", hash);
    });
  }
  /** Load the single value corresponding to `key` */
  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    console.debug("load", key);
    if (key.length === 1 && key[0] === "storage-adapter-id") {
      // We use the storageId
      return new TextEncoder().encode(this.storageId);
    }
    const doc = await this.keyQuery(key).unique();
    if (!doc) return undefined;
    return new Uint8Array(doc.data);
  }

  /** Save the value `data` to the key `key` */
  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    console.debug("save", key);
    if (key.length === 1 && key[0] === "storage-adapter-id") {
      return;
    }
    const existing = await this.keyQuery(key).unique();
    if (!isDatabaseWriter(this.ctx.db)) {
      throw new Error("Trying to save from a query!");
    }
    if (existing) {
      // Throw if the data is not the same
      const existingData = new Uint8Array(existing.data);
      if (existingData.byteLength !== data.byteLength) {
        throw new Error("Data length mismatch");
      }
      if (!existingData.every((b, i) => b === data[i])) {
        throw new Error("Data mismatch!");
      }
    } else {
      const [documentId, type, hash] = parseKey(key);
      if (!type || !hash) {
        throw new Error(`Key missing type/hash: ${key.join(",")}`);
      }
      await this.ctx.db.insert("automerge", {
        documentId,
        hash,
        type,
        data: toArrayBuffer(data),
      });
    }
  }

  /** Remove the value corresponding to `key` */
  async remove(key: StorageKey): Promise<void> {
    console.debug("remove", key);
    const existing = await this.keyQuery(key).unique();
    if (!isDatabaseWriter(this.ctx.db)) {
      throw new Error("Trying to delete from a query!");
    }
    if (existing) {
      return this.ctx.db.delete(existing._id);
    }
  }

  /**
   * Load all values with keys that start with `keyPrefix`.
   *
   * @remarks
   * The `keyprefix` will match any key that starts with the given array. For example:
   * - `[documentId, "incremental"]` will match all incremental saves
   * - `[documentId]` will match all data for a given document.
   *
   * Be careful! `[documentId]` would also match something like `[documentId, "syncState"]`! We
   * aren't using this yet but keep it in mind.)
   */
  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    console.debug("loadRange", keyPrefix);
    const docs = await this.keyQuery(keyPrefix, true).collect();
    return docs.map((doc) => ({
      key: [doc.documentId, doc.type, doc.hash],
      data: new Uint8Array(doc.data),
    }));
  }

  /** Remove all values with keys that start with `keyPrefix` */
  async removeRange(keyPrefix: StorageKey): Promise<void> {
    console.debug("removeRange", keyPrefix);
    const docs = await this.keyQuery(keyPrefix, true).collect();
    if (!isDatabaseWriter(this.ctx.db)) {
      throw new Error("Trying to delete from a query!");
    }
    const db = this.ctx.db;
    await Promise.all(docs.map((doc) => db.delete(doc._id)));
  }
}

function isDatabaseWriter(
  db: DatabaseReader | DatabaseWriter
): db is DatabaseWriter {
  return "insert" in db;
}

export const toArrayBuffer = (bytes: Uint8Array) => {
  const { buffer, byteOffset, byteLength } = bytes;
  return buffer.slice(byteOffset, byteOffset + byteLength);
};
