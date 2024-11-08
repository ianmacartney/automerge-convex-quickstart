import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useDocument } from "@automerge/automerge-repo-react-hooks";
import { updateText } from "@automerge/automerge/next";
import "@picocss/pico/css/pico.min.css";
import "./App.css";
import automergeLogo from "/automerge.png";
import convexLogo from "/convex.png";

export interface Task {
  id: string;
  title: string;
  done: boolean;
}

export interface TaskList {
  tasks: Task[];
}

function App({ docUrl }: { docUrl: AutomergeUrl }) {
  const [doc, changeDoc] = useDocument<TaskList>(docUrl);

  function addTask() {
    const id = crypto.randomUUID();
    changeDoc((d) =>
      d.tasks.unshift({
        id,
        title: "",
        done: false,
      })
    );
    // Focus the new input after a short delay to ensure the DOM has updated
    setTimeout(() => {
      (
        document.querySelector(
          `input[data-task-id="${id}"]`
        ) as HTMLInputElement
      )?.focus();
    }, 0);
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

      <button type="button" onClick={addTask}>
        <b>+</b> New task
      </button>

      <div id="task-list">
        {doc &&
          doc.tasks?.map(({ id, title, done }, index) => (
            <div className="task" key={id ?? index}>
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
                data-task-id={id}
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
        <a
          href="https://github.com/ianmacartney/automerge-convex-quickstart"
          className="github-button"
        >
          <svg fill="currentColor" viewBox="0 0 24 24">
            <path
              fillRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              clipRule="evenodd"
            />
          </svg>
          Clone on GitHub
        </a>
      </footer>
    </>
  );
}

export default App;
