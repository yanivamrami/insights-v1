import { Injectable, inject } from '@angular/core';
import { Message } from '../models/message.model';
import { EmbeddingService } from './embedding.service';

export interface Cluster {
    id: number;
    messages: Message[];
    centroidMessage: Message;
    centroidVector: number[];
}

const N_RUNS = 7;           // multi-run: pick result with lowest SSE
const MIN_CLUSTER_SIZE = 3; // clusters smaller than this are redistributed
const MERGE_THRESHOLD = 0.92; // centroid cosine sim above this → merge
const MAX_ITER = 25;

@Injectable({ providedIn: 'root' })
export class ClusteringService {
    private embeddingService = inject(EmbeddingService);

    /** Fallback heuristic — used when silhouette cannot run (n < 6). */
    estimateK(msgCount: number): number {
        return Math.min(8, Math.max(2, Math.round(Math.sqrt(msgCount / 2))));
    }

    /**
     * Cluster embedded messages.
     * k is selected via silhouette score (n ≥ 6) or √(n/2) heuristic.
     * Runs N_RUNS times, keeps the lowest-SSE result.
     * Tiny clusters (< MIN_CLUSTER_SIZE) are redistributed to nearest neighbours.
     * Near-duplicate clusters (centroid sim ≥ MERGE_THRESHOLD) are merged.
     */
    kMeans(msgs: Message[]): Cluster[] {
        const withEmb = msgs.filter(m => m.embedding?.length);
        if (!withEmb.length) return [];

        if (withEmb.length < 2) {
            return [{ id: 0, messages: withEmb, centroidMessage: withEmb[0], centroidVector: withEmb[0].embedding! }];
        }

        const k = withEmb.length >= 6
            ? this.bestK(withEmb)
            : Math.min(this.estimateK(withEmb.length), withEmb.length);

        // Multi-run: keep the result with the lowest SSE
        let bestClusters: Cluster[] = [];
        let bestSSE = Infinity;
        for (let run = 0; run < N_RUNS; run++) {
            const result = this.runOnce(withEmb, k);
            const sse = this.computeSSE(result);
            if (sse < bestSSE) { bestSSE = sse; bestClusters = result; }
        }

        bestClusters = this.enforceMinClusterSize(bestClusters);
        bestClusters = this.mergeSimilarClusters(bestClusters);
        bestClusters.forEach((c, i) => c.id = i);

        return bestClusters.sort((a, b) => b.messages.length - a.messages.length);
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    /**
     * Select optimal k using mean silhouette score (cosine distance).
     * Tries k = 2 .. min(8, floor(n/2)), returns k with the highest score.
     */
    private bestK(msgs: Message[]): number {
        const maxK = Math.min(8, Math.floor(msgs.length / 2));
        if (maxK < 2) return 2;

        let bestK = 2;
        let bestScore = -Infinity;

        for (let k = 2; k <= maxK; k++) {
            const clusters = this.runOnce(msgs, k);
            const score = this.meanSilhouette(msgs, clusters);
            if (score > bestScore) { bestScore = score; bestK = k; }
        }

        return bestK;
    }

    /** Mean silhouette score using cosine distance across all messages. */
    private meanSilhouette(msgs: Message[], clusters: Cluster[]): number {
        if (clusters.length < 2) return -1;

        const clusterOf = new Map<string, number>();
        clusters.forEach((c, ci) => c.messages.forEach(m => clusterOf.set(m.id, ci)));

        const scores: number[] = [];
        for (const m of msgs) {
            if (!m.embedding) continue;
            const ci = clusterOf.get(m.id);
            if (ci === undefined) continue;

            const myCluster = clusters[ci];
            if (myCluster.messages.length < 2) { scores.push(0); continue; }

            // a(i): mean cosine distance to other messages in same cluster
            const sameOthers = myCluster.messages.filter(o => o.id !== m.id);
            const a = sameOthers.reduce((s, o) =>
                s + this.embeddingService.cosineDistance(m.embedding!, o.embedding!), 0
            ) / sameOthers.length;

            // b(i): min mean cosine distance to any other cluster
            let b = Infinity;
            for (let oi = 0; oi < clusters.length; oi++) {
                if (oi === ci) continue;
                const otherMsgs = clusters[oi].messages;
                const meanDist = otherMsgs.reduce((s, o) =>
                    s + this.embeddingService.cosineDistance(m.embedding!, o.embedding!), 0
                ) / otherMsgs.length;
                if (meanDist < b) b = meanDist;
            }

            scores.push(b === Infinity ? 0 : (b - a) / Math.max(a, b));
        }

        return scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : -1;
    }

    /** Single k-means run with k-means++ initialisation. Returns non-empty clusters. */
    private runOnce(withEmb: Message[], k: number): Cluster[] {
        const actualK = Math.min(k, withEmb.length);
        const dim = withEmb[0].embedding!.length;

        // k-means++: first centroid at random, subsequent with prob ∝ squared cosine distance
        const centroids: number[][] = [];
        centroids.push([...withEmb[Math.floor(Math.random() * withEmb.length)].embedding!]);
        for (let c = 1; c < actualK; c++) {
            const sqDist = withEmb.map(m => {
                const d = Math.min(...centroids.map(cent =>
                    this.embeddingService.cosineDistance(m.embedding!, cent)
                ));
                return d * d;
            });
            const total = sqDist.reduce((s, d) => s + d, 0);
            let r = Math.random() * total;
            let chosen = 0;
            for (let i = 0; i < sqDist.length; i++) { r -= sqDist[i]; if (r <= 0) { chosen = i; break; } }
            centroids.push([...withEmb[chosen].embedding!]);
        }

        const assignments = new Array<number>(withEmb.length).fill(0);
        for (let iter = 0; iter < MAX_ITER; iter++) {
            let changed = false;
            for (let i = 0; i < withEmb.length; i++) {
                let best = 0, bestSim = -Infinity;
                for (let c = 0; c < actualK; c++) {
                    const sim = this.embeddingService.cosineSimilarity(withEmb[i].embedding!, centroids[c]);
                    if (sim > bestSim) { bestSim = sim; best = c; }
                }
                if (assignments[i] !== best) { assignments[i] = best; changed = true; }
            }
            if (!changed) break;

            const newCentroids = Array.from({ length: actualK }, () => new Array<number>(dim).fill(0));
            const counts = new Array<number>(actualK).fill(0);
            for (let i = 0; i < withEmb.length; i++) {
                counts[assignments[i]]++;
                for (let d = 0; d < dim; d++) newCentroids[assignments[i]][d] += withEmb[i].embedding![d];
            }
            for (let c = 0; c < actualK; c++) {
                if (counts[c] > 0) centroids[c] = newCentroids[c].map(v => v / counts[c]);
            }
        }

        const clusters: Cluster[] = Array.from({ length: actualK }, (_, i) => ({
            id: i, messages: [] as Message[], centroidMessage: withEmb[0], centroidVector: centroids[i],
        }));
        for (let i = 0; i < withEmb.length; i++) clusters[assignments[i]].messages.push(withEmb[i]);

        const nonEmpty = clusters.filter(c => c.messages.length > 0);
        for (const c of nonEmpty) c.centroidMessage = this.pickCentroidMessage(c);
        return nonEmpty;
    }

    /** Sum of squared cosine distances from each message to its cluster centroid. */
    private computeSSE(clusters: Cluster[]): number {
        let sse = 0;
        for (const c of clusters) {
            for (const m of c.messages) {
                if (!m.embedding) continue;
                const d = this.embeddingService.cosineDistance(m.embedding, c.centroidVector);
                sse += d * d;
            }
        }
        return sse;
    }

    /**
     * Messages from clusters smaller than MIN_CLUSTER_SIZE are reassigned to the
     * nearest qualifying cluster. Repeats until no tiny clusters remain.
     */
    private enforceMinClusterSize(clusters: Cluster[]): Cluster[] {
        let result = [...clusters];
        let changed = true;

        while (changed) {
            changed = false;
            const keep = result.filter(c => c.messages.length >= MIN_CLUSTER_SIZE);
            const tiny = result.filter(c => c.messages.length < MIN_CLUSTER_SIZE);
            if (!tiny.length || !keep.length) break;

            for (const tc of tiny) {
                for (const m of tc.messages) {
                    if (!m.embedding) continue;
                    let target = keep[0];
                    let bestSim = -Infinity;
                    for (const c of keep) {
                        const sim = this.embeddingService.cosineSimilarity(m.embedding, c.centroidVector);
                        if (sim > bestSim) { bestSim = sim; target = c; }
                    }
                    target.messages.push(m);
                }
                changed = true;
            }

            for (const c of keep) {
                const vecs = c.messages.filter(m => m.embedding).map(m => m.embedding!);
                if (vecs.length) {
                    c.centroidVector = this.recomputeCentroid(vecs);
                    c.centroidMessage = this.pickCentroidMessage(c);
                }
            }
            result = keep;
        }

        return result;
    }

    /**
     * Merge cluster pairs whose centroid cosine similarity ≥ MERGE_THRESHOLD.
     * Smaller cluster folds into the larger one. Repeats until no merges remain.
     */
    private mergeSimilarClusters(clusters: Cluster[]): Cluster[] {
        let result = [...clusters];
        let merged = true;

        while (merged) {
            merged = false;
            outer:
            for (let i = 0; i < result.length; i++) {
                for (let j = i + 1; j < result.length; j++) {
                    const sim = this.embeddingService.cosineSimilarity(
                        result[i].centroidVector, result[j].centroidVector
                    );
                    if (sim >= MERGE_THRESHOLD) {
                        const [larger, smaller] = result[i].messages.length >= result[j].messages.length
                            ? [result[i], result[j]] : [result[j], result[i]];
                        larger.messages.push(...smaller.messages);
                        const vecs = larger.messages.filter(m => m.embedding).map(m => m.embedding!);
                        larger.centroidVector = this.recomputeCentroid(vecs);
                        larger.centroidMessage = this.pickCentroidMessage(larger);
                        result = result.filter(c => c !== smaller);
                        merged = true;
                        break outer;
                    }
                }
            }
        }

        return result;
    }

    private recomputeCentroid(vecs: number[][]): number[] {
        const dim = vecs[0].length;
        const sum = new Array<number>(dim).fill(0);
        for (const v of vecs) for (let i = 0; i < dim; i++) sum[i] += v[i];
        const mean = sum.map(x => x / vecs.length);
        const norm = Math.sqrt(mean.reduce((s, v) => s + v * v, 0));
        return norm === 0 ? mean : mean.map(x => x / norm);
    }

    private pickCentroidMessage(c: Cluster): Message {
        let bestSim = -Infinity, bestMsg = c.messages[0];
        for (const m of c.messages) {
            if (!m.embedding) continue;
            const sim = this.embeddingService.cosineSimilarity(m.embedding, c.centroidVector);
            if (sim > bestSim) { bestSim = sim; bestMsg = m; }
        }
        return bestMsg;
    }
}
