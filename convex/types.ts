export interface Task {
  title: string;
  done: boolean;
}

export interface TaskList {
  tasks: Task[];
}
