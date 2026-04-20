"use client";

import React from "react";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type Step = {
  key: string;
  label: string;
  sublabel?: string;
};

export type WorkflowTimelineProps = {
  steps: Step[];
  currentStep: string;
  completedSteps?: string[];
  blockedStep?: string;
  onStepClick?: (step: Step) => void;
};

export function WorkflowTimeline({
  steps,
  currentStep,
  completedSteps = [],
  blockedStep,
  onStepClick,
}: WorkflowTimelineProps) {
  const isCompleted = (key: string) => completedSteps.includes(key);
  const isCurrent = (key: string) => key === currentStep;
  const isBlocked = (key: string) => key === blockedStep;

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-start min-w-max px-2 py-4">
        {steps.map((step, index) => {
          const completed = isCompleted(step.key);
          const current = isCurrent(step.key);
          const blocked = isBlocked(step.key);
          const isLast = index === steps.length - 1;

          return (
            <div key={step.key} className="flex items-start">
              {/* Step node + label */}
              <div
                className={cn(
                  "flex flex-col items-center gap-1",
                  onStepClick && "cursor-pointer"
                )}
                onClick={() => onStepClick?.(step)}
              >
                {/* Circle */}
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
                    completed &&
                      "bg-green-500 border-green-500 text-white",
                    current && !blocked &&
                      "bg-primary border-primary text-primary-foreground",
                    blocked &&
                      "bg-amber-500 border-amber-500 text-white",
                    !completed && !current && !blocked &&
                      "bg-background border-muted-foreground/30 text-muted-foreground"
                  )}
                >
                  {completed && <Check className="h-4 w-4" />}
                  {blocked && <Lock className="h-3.5 w-3.5" />}
                  {!completed && !blocked && (
                    <span className="text-xs font-semibold">{index + 1}</span>
                  )}
                </div>

                {/* Labels — hidden on mobile */}
                <div className="hidden sm:flex flex-col items-center text-center max-w-[100px]">
                  <span
                    className={cn(
                      "text-xs font-medium leading-tight",
                      completed && "text-green-700",
                      current && !blocked && "text-primary font-semibold",
                      blocked && "text-amber-700",
                      !completed && !current && !blocked && "text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </span>
                  {step.sublabel && (
                    <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                      {step.sublabel}
                    </span>
                  )}
                </div>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div className="mt-4 flex-1 mx-1 min-w-[32px]">
                  <div
                    className={cn(
                      "h-0.5 w-full",
                      completed ? "bg-green-500" : "bg-muted-foreground/20"
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
