/// <reference lib="webworker" />

/**
 * Clustering Web Worker
 * Runs k-means++ with silhouette k-selection off the main thread.
 *
 * Input message:  { msgs: RawMsg[] }
 * Output message: { clusters: RawCluster[] }
 * Error message:  { error: string }
 */

// ── Data shapes ───────────────────────────────────────────────────────────────

interface RawMsg {
    id: string;
    embedding: number[];
    text: string;
    author: string;
    timestamp: number; // ms epoch
}

interface RawCluster {
    centroidVector: number[];
    centroidMessageId: string;
    messageIds: string[];
}

// ── Constants (keep in sync with clustering.service.ts) ───────────────────────

const N_RUNS = 7;
const MIN_CLUSTER_SIZE = 3;
const MERGE_THRESHOLD = 0.92;
const MAX_ITER = 25;

// ── Pure math ─────────────────────────────────────────────────────────────────

function dot(a: number[], b: number[]): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
}

function norm(a: number[]): number {
    return Math.sqrt(dot(a, a));
}

function cosineSimilarity(a: number[], b: number[]): number {
    const n = norm(a) * norm(b);
    return n === 0 ? 0 : dot(a, b) / n;
}

function cosineDistance(a: number[], b: number[]): number {
    return 1 - cosineSimilarity(a, b);
}

function centroid(vecs: number[][]): number[] {
    const dim = vecs[0].length;
    const sum = new Array<number>(dim).fill(0);
    for (const v of vecs) for (let i = 0; i < dim; i++) sum[i] += v[i];
    const mean = sum.map(x => x / vecs.length);
    const n = norm(mean);
    return n === 0 ? mean : mean.map(x => x / n);
}

// ── Best-k via silhouette ─────────────────────────────────────────────────────

function meanSilhouette(msgs: RawMsg[], assignments: number[], k: number): number {
    if (k < 2) return -1;
    const scores: number[] = [];

    for (let i = 0; i < msgs.length; i++) {
        const ci = assignments[i];
        const sameIdxs = msgs.map((_, j) => j).filter(j => assignments[j] === ci && j !== i);
        if (sameIdxs.length === 0) { scores.push(0); continue; }

        const a = sameIdxs.reduce((s, j) =>
            s + cosineDistance(msgs[i].embedding, msgs[j].embedding), 0
        ) / sameIdxs.length;

        let b = Infinity;
        for (let oi = 0; oi < k; oi++) {
            if (oi === ci) continue;
            const otherIdxs = msgs.map((_, j) => j).filter(j => assignments[j] === oi);
            if (!otherIdxs.length) continue;
            const meanDist = otherIdxs.reduce((s, j) =>
                s + cosineDistance(msgs[i].embedding, msgs[j].embedding), 0
            ) / otherIdxs.length;
            if (meanDist < b) b = meanDist;
        }

        scores.push(b === Infinity ? 0 : (b - a) / Math.max(a, b));
    }

    return scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : -1;
}

// ── Single k-means++ run ──────────────────────────────────────────────────────

function runOnce(msgs: RawMsg[], k: number): { assignments: number[]; centroids: number[][] } {
    const actualK = Math.min(k, msgs.length);
    const dim = msgs[0].embedding.length;

    // k-means++ initialisation
    const centroids: number[][] = [];
    centroids.push([...msgs[Math.floor(Math.random() * msgs.length)].embedding]);
    for (let c = 1; c < actualK; c++) {
        const sqDist = msgs.map(m => {
            const d = Math.min(...centroids.map(cent => cosineDistance(m.embedding, cent)));
            return d * d;
        });
        const total = sqDist.reduce((s, d) => s + d, 0);
        let r = Math.random() * total;
        let chosen = 0;
        for (let i = 0; i < sqDist.length; i++) { r -= sqDist[i]; if (r <= 0) { chosen = i; break; } }
        centroids.push([...msgs[chosen].embedding]);
    }

    const assignments = new Array<number>(msgs.length).fill(0);
    for (let iter = 0; iter < MAX_ITER; iter++) {
        let changed = false;
        for (let i = 0; i < msgs.length; i++) {
            let best = 0, bestSim = -Infinity;
            for (let c = 0; c < actualK; c++) {
                const sim = cosineSimilarity(msgs[i].embedding, centroids[c]);
                if (sim > bestSim) { bestSim = sim; best = c; }
            }
            if (assignments[i] !== best) { assignments[i] = best; changed = true; }
        }
        if (!changed) break;

        const newCentroids = Array.from({ length: actualK }, () => new Array<number>(dim).fill(0));
        const counts = new Array<number>(actualK).fill(0);
        for (let i = 0; i < msgs.length; i++) {
            counts[assignments[i]]++;
            for (let d = 0; d < dim; d++) newCentroids[assignments[i]][d] += msgs[i].embedding[d];
        }
        for (let c = 0; c < actualK; c++) {
            if (counts[c] > 0) centroids[c] = newCentroids[c].map(v => v / counts[c]);
        }
    }

    return { assignments, centroids };
}

