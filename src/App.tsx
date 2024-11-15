import automergeLogo from "/automerge.png";
import convexLogo from "/convex.png";
import "@picocss/pico/css/pico.min.css";
import "./App.css";
import { useDocument } from "@automerge/automerge-repo-react-hooks";
import { updateText } from "@automerge/automerge/next";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { TaskList } from "../convex/types";

function App({ docUrl }: { docUrl: AutomergeUrl }) {
  const [doc, changeDoc] = useDocument<{ text: string }>(docUrl);

  return (
    <>
      <header>
        <div className="logos">
          <a href="https://automerge.org" target="_blank">
            <img src={automergeLogo} className="logo" alt="Automerge logo" />
          </a>
          ➕
          <a href="https://convex.dev" target="_blank">
            <img src={convexLogo} className="logo" alt="Convex logo" />
          </a>
        </div>
        <h1>Task List</h1>
      </header>

      <textarea
        value={doc?.text ?? ""}
        disabled={!doc}
        onChange={(e) =>
          changeDoc((d) => updateText(d, ["text"], e.target.value))
        }
      />

      <footer>
        <p className="read-the-docs">
          Powered by Automerge + Convex + Vite + React + TypeScript
        </p>
      </footer>
    </>
  );
}

export default App;
