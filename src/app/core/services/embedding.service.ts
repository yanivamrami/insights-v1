import { Injectable, inject } from '@angular/core';
import { AIService } from './ai/ai.service';
import { Message } from '../models/message.model';

export interface AnchorVectors {
    positive: number[];
    negative: number[];
    neutral: number[];
}

const ANCHOR_SENTENCES = {
    positive: [
        'We hit our milestone, the launch exceeded all projections and the team is thrilled.',
        'Outstanding results today, users are engaged and the metrics look excellent.',
        'Best sprint yet, everything shipped on time and the feedback has been overwhelmingly positive.',
    ],
    negative: [
        'This is completely unacceptable, I am furious and extremely disappointed.',
        'Terrible service, nothing works and nobody cares about fixing it.',
        'I am done with this, absolute disaster and waste of my time.',
    ],
    neutral: [
        'The meeting is scheduled for Tuesday at 3pm.',
        'Please send the document to the group.',
        'Noted, will follow up accordingly.',
    ],
};

@Injectable({ providedIn: 'root' })
export class EmbeddingService {
    private ai = inject(AIService);
    private anchorCache: AnchorVectors | null = null;

    /** Public read-only access to cached anchor vectors. Populated after first embedMessages() or getAnchorEmbeddings() call. */
    get anchors(): AnchorVectors | null { return this.anchorCache; }

    private formatMessage(m: Message): string {
        const hh = String(m.timestamp.getHours()).padStart(2, '0');
        const mm = String(m.timestamp.getMinutes()).padStart(2, '0');
        return `[${hh}:${mm} ${m.author}]: ${m.text}`;
    }

    async embedMessages(msgs: Message[]): Promise<Message[]> {
        if (!msgs.length) return msgs;

        const anchorTexts = [
            ...ANCHOR_SENTENCES.positive,
            ...ANCHOR_SENTENCES.negative,
            ...ANCHOR_SENTENCES.neutral,
        ];
        const msgTexts = msgs.map(m => this.formatMessage(m));
        const allTexts = [...anchorTexts, ...msgTexts];

        const allEmbeddings = await this.ai.embedBatch(allTexts);

        // First 9 are anchors — cache them (guard against overwrite on re-analysis)
        const anchorEmbeddings = allEmbeddings.slice(0, 9);
        if (!this.anchorCache) {
            this.anchorCache = {
                positive: this.centroid(anchorEmbeddings.slice(0, 3)),
                negative: this.centroid(anchorEmbeddings.slice(3, 6)),
                neutral: this.centroid(anchorEmbeddings.slice(6, 9)),
            };
        }

        // Remaining are messages
        const msgEmbeddings = allEmbeddings.slice(9);
        return msgs.map((m, i) => ({ ...m, embedding: msgEmbeddings[i] }));
    }

    async getAnchorEmbeddings(): Promise<AnchorVectors> {
        if (this.anchorCache) return this.anchorCache;

        const allTexts = [
            ...ANCHOR_SENTENCES.positive,
            ...ANCHOR_SENTENCES.negative,
            ...ANCHOR_SENTENCES.neutral,
        ];
        const embeddings = await this.ai.embedBatch(allTexts);
        this.anchorCache = {
            positive: this.centroid(embeddings.slice(0, 3)),
            negative: this.centroid(embeddings.slice(3, 6)),
            neutral: this.centroid(embeddings.slice(6, 9)),
        };
        return this.anchorCache;
    }

    cosineSimilarity(a: number[], b: number[]): number {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }

    centroid(vecs: number[][]): number[] {
        if (!vecs.length) return [];
        const dim = vecs[0].length;
        const result = new Array<number>(dim).fill(0);
        for (const v of vecs) for (let i = 0; i < dim; i++) result[i] += v[i];
        const mean = result.map(x => x / vecs.length);
        // L2-normalise so the centroid is a unit vector (safe for cosine sim; correct for any Euclidean use)
        const norm = Math.sqrt(mean.reduce((s, v) => s + v * v, 0));
        return norm === 0 ? mean : mean.map(x => x / norm);
    }

    async scoreSentiment(embedding: number[]): Promise<number> {
        const anchors = await this.getAnchorEmbeddings();
        const posScore = this.cosineSimilarity(embedding, anchors.positive);
        const negScore = this.cosineSimilarity(embedding, anchors.negative);
        const neutScore = this.cosineSimilarity(embedding, anchors.neutral);
        // Normalise by all three anchors so factual/neutral messages don't compress toward ±0.23
        const total = posScore + negScore + neutScore;
        return total === 0 ? 0 : (posScore - negScore) / total;
    }

    detectAnomalies(msgs: Message[], centroidVec: number[]): Message[] {
        const withEmb = msgs.filter(m => m.embedding);
        if (!withEmb.length) return [];

        // Clamp to ≤ 1 to prevent negative distances from floating-point rounding above 1.0
        const distances = withEmb.map(m => 1 - Math.min(1, this.cosineSimilarity(m.embedding!, centroidVec)));
        const mean = distances.reduce((s, d) => s + d, 0) / distances.length;
        const std = Math.sqrt(distances.reduce((s, d) => s + Math.pow(d - mean, 2), 0) / distances.length);
        const threshold = mean + 2 * std;

        return withEmb.filter((_, i) => distances[i] > threshold);
    }
}
