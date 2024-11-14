import {
  DocumentId,
  type EphemeralMessage,
  type Message,
  NetworkAdapter,
  type PeerId,
  type PeerMetadata,
  StorageId,
  type SyncMessage,
} from "@automerge/automerge-repo";
import * as A from "@automerge/automerge/next";
import { ConvexReactClient, Watch } from "convex/react";
import { api } from "../convex/_generated/api";
import { mergeArrays } from "@automerge/automerge-repo/helpers/mergeArrays.js";

/**
 *
 * A `NetworkAdapter` which uses [Convex](https://convex.dev/)
 * @module
 *
 */

export type ConvexNetworkAdapterOptions = {
  convex: ConvexReactClient;
};

export class ConvexNetworkAdapter extends NetworkAdapter {
  #client: ConvexReactClient;

  #ready = false;
  #readyResolver?: () => void;
  #readyPromise: Promise<void> = new Promise<void>((resolve) => {
    this.#readyResolver = resolve;
  });
  // Necessary?
  isReady() {
    // return true;
    return this.#ready;
  }

  // Necessary?
  whenReady() {
    // return Promise.resolve();
    return this.#readyPromise;
  }

  #subscriptions: {
    [key: DocumentId]: { watch: Watch<A.Heads>; unsubscribe: () => void };
  } = {};
  #syncState: {
    [key: DocumentId]: ArrayBuffer;
  } = {};

  constructor(options?: ConvexNetworkAdapterOptions) {
    console.debug("ConvexNetworkAdapter constructor");
    super();
    // TODO: eventually wait for connection?

    this.#client =
      options?.convex ??
      new ConvexReactClient("https://mellow-anaconda-653.convex.cloud");
  }

  // Necessary?
  remoteIds?: { peerId: PeerId; storageId: StorageId };
  connect(peerId: PeerId, peerMetadata?: PeerMetadata) {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
    console.debug("ConvexNetworkAdapter connect", peerId, peerMetadata);
    this.peerMetadata = peerMetadata;
    const watch = this.#client.watchQuery(api.automerge.ids, {});
    const localIds = watch.localQueryResult();
    const handleIds = (ids: { peerId: PeerId; storageId: StorageId }) => {
      console.debug("handleIds", ids);
      if (!this.#ready) {
        this.#ready = true;
        this.#readyResolver!();
        this.emit("ready", {
          network: this,
        });
      }
      if (!this.remoteIds || this.remoteIds.peerId !== ids.peerId) {
        if (this.remoteIds) {
          this.emit("peer-disconnected", { peerId: this.remoteIds.peerId });
        }
        this.remoteIds = ids;
        this.emit("peer-candidate", {
          peerId: ids.peerId,
          peerMetadata: { isEphemeral: false, storageId: ids.storageId },
        });
      }
    };
    if (localIds) {
      handleIds(localIds);
    } else {
      const unsubscribe = watch.onUpdate(() => {
        const ids = watch.localQueryResult();
        if (ids) {
          handleIds(ids);
          unsubscribe();
        }
      });
    }
  }

  // Necessary?
  peerCandidate(remotePeerId: PeerId, peerMetadata: PeerMetadata) {
    console.debug(
      "ConvexNetworkAdapter peerCandidate",
      remotePeerId,
      peerMetadata
    );
    if (!this.#client) {
      throw new Error("Client not connected");
    }
    if (!peerMetadata.storageId) {
      throw new Error("Storage ID not set");
    }
    this.remoteIds = {
      peerId: remotePeerId,
      storageId: peerMetadata.storageId,
    };
  }

  #syncing = false;
  send(message: RepoMessage) {
    console.debug("send", message);
    if (!isRepoMessage(message)) {
      throw new Error("Invalid message type");
    }
    if (isRemoteSubscriptionControlMessage(message)) {
      throw new Error("Remote subscription control messages not implemented");
    }
    const remoteIds = this.remoteIds;
    if (!remoteIds) {
      throw new Error("No remote peer ids set up yet");
    }
    const peerId = this.peerId;
    if (!peerId) {
      throw new Error("No peer id set up yet");
    }
    const documentId = message.documentId;
    // Subscribe to the document
    if (!this.#subscriptions[message.documentId]) {
      console.debug("subscribe", documentId);
      const watch = this.#client.watchQuery(api.automerge.heads, {
        documentId,
      });
      const onHeads = (heads: A.Heads | undefined) => {
        if (!heads) {
          console.debug("onHeads empty", documentId);
          return;
        }
        if (!remoteIds) {
          throw new Error("No remote peer ids set up yet");
        }
        if (!this.#syncing) {
          // TODO: handle requests separately
        }
        // TODO: not sure if we need to handle requests separately
        // if (heads.length === 0) {
        //   this.emit("message", {
        //     documentId,
        //     type: "request",
        //     senderId: this.remoteIds.peerId,
        //     targetId: this.peerId,
        //     data: A.encodeSyncMessage({
        //       changes: [],
        //       have: [],
        //       need

        //      }),
        //   } as RequestMessage);
        // } else {
        console.debug("remote-heads-changed", heads);
        this.emit("message", {
          documentId,
          type: "remote-heads-changed",
          senderId: remoteIds.peerId,
          targetId: peerId,
          newHeads: {
            [remoteIds.storageId]: { heads, timestamp: Date.now() },
          },
        } as RemoteHeadsChanged);
      };
      onHeads(watch.localQueryResult());
      const unsubscribe = watch.onUpdate(() =>
        onHeads(watch.localQueryResult())
      );
      this.#subscriptions[message.documentId] = { watch, unsubscribe };
    }
    switch (message.type) {
      case "sync":
      case "request": {
        // TODO: what if we're offline / it fails?
        // TODO: single flight
        const syncMsg = A.decodeSyncMessage(message.data);
        console.debug("syncMsg", syncMsg);
        // const handle = this.repo.find(message.documentId);
        // const theirLatestHeads = this.#subscriptions[message.documentId]?.watch.localQueryResult();
        // const theirLatestHeads = syncMsg
        const sync = async () => {
          if (syncMsg.changes.length > 0) {
            console.debug("submitting changes", syncMsg.changes);
            await this.#client.mutation(api.automerge.submitChange, {
              change: toArrayBuffer(mergeArrays(syncMsg.changes)),
              documentId,
            });
          }
          const state =
            this.#syncState[documentId] ||
            toArrayBuffer(A.encodeSyncState(A.initSyncState()));
          console.debug("syncQuery", A.decodeSyncState(new Uint8Array(state)));
          const msg = await this.#client.query(api.automerge.syncQuery, {
            documentId,
            data: toArrayBuffer(message.data),
            state,
          });
          this.#syncState[documentId] = msg.state;
          if (msg.syncMessage) {
            this.emit("message", {
              documentId,
              type: "sync",
              senderId: remoteIds.peerId,
              targetId: peerId,
              data: new Uint8Array(msg.syncMessage),
            } as SyncMessage);
          }
          // if (syncMsg.need.length > 0) {
          //   const change = await this.#client.query(api.automerge.getChange, {
          //     documentId: message.documentId,
          //     sinceHeads: syncMsg.heads,
          //   });
          //   if (change.change) {
          //     console.debug("changes", change);
          //     this.emit("message", {
          //       type: "sync",
          //       senderId: remoteIds.peerId,
          //       targetId: peerId,
          //       documentId: message.documentId,
          //       data: A.encodeSyncMessage({
          //         changes: [new Uint8Array(change.change)],
          //         heads: change.heads,
          //         // Hoping these are fine to send empty
          //         have: [],
          //         need: [],
          //       }),
          //     } as SyncMessage);
          //   }
          // } else {
          //   const heads =
          //     this.#subscriptions[message.documentId]?.watch.localQueryResult();
          //   console.debug("no changes", heads);
          //   // if (!heads) {
          //   //   throw new Error("No heads found");
          //   // }
          //   // this.emit("message", {
          //   //   type: "sync",
          //   //   senderId: remoteIds.peerId,
          //   //   targetId: peerId,
          //   //   documentId,
          //   //   data: A.encodeSyncMessage({
          //   //     changes: [],
          //   //     heads,
          //   //     have: [],
          //   //     need: [],
          //   //   }),
          //   // } as SyncMessage);
          // }
        };
        sync().catch(console.error);

        // Get deltas from Convex based on old heads
        // Submit changes to Convex
        // Emit a sync message with reply
        break;
      }
      case "remote-heads-changed":
      case "doc-unavailable":
      case "ephemeral":
        console.warn(`sending ${message.type} not implemented`);
        break;
    }
  }

  disconnect() {
    console.debug("disconnect");
    return this.#client
      .close()
      .then(() => {
        this.#ready = false;
        this.#readyPromise = new Promise<void>((resolve) => {
          this.#readyResolver = resolve;
        });
        if (this.remoteIds) {
          this.emit("peer-disconnected", { peerId: this.remoteIds.peerId });
        }
        this.emit("close");
      })
      .catch(console.error);
  }
}

