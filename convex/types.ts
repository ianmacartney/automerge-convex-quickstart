export interface Task {
  id: string;
  title: string;
  done: boolean;
}

export interface TaskList {
  tasks: Task[];
}
