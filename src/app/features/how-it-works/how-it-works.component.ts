import { Component, OnInit, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReportService } from '../../core/services/report.service';

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
            desc: 'Groups messages into Today, Yesterday, and 7-Day windows. Computes per-author stats.',
            detail: 'Generates hourly buckets (0–23) for today/yesterday; daily buckets for 7-day view.',
        },
        {
            title: '4. Embed Messages',
            layer: 'emb',
            desc: 'Sends all message texts + 9 anchor sentences to Gemini Embedding API in a single batch.',
            detail: 'Model: gemini-embedding-001 · Task: CLUSTERING · 768 dimensions. Anchors cached per session.',
        },
        {
            title: '5. k-Means Clustering',
            layer: 'ts',
            desc: 'Groups messages by semantic similarity. k is estimated as √(n/2), capped at 8.',
            detail: 'Cosine-similarity assignment, up to 25 iterations. Centroid = message closest to mean vector.',
        },
        {
            title: '6. Sentiment Scoring',
            layer: 'ts',
            desc: 'Scores each message against positive, negative and neutral anchor embeddings via cosine similarity.',
            detail: 'Score = cos(msg, pos_centroid) − cos(msg, neg_centroid). Range: [−1, +1].',
        },
        {
            title: '7. Anomaly Detection',
            layer: 'ts',
            desc: 'Flags hourly buckets where message volume exceeds mean + 2× standard deviation.',
            detail: 'Pure statistics — no AI needed. Generates Insight cards with metric annotations.',
        },
        {
            title: '8. Label Clusters & Vibe',
            layer: 'ai',
            desc: 'Sends top-5 representative messages per cluster to Gemini Flash for a 1–3 word topic label.',
            detail: 'One API call per cluster. Also calls Gemini for an overall vibe/mood description.',
        },
        {
            title: '9. Executive Summaries',
            layer: 'ai',
            desc: 'Generates two summaries from full analytics context: one for C-Level, one for Analysts.',
            detail: 'C-Level: plain prose ≤120 words. Analyst: technical, metric-rich, ≤200 words.',
        },
    ];

    readonly summaryTable = [
        { label: 'Embedding model', value: 'gemini-embedding-001 (768-dim)' },
        { label: 'Generative model', value: 'gemini-1.5-flash' },
        { label: 'Clustering algorithm', value: 'k-Means (cosine similarity)' },
        { label: 'Sentiment method', value: 'Anchor-vector projection' },
        { label: 'Anomaly detection', value: 'Mean + 2σ threshold' },
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
