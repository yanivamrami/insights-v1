export type FileSource = 'telegram' | 'whatsapp';
export type Timeframe = 'today' | 'yesterday' | '7days';
export type Audience = 'clevel' | 'analyst';
export type StepStatus = 'pending' | 'active' | 'done' | 'failed';
export type StepType = 'ts' | 'emb' | 'ai';

export interface Message {
    id: string;
    timestamp: Date;
    author: string;
    text: string;
    source: FileSource;
    embedding?: number[];
}
