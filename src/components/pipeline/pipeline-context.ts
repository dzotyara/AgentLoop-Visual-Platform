import { createContext, useContext } from "react";
import type { PrPatrolPipeline, PrPatrolPipelineDefaults, PrPatrolStepKind, PrPatrolStepSettings } from "../../api";

/** Settings shared by every node: the editable draft, its env defaults and the Claude model list. */
export type PipelineEditor = {
  draft: PrPatrolPipeline | null;
  defaults: PrPatrolPipelineDefaults | null;
  models: string[];
  setStep: (step: PrPatrolStepKind, patch: Partial<PrPatrolStepSettings>) => void;
  onOpenRun: (taskId: string) => void;
};

export const PipelineEditorContext = createContext<PipelineEditor>({
  draft: null,
  defaults: null,
  models: [],
  setStep: () => {},
  onOpenRun: () => {},
});

export const usePipelineEditor = () => useContext(PipelineEditorContext);
