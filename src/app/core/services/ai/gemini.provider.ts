import { Injectable } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { IAIProvider } from './ai-provider.interface';

@Injectable({ providedIn: 'root' })
export class GeminiProvider implements IAIProvider {
    private readonly apiKey = environment.geminiApiKey;
    private readonly embeddingModel = environment.geminiEmbeddingModel;
    private readonly generativeModel = environment.geminiGenerativeModel;
    private readonly dimensions = environment.embeddingDimensions;
    private readonly taskType = environment.embeddingTaskType;

    async embedBatch(texts: string[]): Promise<number[][]> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.embeddingModel}:batchEmbedContents`;
        const body = {
            requests: texts.map(t => ({
                model: `models/${this.embeddingModel}`,
                content: { parts: [{ text: t }] },
                taskType: 'SEMANTIC_SIMILARITY', //this.taskType,
                outputDimensionality: this.dimensions,
            })),
        };

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`Gemini embedBatch failed (${resp.status}): ${err}`);
        }

        const data = await resp.json();
        return (data.embeddings as Array<{ values: number[] }>).map(e => e.values);
    }

    async complete(prompt: string, systemPrompt?: string): Promise<string> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.generativeModel}:generateContent`;
        const body: Record<string, unknown> = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        };
        if (systemPrompt) {
            body['systemInstruction'] = { parts: [{ text: systemPrompt }] };
        }

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`Gemini complete failed (${resp.status}): ${err}`);
        }

        const data = await resp.json();
        return data.candidates[0].content.parts[0].text as string;
    }
}
