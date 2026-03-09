import { Injectable } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { IAIProvider } from './ai-provider.interface';

@Injectable({ providedIn: 'root' })
export class OpenAIProvider implements IAIProvider {
    private readonly embeddingModel = 'text-embedding-3-small';
    private readonly embeddingUrl = 'https://api.openai.com/v1/embeddings';
    private readonly completionsUrl = 'https://api.openai.com/v1/chat/completions';
    private readonly apiKey = environment.openApiKey;
    private readonly generativeModel = 'gpt-4o-mini';
    private readonly BATCH_SIZE = 100;


    async embedBatch(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        // Split into chunks of BATCH_SIZE and call the API in parallel
        const chunks: string[][] = [];
        for (let i = 0; i < texts.length; i += this.BATCH_SIZE) {
            chunks.push(texts.slice(i, i + this.BATCH_SIZE));
        }

        const chunkResults = await Promise.all(chunks.map(chunk => this.embedChunk(chunk)));

        // Flatten chunks back into a single array preserving original order
        return chunkResults.flat();
    }

    private async embedChunk(texts: string[]): Promise<number[][]> {
        const url = this.embeddingUrl;
        const body = {
            model: this.embeddingModel,
            input: texts,
        };

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`OpenAI embedChunk failed (${resp.status}): ${err}`);
        }

        const data = await resp.json() as { data: Array<{ index: number; embedding: number[] }> };
        return data.data
            .slice()
            .sort((a, b) => a.index - b.index)
            .map(e => e.embedding);
    }

    async complete(prompt: string, systemPrompt?: string): Promise<string> {
        const messages: Array<{ role: string; content: string }> = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const body = {
            model: this.generativeModel,
            messages,
            temperature: 0.3,
            max_tokens: 1024,
        };

        const resp = await fetch(this.completionsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`OpenAI complete failed (${resp.status}): ${err}`);
        }

        const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
        return data.choices[0].message.content;
    }
}
