"use client";

import { useParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Calendar, User, Target, Clock } from "lucide-react";
import { projects, tasks, getUserById, getActivitiesForEntity, formatDate } from "@/data/mock";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const project = projects.find((p) => p.id === id);

  if (!project) {
    return <div className="p-8 text-center text-muted-foreground">Project not found</div>;
  }

  const projectTasks = tasks.filter((t) => t.projectId === project.id);
  const lead = getUserById(project.lead);
  const projectActivities = getActivitiesForEntity("project", project.id);
  const doneTasks = projectTasks.filter((t) => t.status === "done").length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title={project.name}
        description={project.description}
        actions={<StatusBadge status={project.status} />}
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({projectTasks.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Target className="h-4 w-4" /> Progress
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{project.progress}% complete</span>
                    <span>{doneTasks}/{projectTasks.length} tasks</span>
                  </div>
                  <Progress value={project.progress} className="h-2" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" /> Timeline
                </div>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Start</span><span>{formatDate(project.startDate)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">End</span><span>{formatDate(project.endDate)}</span></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-4 w-4" /> Team
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6"><AvatarFallback className="text-[9px]">{lead?.avatar}</AvatarFallback></Avatar>
                    <span className="text-sm">{lead?.name} <span className="text-muted-foreground">(Lead)</span></span>
                  </div>
                  {project.members.map((mid) => {
                    const m = getUserById(mid);
                    return m ? (
                      <div key={mid} className="flex items-center gap-2">
                        <Avatar className="h-6 w-6"><AvatarFallback className="text-[9px]">{m.avatar}</AvatarFallback></Avatar>
                        <span className="text-sm">{m.name}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <div className="space-y-2">
            {projectTasks.map((task) => {
              const assignee = getUserById(task.assignedTo);
              return (
                <Card key={task.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${task.status === "done" ? "bg-green-500" : task.status === "in_progress" ? "bg-amber-500" : "bg-gray-300"}`} />
                      <div>
                        <p className="text-sm font-medium">{task.title}</p>
                        <p className="text-xs text-muted-foreground">{task.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-wrap gap-1">
                        {task.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                        ))}
                      </div>
                      <StatusBadge status={task.priority} />
                      <StatusBadge status={task.status} />
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDate(task.dueDate)}
                      </div>
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[9px]">{assignee?.avatar}</AvatarFallback>
                      </Avatar>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <ActivityFeed activities={projectActivities} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
