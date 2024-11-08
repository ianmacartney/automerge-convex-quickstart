import React from "react";
import ReactDOM from "react-dom/client";
import App, { type TaskList } from "./App.tsx";

import "./index.css";
import { isValidAutomergeUrl, Repo } from "@automerge/automerge-repo";
// import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
// import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { RepoContext } from "@automerge/automerge-repo-react-hooks";
// import { ConvexNetworkAdapter } from "./ConvexNetworkAdapter.ts";

const repo = new Repo({
  // network: [new BrowserWebSocketClientAdapter("ws://sync.automerge.org")],
  // network: [new ConvexNetworkAdapter()],
  // network: [new BroadcastChannelNetworkAdapter()],
  network: [],
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
      <App docUrl={docUrl} />
    </RepoContext.Provider>
  </React.StrictMode>
);
