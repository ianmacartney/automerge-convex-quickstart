import {
  NetworkAdapter,
  StorageId,
  type Message,
  type PeerId,
  type PeerMetadata,
  // cbor,
} from "@automerge/automerge-repo";
import { api } from "../convex/_generated/api";
// TODO: what's this?
// } from "@automerge/automerge-repo/slim"

import {
  FromClientMessage,
  FromServerMessage,
  JoinMessage,
  ProtocolV1,
} from "@automerge/automerge-repo-network-websocket";
import { ConvexClient } from "convex/browser";
import { ConvexReactClient, Watch } from "convex/react";
export const toArrayBuffer = (bytes: Uint8Array) => {
  const { buffer, byteOffset, byteLength } = bytes;
  return buffer.slice(byteOffset, byteOffset + byteLength);
};

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
  #version: number;
  isReady() {
    return true;
    // return this.#ready;
  }

  whenReady() {
    return Promise.resolve();
    // return this.#readyPromise;
  }

  #forceReady() {
    if (!this.#ready) {
      this.#ready = true;
      this.#readyResolver!();
    }
  }

  constructor(options?: ConvexNetworkAdapterOptions) {
    console.debug("ConvexNetworkAdapter constructor");
    super();
    // TODO: eventually wait for connection?
    this.#client =
      options?.convex ??
      new ConvexReactClient("https://mellow-anaconda-653.convex.cloud");
    this.#version = 0;
  }

  #watch: Watch<number> | undefined;

  connect(peerId: PeerId, peerMetadata?: PeerMetadata) {
    console.debug("ConvexNetworkAdapter connect", peerId, peerMetadata);
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;

    const watch = this.#client.watchQuery(api.automerge.version, {});
    // this.#watch = watch;
    // TODO: do we need to handle unsubscribe?
    watch.onUpdate(() => {
      const version = watch.localQueryResult();
      if (version) {
        this.#sync(version);
      }
    });
    // In case there's already a subscription elsewhere
    const version = watch.localQueryResult();
    if (version) {
      this.#sync(version);
    }
    setTimeout(() => {
      this.#forceReady();
      this.emit("peer-candidate", {
        peerId: "convex" as PeerId,
        peerMetadata: {
          storageId: "convex" as StorageId,
          isEphemeral: true,
        },
      });
    }, 1000);
    // TODO: when do we emit peer-disconnected?
    // this.emit("peer-disconnected", { peerId: senderId });

    // do anything on init?
  }

  #sync(version: number) {
    if (version && version > this.#version) {
      console.debug("sync", version, this.#version);
      this.#client
        .query(api.automerge.pull, {
          after: this.#version,
        })
        .then((results) => {
          if (results.length === 0) {
            throw new Error(
              `No results from pull on version mismatch: ${this.#version} -> ${version}`
            );
          }
          console.debug("pulled", results);
          for (const result of results) {
            if (result.version < this.#version) {
              continue;
            }
            console.debug("message", result.message);
            if (!("data" in result.message)) {
              this.emit("message", result.message);
            } else {
              const data = result.message.data as ArrayBufferLike;
              this.emit("message", {
                ...result.message,
                data: new Uint8Array(data),
              });
            }
          }
          this.#version = results[results.length - 1].version;
        });
    }
  }

  remotePeerId?: PeerId;

  peerCandidate(remotePeerId: PeerId, peerMetadata: PeerMetadata) {
    console.debug(
      "ConvexNetworkAdapter peerCandidate",
      remotePeerId,
      peerMetadata
    );
    if (!this.#client) {
      throw new Error("Client not connected");
    }
    this.#forceReady();
    this.remotePeerId = remotePeerId;
    this.emit("peer-candidate", {
      peerId: remotePeerId,
      peerMetadata,
    });
  }

  send(message: Message) {
    console.debug("send", message);
    // TODO: do we care about this?
    if (!this.#client.connectionState().isWebSocketConnected) {
      return false;
    }
    // TODO: single flight
    if ("data" in message) {
      this.#client.mutation(api.automerge.send, {
        ...message,
        data: message.data
          ? message.data.buffer.slice(
              message.data.byteOffset,
              message.data.byteOffset + message.data.byteLength
            )
          : undefined,
      });
    } else {
      this.#client.mutation(api.automerge.send, message);
    }
  }

  disconnect() {
    console.debug("disconnect");
    return this.#client.close().catch(console.error);
  }
}
