import automergeLogo from "/automerge.png";
import "@picocss/pico/css/pico.min.css";
import "./App.css";
import { useDocument } from "@automerge/automerge-repo-react-hooks";
import { updateText } from "@automerge/automerge/next";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { TaskList } from "../convex/types";

function App({ docUrl }: { docUrl: AutomergeUrl }) {
  const [doc, changeDoc] = useDocument<TaskList>(docUrl);

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
        <a href="https://automerge.org" target="_blank">
          <img src={automergeLogo} className="logo" alt="Automerge logo" />
        </a>
        <h1>Automerge + Convex Task List</h1>
      </header>

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
                    // Use Automerge's updateText for efficient multiplayer edits
                    // (as opposed to replacing the whole title on each edit)
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
          Powered by Automerge + Vite + React + TypeScript
        </p>
      </footer>
    </>
  );
}

export default App;
