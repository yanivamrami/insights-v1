import { Component, OnInit, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReportService } from '../../core/services/report.service';
import { AI_PROVIDER } from '../../shared/const/const';

interface TimelineDot {
    active: boolean;
    mb: number;
}

interface PipelineStage {
    title: string;
    desc: string;
    layer: 'ts' | 'emb' | 'ai';
    detail: string;
}

// Resolve model names once at module load from the compile-time AI_PROVIDER constant
const EMBED_MODEL = AI_PROVIDER === 'gemini'
    ? 'gemini-embedding-001 · 768 dimensions · Task: SEMANTIC_SIMILARITY'
    : 'text-embedding-3-small · 1536 dimensions';

const GEN_MODEL = AI_PROVIDER === 'gemini' ? 'gemini-2.5-flash-lite' : 'gpt-4o-mini';

const EMBED_MODEL_SHORT = AI_PROVIDER === 'gemini' ? 'gemini-embedding-001 (768-dim)' : 'text-embedding-3-small (1536-dim)';

@Component({
    selector: 'app-how-it-works',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './how-it-works.component.html',
    styleUrl: './how-it-works.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HowItWorksComponent implements OnInit {
    reportService = inject(ReportService);

    timelineDots: TimelineDot[] = [];

    readonly stages: PipelineStage[] = [
        {
            title: '1. Parse & Normalize',
            layer: 'ts',
            desc: 'Regex-based parsers for WhatsApp TXT and Telegram JSON. Normalizes dates, strips system messages.',
            detail: 'Pure TypeScript — zero network calls. Handles 12h/24h time, bracket and dash formats.',
        },
        {
            title: '2. Filter Noise',
            layer: 'ts',
            desc: 'Removes media placeholders, link-only messages, and messages shorter than 3 words.',
            detail: 'Rule-based filter using NOISE_PATTERNS regex array. Keeps semantic content only.',
        },
        {
            title: '3. Bucket Timeframes',
            layer: 'ts',
            desc: 'Groups messages into Today, Yesterday, and 7-Day windows. Computes per-author stats including message count and influence score.',
            detail: 'Influence score: counts how many times an author\'s message triggers a reply from a different person within the next 3 messages and a 5-minute window.',
        },
        {
            title: '4. Embed Messages',
            layer: 'emb',
            desc: `Sends all message texts plus 9 anchor sentences to the ${AI_PROVIDER === 'gemini' ? 'Gemini' : 'OpenAI'} Embedding API in a single batched call.`,
            detail: `Model: ${EMBED_MODEL}. The 9 anchors are 3 positive + 3 negative + 3 neutral pre-defined sentences embedded alongside messages. This means their vectors are available immediately for sentiment scoring (Step 6) with no extra API call — the anchor centroids are cached for the entire session.`,
        },
        {
            title: '5. k-Means Clustering',
            layer: 'ts',
            desc: 'Groups messages by semantic similarity into topic clusters. k is estimated as √(n/2), capped at 8 to prevent over-fragmentation on typical chat datasets.',
            detail: 'Uses k-means++ initialisation: instead of random seeds, the first centroid is chosen at random and each subsequent one is picked with probability proportional to its squared distance from the nearest existing centroid — ensuring spread-out starting points and faster, more stable convergence. Assignment uses cosine similarity; up to 25 iterations. Centroid = the message whose embedding is closest to the cluster mean vector.',
        },
        {
            title: '6. Sentiment Scoring',
            layer: 'ts',
            desc: 'Each topic cluster\'s centroid embedding is compared against the three anchor centroids (positive, negative, neutral) using cosine similarity.',
            detail: 'Normalised formula: score = (pos − neg) / (pos + neg + neut). Dividing by all three anchors prevents neutral/factual messages from artificially compressing scores toward zero. Range: −1.0 (extremely negative) to +1.0 (extremely positive). The overall score is the weighted average across all clusters by message count.',
        },
        {
            title: '7. Anomaly Detection',
            layer: 'ts',
            desc: 'Computes the conversation centroid (mean of all message embeddings) and flags messages that are semantically dissimilar from the rest.',
            detail: 'For each message, cosine distance from the centroid is computed as 1 − cosine_similarity. The mean and standard deviation of all distances are calculated. Any message whose distance exceeds mean + 2σ is flagged as a semantic outlier — it is semantically unlike the majority of the conversation.',
        },
        {
            title: '8. Label Clusters & Vibe',
            layer: 'ai',
            desc: `Sends up to 3 representative messages per cluster to ${GEN_MODEL} for a 2–4 word topic label. Also generates an overall vibe/mood emoji, label and description.`,
            detail: `One batched prompt per labelling call. The centroid message plus 2 others are chosen as representatives. Vibe is derived from the numeric sentiment score and top topic names — no raw messages are sent for the vibe call.`,
        },
        {
            title: '9. Executive Summaries',
            layer: 'ai',
            desc: `Generates two summaries in parallel using ${GEN_MODEL}: one for C-Level executives, one for Analysts. Only structured report data is sent — no raw messages.`,
            detail: 'C-Level: 3–4 sentences, plain language, focused on business risk, churn signals, and recommended actions. Analyst: 4–5 sentences, precise numeric language covering message counts, filtering ratios, cluster distribution, sentiment scores, and data quality notes.',
        },
    ];

    readonly summaryTable = [
        { label: 'AI provider', value: AI_PROVIDER === 'gemini' ? 'Google Gemini' : 'OpenAI' },
        { label: 'Embedding model', value: EMBED_MODEL_SHORT },
        { label: 'Generative model', value: GEN_MODEL },
        { label: 'Clustering algorithm', value: 'k-Means++ (cosine similarity, cap k=8)' },
        { label: 'Sentiment method', value: 'Normalised anchor-vector projection' },
        { label: 'Anomaly detection', value: 'Cosine distance · mean + 2σ threshold' },
        { label: 'Data storage', value: 'Zero — 100% client-side' },
    ];

    ngOnInit(): void {
        const pattern = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        this.timelineDots = pattern.map(active => ({
            active: active === 1,
            mb: Math.floor(Math.random() * 17),
        }));
    }
}
