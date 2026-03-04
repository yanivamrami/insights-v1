import { Injectable, inject } from '@angular/core';
import { GeminiProvider } from './gemini.provider';
import { OpenAIProvider } from './openai.provider';

@Injectable({ providedIn: 'root' })
export class AIService {
    // private provider = inject(GeminiProvider);
    private provider = inject(OpenAIProvider);

    embedBatch(texts: string[]): Promise<number[][]> {
        return this.provider.embedBatch(texts);
    }

    complete(prompt: string, systemPrompt?: string): Promise<string> {
        return this.provider.complete(prompt, systemPrompt);
    }
}
