import { Injectable } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { IAIProvider } from './ai-provider.interface';

@Injectable({ providedIn: 'root' })
export class OpenAIProvider implements IAIProvider {
    private readonly embeddingModel = ['text-embedding-3-small'];
    private readonly embeddedUrl = 'https://api.openai.com/v1/embeddings';
    private readonly completionsUrl = 'https://api.openai.com/v1/chat/completions';
    private readonly apiKey = environment.openApiKey;
    private readonly selectedEmbeddedModel = this.embeddingModel[0];
    private readonly generativeModel = environment.openAIGenerativeModel;

    async embedBatch(texts: string[]): Promise<number[][]> {
        const url = this.embeddedUrl;
        const body = {
            model: this.selectedEmbeddedModel,
            input: texts,
        };

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`OpenAI embedBatch failed (${resp.status}): ${err}`);
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
