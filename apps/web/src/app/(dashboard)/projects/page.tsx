"use client";

// TODO(phase-5): Projects module has no backend routes yet. Expected routes:
//   GET /projects - list projects with filters
//   GET /projects/:id - fetch project detail with tasks + activity
//   GET /projects/:id/tasks - list tasks (kanban board source)
//   POST /projects/:id/tasks - create task
//   PATCH /projects/:id/tasks/:taskId - update task status
// Mock imports left in place until the Projects module ships in apps/api/src/modules/projects.

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { KanbanBoard, KanbanColumn } from "@/components/shared/kanban-board";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FolderKanban, CheckCircle, Clock, Pause, Plus } from "lucide-react";
import { projects, tasks, getUserById, type Task } from "@/data/mock";
import { toast } from "sonner";
import Link from "next/link";

export default function ProjectsPage() {
  const [taskList, setTaskList] = useState(tasks);

  const columns: KanbanColumn<Task>[] = [
    { id: "todo", title: "To Do", color: "#94a3b8", items: taskList.filter((t) => t.status === "todo") },
    { id: "in_progress", title: "In Progress", color: "#f59e0b", items: taskList.filter((t) => t.status === "in_progress") },
    { id: "review", title: "Review", color: "#8b5cf6", items: taskList.filter((t) => t.status === "review") },
    { id: "done", title: "Done", color: "#22c55e", items: taskList.filter((t) => t.status === "done") },
  ];

  function handleMoveTask(taskId: string, _from: string, to: string) {
    setTaskList((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: to as Task["status"] } : t))
    );
    toast.success(`Task moved to ${to.replace("_", " ")}`);
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Projects"
        description="Manage projects and tasks"
        actions={<Button><Plus className="h-4 w-4 mr-2" /> New Project</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard title="Total Projects" value={String(projects.length)} icon={FolderKanban} />
        <KPICard title="Active" value={String(projects.filter((p) => p.status === "active").length)} icon={Clock} change="2 in progress" trend="neutral" />
        <KPICard title="Completed" value={String(projects.filter((p) => p.status === "completed").length)} icon={CheckCircle} />
        <KPICard title="On Hold" value={String(projects.filter((p) => p.status === "on_hold").length)} icon={Pause} />
      </div>

      {/* Project Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {projects.map((project) => {
          const lead = getUserById(project.lead);
          const projectTasks = tasks.filter((t) => t.projectId === project.id);
          const doneTasks = projectTasks.filter((t) => t.status === "done").length;
          return (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base">{project.name}</CardTitle>
                    <StatusBadge status={project.status} />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">{project.description}</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium">{project.progress}%</span>
                    </div>
                    <Progress value={project.progress} className="h-1.5" />
                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                      <span>{doneTasks}/{projectTasks.length} tasks</span>
                      <div className="flex items-center gap-1">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-[8px]">{lead?.avatar}</AvatarFallback>
                        </Avatar>
                        <span>{lead?.name}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Task Board */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Task Board</CardTitle>
        </CardHeader>
        <CardContent>
          <KanbanBoard
            columns={columns}
            getItemId={(t) => t.id}
            onMoveItem={handleMoveTask}
            renderCard={(task) => {
              const assignee = getUserById(task.assignedTo);
              const project = projects.find((p) => p.id === task.projectId);
              return (
                <Card className="shadow-sm">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium leading-tight">{task.title}</p>
                      <StatusBadge status={task.priority} />
                    </div>
                    {project && (
                      <Badge variant="outline" className="text-[10px]">{project.name}</Badge>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{task.dueDate}</span>
                      <Avatar className="h-5 w-5">
                        <AvatarFallback className="text-[8px]">{assignee?.avatar}</AvatarFallback>
                      </Avatar>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {task.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
