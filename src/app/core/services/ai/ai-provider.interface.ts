export interface IAIProvider {
    embedBatch(texts: string[]): Promise<number[][]>;
    complete(prompt: string, systemPrompt?: string): Promise<string>;
}