// Included since they aren't exported from @automerge/automerge-repo

/**
 * Sent by a {@link Repo} to indicate that it does not have the document and none of its connected
 * peers do either.
 */
export type DocumentUnavailableMessage = {
  type: "doc-unavailable";
  senderId: PeerId;
  targetId: PeerId;

  /** The document which the peer claims it doesn't have */
  documentId: DocumentId;
};

/**
 * Sent by a {@link Repo} to request a document from a peer.
 *
 * @remarks
 * This is identical to a {@link SyncMessage} except that it is sent by a {@link Repo}
 * as the initial sync message when asking the other peer if it has the document.
 * */
export type RequestMessage = {
  type: "request";
  senderId: PeerId;
  targetId: PeerId;

  /** The automerge sync message */
  data: Uint8Array;

  /** The document ID of the document this message is for */
  documentId: DocumentId;
};

/**
 * Sent by a {@link Repo} to add or remove storage IDs from a remote peer's subscription.
 */
export type RemoteSubscriptionControlMessage = {
  type: "remote-subscription-change";
  senderId: PeerId;
  targetId: PeerId;

  /** The storage IDs to add to the subscription */
  add?: StorageId[];

  /** The storage IDs to remove from the subscription */
  remove?: StorageId[];
};

/**
 * Sent by a {@link Repo} to indicate that the heads of a document have changed on a remote peer.
 */
