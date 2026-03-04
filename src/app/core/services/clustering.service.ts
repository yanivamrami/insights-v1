import { Injectable, inject } from '@angular/core';
import { Message } from '../models/message.model';
import { EmbeddingService } from './embedding.service';

export interface Cluster {
    id: number;
    messages: Message[];
    centroidMessage: Message;
    centroidVector: number[];
}

@Injectable({ providedIn: 'root' })
export class ClusteringService {
    private embeddingService = inject(EmbeddingService);

    estimateK(msgCount: number): number {
        return Math.min(8, Math.max(2, Math.round(Math.sqrt(msgCount / 2))));
    }

    kMeans(msgs: Message[], k: number): Cluster[] {
        const withEmb = msgs.filter(m => m.embedding?.length);
        if (withEmb.length < k) k = Math.max(1, withEmb.length);
        if (!withEmb.length) return [];

        const dim = withEmb[0].embedding!.length;

        // k-means++ initialisation: spreads initial centroids across data distribution,
        // preventing cluster collapse on homogeneous corpora (e.g. a single-topic chat).
        const centroids: number[][] = [];
        // Step 1: pick first centroid uniformly at random
        centroids.push([...withEmb[Math.floor(Math.random() * withEmb.length)].embedding!]);
        // Step 2: each subsequent centroid is chosen with probability ∝ squared distance from the nearest existing centroid
        for (let c = 1; c < k; c++) {
            const sqDistances = withEmb.map(m => {
                const bestSim = Math.max(...centroids.map(cent =>
                    this.embeddingService.cosineSimilarity(m.embedding!, cent)
                ));
                const dist = 1 - Math.min(1, bestSim);
                return dist * dist;
            });
            const total = sqDistances.reduce((s, d) => s + d, 0);
            let r = Math.random() * total;
            let chosen = 0;
            for (let i = 0; i < sqDistances.length; i++) {
                r -= sqDistances[i];
                if (r <= 0) { chosen = i; break; }
            }
            centroids.push([...withEmb[chosen].embedding!]);
        }

        let assignments = new Array<number>(withEmb.length).fill(0);
        const MAX_ITER = 25;

        for (let iter = 0; iter < MAX_ITER; iter++) {
            // Assign
            let changed = false;
            for (let i = 0; i < withEmb.length; i++) {
                let bestCluster = 0, bestSim = -Infinity;
                for (let c = 0; c < k; c++) {
                    const sim = this.embeddingService.cosineSimilarity(withEmb[i].embedding!, centroids[c]);
                    if (sim > bestSim) { bestSim = sim; bestCluster = c; }
                }
                if (assignments[i] !== bestCluster) { assignments[i] = bestCluster; changed = true; }
            }
            if (!changed) break;

            // Recompute centroids
            const newCentroids = Array.from({ length: k }, () => new Array<number>(dim).fill(0));
            const counts = new Array<number>(k).fill(0);
            for (let i = 0; i < withEmb.length; i++) {
                const c = assignments[i];
                counts[c]++;
                for (let d = 0; d < dim; d++) newCentroids[c][d] += withEmb[i].embedding![d];
            }
            for (let c = 0; c < k; c++) {
                if (counts[c] > 0) centroids[c] = newCentroids[c].map(v => v / counts[c]);
            }
        }

        // Build cluster objects
        const clusters: Cluster[] = Array.from({ length: k }, (_, i) => ({
            id: i,
            messages: [] as Message[],
            centroidMessage: withEmb[0],
            centroidVector: centroids[i],
        }));

        for (let i = 0; i < withEmb.length; i++) clusters[assignments[i]].messages.push(withEmb[i]);

        // Filter empty clusters, pick centroid message (closest to centroid vector)
        const nonEmpty = clusters.filter(c => c.messages.length > 0);
        for (const c of nonEmpty) {
            let bestSim = -Infinity, bestMsg = c.messages[0];
            for (const m of c.messages) {
                const sim = this.embeddingService.cosineSimilarity(m.embedding!, c.centroidVector);
                if (sim > bestSim) { bestSim = sim; bestMsg = m; }
            }
            c.centroidMessage = bestMsg;
        }

        return nonEmpty.sort((a, b) => b.messages.length - a.messages.length);
    }
}
