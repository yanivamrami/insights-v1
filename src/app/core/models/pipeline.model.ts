import { FileSource, StepStatus, StepType } from './message.model';

export interface PipelineStep {
    label: string;
    status: StepStatus;
    type: StepType;
}

export interface PipelineStats {
    fileName: string;
    fileSource: FileSource;
    rawCount: number;
    cleanCount: number;
    droppedCount: number;
    embeddingCalls: number;
    generativeCalls: number;
    estimatedCostUsd: number;
    durationMs: number;
}