export type RemoteHeadsChanged = {
  type: "remote-heads-changed";
  senderId: PeerId;
  targetId: PeerId;

  /** The document ID of the document that has changed */
  documentId: DocumentId;

  /** The document's new heads */
  newHeads: { [key: StorageId]: { heads: string[]; timestamp: number } };
};

/** These are message types that a {@link NetworkAdapter} surfaces to a {@link Repo}. */
export type RepoMessage =
  | SyncMessage
  | EphemeralMessage
  | RequestMessage
  | DocumentUnavailableMessage
  | RemoteSubscriptionControlMessage
  | RemoteHeadsChanged;

export const isRepoMessage = (message: Message): message is RepoMessage =>
  isSyncMessage(message) ||
  isEphemeralMessage(message) ||
  isRequestMessage(message) ||
  isDocumentUnavailableMessage(message) ||
  isRemoteSubscriptionControlMessage(message) ||
  isRemoteHeadsChanged(message);

// prettier-ignore
export const isDocumentUnavailableMessage = (msg: Message): msg is DocumentUnavailableMessage =>
  msg.type === "doc-unavailable"

export const isRequestMessage = (msg: Message): msg is RequestMessage =>
  msg.type === "request";

export const isSyncMessage = (msg: Message): msg is SyncMessage =>
  msg.type === "sync";

export const isEphemeralMessage = (msg: Message): msg is EphemeralMessage =>
  msg.type === "ephemeral";

// prettier-ignore
export const isRemoteSubscriptionControlMessage = (msg: Message): msg is RemoteSubscriptionControlMessage =>
  msg.type === "remote-subscription-change"

export const isRemoteHeadsChanged = (msg: Message): msg is RemoteHeadsChanged =>
  msg.type === "remote-heads-changed";

export const toArrayBuffer = (bytes: Uint8Array) => {
  const { buffer, byteOffset, byteLength } = bytes;
  return buffer.slice(byteOffset, byteOffset + byteLength);
};
