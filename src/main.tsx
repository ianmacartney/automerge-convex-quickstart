import { isValidAutomergeUrl, Repo } from "@automerge/automerge-repo";
// import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
// import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import {
  // ConvexProvider,
  ConvexReactClient,
} from "convex/react";
import { TaskList } from "../convex/types.ts";
import { sync } from "./sync.ts";

// We fall back to a demo backend here
const convexUrl =
  (import.meta.env.VITE_CONVEX_URL as string) ??
  "https://mellow-anaconda-653.convex.cloud";

const repo = new Repo({
  // network: [new BrowserWebSocketClientAdapter("ws://sync.automerge.org")],
  // network: [new BroadcastChannelNetworkAdapter()],
  // network: [new ConvexNetworkAdapter(options)],
  network: [],
  storage: new IndexedDBStorageAdapter(),
});

const convex = new ConvexReactClient(convexUrl);

sync(repo, convex, { debugDump: true });

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
