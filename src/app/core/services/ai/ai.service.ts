import { Injectable, inject } from '@angular/core';
import { GeminiProvider } from './gemini.provider';
import { OpenAIProvider } from './openai.provider';
import { IAIProvider } from './ai-provider.interface';
import { AI_PROVIDER } from '../../../shared/const/const';

@Injectable({ providedIn: 'root' })
export class AIService {
    private geminiProvider = inject(GeminiProvider);
    private openAIProvider = inject(OpenAIProvider);

    embedBatch(texts: string[]): Promise<number[][]> {
        return (this.getProvider()).embedBatch(texts);
    }

    complete(prompt: string, systemPrompt?: string): Promise<string> {
        return (this.getProvider()).complete(prompt, systemPrompt);
    }

    getProvider(): IAIProvider {
        return AI_PROVIDER === 'gemini'
            ? this.geminiProvider
            : this.openAIProvider;
    }
}
