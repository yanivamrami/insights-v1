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
    /** Actual input tokens measured from real prompts (all gen calls combined) */
    actualGenInTok: number;
    /** Actual output tokens measured from real responses (all gen calls combined) */
    actualGenOutTok: number;
}