function computeSSE(msgs: RawMsg[], assignments: number[], centroids: number[][]): number {
    let sse = 0;
    for (let i = 0; i < msgs.length; i++) {
        const d = cosineDistance(msgs[i].embedding, centroids[assignments[i]]);
        sse += d * d;
    }
    return sse;
}

// ── Pick centroid message ─────────────────────────────────────────────────────

function pickCentroidId(ids: string[], embs: number[][], centVec: number[]): string {
    let bestSim = -Infinity, bestId = ids[0];
    for (let i = 0; i < ids.length; i++) {
        const sim = cosineSimilarity(embs[i], centVec);
        if (sim > bestSim) { bestSim = sim; bestId = ids[i]; }
    }
    return bestId;
}

// ── Full clustering pipeline ──────────────────────────────────────────────────

function cluster(msgs: RawMsg[]): RawCluster[] {
    const withEmb = msgs.filter(m => m.embedding?.length > 0);
    if (!withEmb.length) return [];
    if (withEmb.length < 2) {
        return [{
            centroidVector: withEmb[0].embedding,
            centroidMessageId: withEmb[0].id,
            messageIds: [withEmb[0].id],
        }];
    }

    // Choose best k
    const maxK = Math.min(8, Math.floor(withEmb.length / 2));
    let k = 2;
    if (withEmb.length >= 6 && maxK >= 2) {
        let bestScore = -Infinity;
        for (let candidate = 2; candidate <= maxK; candidate++) {
            const { assignments } = runOnce(withEmb, candidate);
            const score = meanSilhouette(withEmb, assignments, candidate);
            if (score > bestScore) { bestScore = score; k = candidate; }
        }
    } else {
        k = Math.min(Math.round(Math.sqrt(withEmb.length / 2)), withEmb.length);
        k = Math.max(2, k);
    }

    // Multi-run: keep lowest SSE
    let bestAssignments: number[] = [];
    let bestCentroids: number[][] = [];
    let bestSSE = Infinity;
    for (let run = 0; run < N_RUNS; run++) {
        const { assignments, centroids } = runOnce(withEmb, k);
        const sse = computeSSE(withEmb, assignments, centroids);
        if (sse < bestSSE) { bestSSE = sse; bestAssignments = assignments; bestCentroids = centroids; }
    }

    // Build cluster groups
    type Group = { msgs: RawMsg[]; centroid: number[] };
    const groups: Group[] = bestCentroids.map(c => ({ msgs: [], centroid: c }));
    for (let i = 0; i < withEmb.length; i++) groups[bestAssignments[i]].msgs.push(withEmb[i]);
    const nonEmpty = groups.filter(g => g.msgs.length > 0);
    for (const g of nonEmpty) {
        const vecs = g.msgs.map(m => m.embedding);
        g.centroid = centroid(vecs);
    }

    // Enforce min cluster size
    let result = [...nonEmpty];
    let changed = true;
    while (changed) {
        changed = false;
        const keep = result.filter(g => g.msgs.length >= MIN_CLUSTER_SIZE);
        const tiny = result.filter(g => g.msgs.length < MIN_CLUSTER_SIZE);
        if (!tiny.length || !keep.length) break;

        for (const tc of tiny) {
            for (const m of tc.msgs) {
                let target = keep[0], bestSim = -Infinity;
                for (const g of keep) {
                    const sim = cosineSimilarity(m.embedding, g.centroid);
                    if (sim > bestSim) { bestSim = sim; target = g; }
                }
                target.msgs.push(m);
            }
            changed = true;
        }
        for (const g of keep) {
            g.centroid = centroid(g.msgs.map(m => m.embedding));
        }
        result = keep;
    }

    // Merge similar clusters
    let merged = true;
    while (merged) {
        merged = false;
        outer:
        for (let i = 0; i < result.length; i++) {
            for (let j = i + 1; j < result.length; j++) {
                const sim = cosineSimilarity(result[i].centroid, result[j].centroid);
                if (sim >= MERGE_THRESHOLD) {
                    const [larger, smaller] = result[i].msgs.length >= result[j].msgs.length
                        ? [result[i], result[j]] : [result[j], result[i]];
                    larger.msgs.push(...smaller.msgs);
                    larger.centroid = centroid(larger.msgs.map(m => m.embedding));
                    result = result.filter(g => g !== smaller);
                    merged = true;
                    break outer;
                }
            }
        }
    }

    // Serialise to RawCluster
    return result
        .sort((a, b) => b.msgs.length - a.msgs.length)
        .map(g => ({
            centroidVector: g.centroid,
            centroidMessageId: pickCentroidId(
                g.msgs.map(m => m.id),
                g.msgs.map(m => m.embedding),
                g.centroid
            ),
            messageIds: g.msgs.map(m => m.id),
        }));
}

// ── Worker message handler ────────────────────────────────────────────────────

addEventListener('message', ({ data }: MessageEvent<{ msgs: RawMsg[] }>) => {
    try {
        const clusters = cluster(data.msgs);
        postMessage({ clusters });
    } catch (e) {
        postMessage({ error: e instanceof Error ? e.message : String(e) });
    }
});
