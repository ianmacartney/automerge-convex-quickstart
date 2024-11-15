import automergeLogo from "/automerge.png";
import convexLogo from "/convex.png";
import "@picocss/pico/css/pico.min.css";
import "./App.css";
import { useDocument } from "@automerge/automerge-repo-react-hooks";
import { updateText } from "@automerge/automerge/next";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { TaskList } from "../convex/types";

function App({ docUrl }: { docUrl: AutomergeUrl }) {
  const [doc, changeDoc] = useDocument<TaskList & { text: string }>(docUrl);

  function addTask() {
    changeDoc((d) =>
      d.tasks.unshift({
        title: "",
        done: false,
      })
    );
  }
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
        placeholder="Task list description goes here"
        onChange={(e) =>
          // Use Automerge's updateText for efficient multiplayer edits
          // (as opposed to replacing the whole title on each edit)
          changeDoc((d) => updateText(d, ["text"], e.target.value))
        }
      />

      <button type="button" onClick={addTask}>
        <b>+</b> New task
      </button>

      <div id="task-list">
        {doc &&
          doc.tasks?.map(({ title, done }, index) => (
            <div className="task" key={index}>
              <input
                type="checkbox"
                checked={done}
                onChange={() =>
                  changeDoc((d) => {
                    d.tasks[index].done = !d.tasks[index].done;
                  })
                }
              />

              <input
                type="text"
                placeholder="What needs doing?"
                value={title || ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    addTask();
                  }
                }}
                onChange={(e) =>
                  changeDoc((d) => {
                    updateText(d.tasks[index], ["title"], e.target.value);
                  })
                }
                style={done ? { textDecoration: "line-through" } : {}}
              />
            </div>
          ))}
      </div>

      <footer>
        <p className="read-the-docs">
          Powered by Automerge + Convex + Vite + React + TypeScript
        </p>
      </footer>
    </>
  );
}

export default App;
