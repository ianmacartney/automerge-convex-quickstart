import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";

import { isValidAutomergeUrl, Repo } from "@automerge/automerge-repo";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import "./index.css";
// import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
// import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import {
  // ConvexProvider,
  ConvexReactClient,
} from "convex/react";
import { TaskList } from "../convex/types.ts";
import { ConvexNetworkAdapter } from "./ConvexNetworkAdapter.ts";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
const options = convexUrl
  ? { convex: new ConvexReactClient(convexUrl) }
  : undefined;
const repo = new Repo({
  // network: [new BrowserWebSocketClientAdapter("ws://sync.automerge.org")],
  // network: [new BroadcastChannelNetworkAdapter()],
  // network: [],
  network: [new ConvexNetworkAdapter(options)],
  storage: new IndexedDBStorageAdapter(),
});

const rootDocUrl = `${document.location.hash.substring(1)}`;
let handle;
if (isValidAutomergeUrl(rootDocUrl)) {
  handle = repo.find(rootDocUrl);
} else {
  handle = repo.create<TaskList>({ tasks: [] });
}
const docUrl = (document.location.hash = handle.url);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RepoContext.Provider value={repo}>
      {/* To use Convex for more than automerge sync, set up a ConvexProvider
       <ConvexProvider client={convex}> */}
      <App docUrl={docUrl} />
      {/* </ConvexProvider> */}
    </RepoContext.Provider>
  </React.StrictMode>
);
