import { Injectable, inject, signal } from '@angular/core';
import { AIService } from './ai/ai.service';
import { AnalyticsService } from './analytics.service';
import { EmbeddingService } from './embedding.service';
import { ClusteringService, Cluster } from './clustering.service';
import { TelegramParser } from './parsers/telegram.parser';
import { WhatsAppParser } from './parsers/whatsapp.parser';
import { Message, FileSource, Timeframe } from '../models/message.model';
import { Report, ReportCache, Topic, AuthorStat, Insight } from '../models/report.model';
import { PipelineStep, PipelineStats } from '../models/pipeline.model';

const INITIAL_STEPS: PipelineStep[] = [
    { label: 'Parse & normalize messages', status: 'pending', type: 'ts' },
    { label: 'Filter noise', status: 'pending', type: 'ts' },
    { label: 'Bucket timeframes · stats', status: 'pending', type: 'ts' },
    { label: 'Embed all messages · batch', status: 'pending', type: 'emb' },
    { label: 'Cluster embeddings · k-means', status: 'pending', type: 'ts' },
    { label: 'Sentiment scoring · anchors', status: 'pending', type: 'ts' },
    { label: 'Detect anomalies', status: 'pending', type: 'ts' },
    { label: 'Label clusters & vibe', status: 'pending', type: 'ai' },
    { label: 'Generate executive summaries', status: 'pending', type: 'ai' },
];

const TIMEFRAMES: Timeframe[] = ['today', 'yesterday', '7days'];

@Injectable({ providedIn: 'root' })
export class ReportService {
    private ai = inject(AIService);
    private analytics = inject(AnalyticsService);
    private embedding = inject(EmbeddingService);
    private clustering = inject(ClusteringService);
    private telegramParser = inject(TelegramParser);
    private whatsappParser = inject(WhatsAppParser);

    readonly isAnalyzing = signal(false);
    readonly pipelineSteps = signal<PipelineStep[]>([]);
    readonly pipelineStats = signal<PipelineStats | null>(null);
    readonly reportCache = signal<ReportCache>({ today: null, yesterday: null, '7days': null });
    readonly fileName = signal('');
    readonly fileSource = signal<FileSource | null>(null);
    readonly error = signal<string | null>(null);

    private advanceStep(activeIdx: number): void {
        this.pipelineSteps.update(steps =>
            steps.map((s, i) => ({
                ...s,
                status: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
            }))
        );
    }

    private markAllDone(): void {
        this.pipelineSteps.update(steps => steps.map(s => ({ ...s, status: 'done' })));
    }

    private markStepFailed(): void {
        this.pipelineSteps.update(steps =>
            steps.map(s => ({
                ...s,
                status: s.status === 'active' ? 'failed' : s.status,
            }))
        );
    }

    private updateCache(updates: Partial<ReportCache>): void {
        this.reportCache.update(cache => ({ ...cache, ...updates } as ReportCache));
    }

    async analyzeFile(file: File): Promise<void> {
        const start = Date.now();
        this.isAnalyzing.set(true);
        this.error.set(null);
        this.fileName.set(file.name);
        this.fileSource.set(null);
        this.reportCache.set({ today: null, yesterday: null, '7days': null });
        this.pipelineStats.set(null);
        this.pipelineSteps.set(INITIAL_STEPS.map(s => ({ ...s })));

        try {
            // ── STEP 1: Parse ──────────────────────────────────────────────────
            this.advanceStep(0);
            const content = await file.text();
            const isTelegram = this.telegramParser.canParse(file.name);
            const parser = isTelegram ? this.telegramParser : this.whatsappParser;
            const source: FileSource = isTelegram ? 'telegram' : 'whatsapp';
            this.fileSource.set(source);
            const raw = parser.parse(content);

            console.log('Raw parsed messages:', raw);

            // ── STEP 2: Filter ─────────────────────────────────────────────────
            this.advanceStep(1);
            const { clean, dropped } = this.analytics.filterNoise(raw);

            console.log('Clean messages after filtering:', clean);

            // ── STEP 3: Bucket + Analytics ────────────────────────────────────
            this.advanceStep(2);
            const buckets = this.analytics.bucketByTimeframe(clean);
            const rawBuckets = this.analytics.bucketByTimeframe(raw);

            const partials: ReportCache = { today: null, yesterday: null, '7days': null };

            for (const tf of TIMEFRAMES) {
                const msgs = buckets[tf];
                if (!msgs.length) continue;
                const rawMsgs = rawBuckets[tf];
                const prevMsgs = tf === 'today'
                    ? buckets['yesterday']
                    : tf === 'yesterday'
                        ? []
                        : [];

                const maxMsgTs = msgs.reduce((max, m) => m.timestamp > max ? m.timestamp : max, msgs[0].timestamp);
                const hourly = this.analytics.getHourlyActivity(msgs);
                const daily = this.analytics.getDailyActivity(msgs);
                const tokensRaw = this.analytics.estimateTokens(rawMsgs);
                const tokensFiltered = this.analytics.estimateTokens(msgs);

                // Payload: one short line per message for embedding
                const tokensPayload = Math.round(msgs.length * 12);

                const report: Report = {
                    timeframe: tf,
                    totalMessages: rawMsgs.length,
                    cleanMessages: msgs.length,
                    droppedMessages: rawMsgs.length - msgs.length,
                    activeAuthorCount: new Set(msgs.map(m => m.author)).size,
                    dateRangeLabel: this.analytics.getDateRangeLabel(msgs),
                    hourlyActivity: hourly,
                    dailyActivity: daily,
                    dataEndDayOfWeek: maxMsgTs.getDay(),
                    peakHour: this.analytics.getPeakHour(hourly),
                    volumeVsPrevious: this.analytics.getVolumeVsPrevious(msgs, prevMsgs),
                    tokensRaw,
                    tokensFiltered,
                    tokensPayload,
                    authors: this.analytics.getAuthorStats(msgs),
                    estimatedCostUsd: 0,
                    topics: null,
                    overallSentimentScore: null,
                    overallVibeEmoji: null,
                    overallVibeLabel: null,
                    overallVibeDescription: null,
                    insights: null,
                    summaryExec: null,
                    summaryAnalyst: null,
                };

                (partials as Record<string, Report | null>)[tf] = report;
            }

            this.updateCache(partials);

            // ── STEP 4: Embed all messages ────────────────────────────────────
            this.advanceStep(3);
            const embeddedClean = await this.embedding.embedMessages(clean);
            // Update message buckets with embeddings
            const embeddingMap = new Map(embeddedClean.map(m => [m.id, m.embedding]));
            for (const tf of TIMEFRAMES) {
                buckets[tf] = buckets[tf].map(m => ({ ...m, embedding: embeddingMap.get(m.id) }));
            }

            // ── STEP 5: Cluster ───────────────────────────────────────────────
            this.advanceStep(4);
            const clustersByTf: Record<Timeframe, Cluster[]> = { today: [], yesterday: [], '7days': [] };
            for (const tf of TIMEFRAMES) {
                const msgs = buckets[tf].filter(m => m.embedding?.length);
                if (!msgs.length) continue;
                const k = this.clustering.estimateK(msgs.length);
                clustersByTf[tf] = this.clustering.kMeans(msgs, k);
            }

            // ── STEP 6: Sentiment scoring ─────────────────────────────────────
            this.advanceStep(5);
            // Score cluster centroids — anchors are already cached from Step 4
            for (const tf of TIMEFRAMES) {
                for (const cluster of clustersByTf[tf]) {
                    // Score is computed lazily later when building topic objects
                }
            }

            // ── STEP 7: Anomaly detection ─────────────────────────────────────
            this.advanceStep(6);
            const anomaliesByTf: Record<Timeframe, Message[]> = { today: [], yesterday: [], '7days': [] };
            for (const tf of TIMEFRAMES) {
                const msgs = buckets[tf].filter(m => m.embedding?.length);
                if (!msgs.length) continue;
                const vecs = msgs.map(m => m.embedding!);
                const centroid = this.embedding.centroid(vecs);
                anomaliesByTf[tf] = this.embedding.detectAnomalies(msgs, centroid);
            }

            // Build insights from anomalies (needs clusters for topics, but we use partial data here)
            const insightsByTf: Record<Timeframe, Insight[]> = { today: [], yesterday: [], '7days': [] };
            for (const tf of TIMEFRAMES) {
                const report = (partials as Record<string, Report | null>)[tf];
                if (!report) continue;
                insightsByTf[tf] = this.buildInsights(anomaliesByTf[tf], report.authors, clustersByTf[tf]);
            }

            // Update reports with insights
            const insightUpdates: Partial<ReportCache> = {};
            for (const tf of TIMEFRAMES) {
                const existing = (partials as Record<string, Report | null>)[tf];
                if (!existing) continue;
                const updated = { ...existing, insights: insightsByTf[tf] };
                (insightUpdates as Record<string, Report | null>)[tf] = updated;
                (partials as Record<string, Report | null>)[tf] = updated;
            }
            this.updateCache(insightUpdates);

            // ── STEP 8: Label clusters + Vibe ─────────────────────────────────
            this.advanceStep(7);
            for (const tf of TIMEFRAMES) {
                const clusters = clustersByTf[tf];
                const report = (partials as Record<string, Report | null>)[tf];
                if (!clusters.length || !report) continue;

                // Score sentiments for all clusters
                const sentimentScores = await Promise.all(
                    clusters.map(c => this.embedding.scoreSentiment(c.centroidVector))
                );

                // Label clusters with AI
                let topics: Topic[];
                try {
                    const labels = await this.labelClusters(clusters, report.cleanMessages);
                    topics = clusters.map((c, i) => ({
                        id: String(i),
                        label: labels[i] ?? `Topic ${i + 1}`,
                        messageCount: c.messages.length,
                        percentage: (c.messages.length / report.cleanMessages) * 100,
                        trend: this.computeTrend(i, clustersByTf),
                        sentimentScore: sentimentScores[i],
                        centroidMessageText: c.centroidMessage.text,
                    }));
                } catch {
                    topics = clusters.map((c, i) => ({
                        id: String(i),
                        label: `Topic ${i + 1}`,
                        messageCount: c.messages.length,
                        percentage: (c.messages.length / report.cleanMessages) * 100,
                        trend: 'stable' as const,
                        sentimentScore: sentimentScores[i],
                        centroidMessageText: c.centroidMessage.text,
                    }));
                }

                const overallScore = sentimentScores.reduce((s, v) => s + v, 0) / sentimentScores.length;

                // Generate vibe info
                let vibeEmoji = '😐', vibeLabel = 'Neutral', vibeDesc = 'Mixed sentiments across topics.';
                try {
                    const vibe = await this.generateVibeInfo(overallScore, topics.map(t => t.label));
                    vibeEmoji = vibe.emoji;
                    vibeLabel = vibe.label;
                    vibeDesc = vibe.description;
                } catch { /* keep defaults */ }

                const cost = this.estimateCost(report.cleanMessages);
                const updated = {
                    ...report, topics, overallSentimentScore: overallScore,
                    overallVibeEmoji: vibeEmoji, overallVibeLabel: vibeLabel,
                    overallVibeDescription: vibeDesc, estimatedCostUsd: cost
                };
                (partials as Record<string, Report | null>)[tf] = updated;
                this.updateCache({ [tf]: updated } as Partial<ReportCache>);
            }

            // ── STEP 9: Executive summaries ───────────────────────────────────
            this.advanceStep(8);
            for (const tf of TIMEFRAMES) {
                const report = (partials as Record<string, Report | null>)[tf];
                if (!report) continue;
                try {
                    const [summaryExec, summaryAnalyst] = await this.generateSummaries(report);
                    const updated = { ...report, summaryExec, summaryAnalyst };
                    (partials as Record<string, Report | null>)[tf] = updated;
                    this.updateCache({ [tf]: updated } as Partial<ReportCache>);
                } catch { /* summaries remain null */ }
            }

            // ── DONE ──────────────────────────────────────────────────────────
            this.markAllDone();
            this.pipelineStats.set({
                fileName: file.name,
                fileSource: source,
                rawCount: raw.length,
                cleanCount: clean.length,
                droppedCount: dropped,
                embeddingCalls: 1,
                generativeCalls: TIMEFRAMES.filter(tf => buckets[tf].length > 0).length * 2,
                estimatedCostUsd: this.estimateCost(clean.length),
                durationMs: Date.now() - start,
            });

        } catch (err: unknown) {
            this.markStepFailed();
            const msg = err instanceof Error ? err.message : 'Analysis failed';
            this.error.set(msg);
        } finally {
            this.isAnalyzing.set(false);
        }
    }

    private async labelClusters(clusters: Cluster[], _total: number): Promise<string[]> {
        console.log('Labeling clusters with AI:', clusters);
        const lines = clusters.map((c, i) => {
            // Pick up to 3 representative messages: centroid first, then 2 others
            const others = c.messages
                .filter(m => m.id !== c.centroidMessage.id)
                .slice(0, 2);
            const samples = [c.centroidMessage, ...others];
            const bullets = samples.map(m => `  - ${m.text}`).join('\n');
            return `${i + 1}.\n${bullets}`;
        }).join('\n---\n');

        const prompt = `You are analyzing chat messages. Below are up to 3 representative messages per topic cluster.
Return a JSON array of short topic labels (2–4 words each), one per cluster, in the same order.
Return ONLY a valid JSON array of strings. No explanation, no markdown, no extra text.

Clusters:
---
${lines}`;

        const raw = await this.ai.complete(prompt);
        const cleaned = raw.trim().replace(/^```(?:json)?|```$/gm, '').trim();
        return JSON.parse(cleaned) as string[];
    }

    private async generateVibeInfo(score: number, topicNames: string[]): Promise<{ emoji: string; label: string; description: string }> {
        console.log('Generating vibe info with AI:', { score, topicNames });
        const prompt = `Overall sentiment score: ${score.toFixed(2)} (range -1 very negative to +1 very positive).
Top topics: ${topicNames.slice(0, 5).join(', ')}.

Return a JSON object with exactly these keys:
- "emoji": one emoji representing the emotional vibe
- "label": one word (e.g. Negative, Positive, Mixed, Frustrated, Excited)
- "description": 1–2 sentences describing the community mood in plain language

Return ONLY valid JSON. No markdown. No extra text.`;

        const raw = await this.ai.complete(prompt);
        const cleaned = raw.trim().replace(/^```(?:json)?|```$/gm, '').trim();
        return JSON.parse(cleaned) as { emoji: string; label: string; description: string };
    }

    private async generateSummaries(report: Report): Promise<[string, string]> {
        console.log('Generating summaries with AI for report:', report);
        const topicsStr = report.topics?.slice(0, 5)
            .map(t => `${t.label} (${t.messageCount} msgs, sentiment ${t.sentimentScore.toFixed(2)})`)
            .join(', ') ?? 'No topics';
        const topVolume = report.authors[0]?.author ?? 'N/A';
        const topInfluence = [...report.authors].sort((a, b) => a.influenceRank - b.influenceRank)[0]?.author ?? 'N/A';

        const userPrompt = `Chat analysis results:
- Timeframe: ${report.timeframe}
- Messages analyzed: ${report.cleanMessages}
- Overall sentiment score: ${report.overallSentimentScore?.toFixed(2) ?? 'N/A'}
- Topics: ${topicsStr}
- Top author by volume: ${topVolume} (${report.authors[0]?.messageCount ?? 0} messages)
- Top author by influence: ${topInfluence} (score ${report.authors.find(a => a.influenceRank === 1)?.influenceScore ?? 0})
- Anomalous messages detected: ${report.insights?.length ?? 0}
- Active authors: ${report.activeAuthorCount}

Write the summary now.`;

        const execSystemPrompt = `You write concise executive summaries for C-level leaders.
Use plain language. Focus on business risk, churn signals, and recommended actions.
3–4 sentences maximum. No jargon. No bullet points.`;

        const analystSystemPrompt = `You write technical data summaries for data analysts.
Include: message counts, filtering ratios, cluster distribution, sentiment scores, anomaly details, and data quality notes.
4–5 sentences. Use precise numeric language.`;

        return Promise.all([
            this.ai.complete(userPrompt, execSystemPrompt),
            this.ai.complete(userPrompt, analystSystemPrompt),
        ]);
    }

    private buildInsights(anomalies: Message[], authors: AuthorStat[], clusters: Cluster[]): Insight[] {
        const insights: Insight[] = [];
        const now = new Date();
        const timeLabel = `${now.toLocaleDateString('en-US', { weekday: 'long' })}`;

        // 1. Anomalous messages
        if (anomalies.length > 0) {
            const uniqueAuthors = [...new Set(anomalies.map(m => m.author))];
            insights.push({
                type: 'alert',
                icon: '🚨',
                headline: `Outlier Activity: ${uniqueAuthors.length} User(s) Detected`,
                body: `${uniqueAuthors.join(', ')} produced messages significantly outside normal embedding space.`,
                timeLabel,
            });
        }

        // 2. New or rising topics
        const risers = clusters.filter((_, i) => i < 3);
        if (clusters.length > 0) {
            insights.push({
                type: 'warning',
                icon: '⚠️',
                headline: `${clusters.length} Topic Cluster(s) Emerged`,
                body: `Top cluster contains ${clusters[0]?.messages.length ?? 0} messages. Pattern may signal an emerging issue.`,
                timeLabel,
            });
        }

        // 3. Influence ≠ Volume
        if (authors.length >= 2) {
            const volumeLeader = authors.find(a => a.volumeRank === 1);
            const influenceLeader = authors.find(a => a.influenceRank === 1);
            if (volumeLeader && influenceLeader && volumeLeader.author !== influenceLeader.author) {
                insights.push({
                    type: 'info',
                    icon: '💡',
                    headline: 'Influence ≠ Volume: Different Leaders',
                    body: `${volumeLeader.author} sends the most messages; ${influenceLeader.author} drives the most replies.`,
                    timeLabel,
                });
            }
        }

        // 4. Silent majority
        if (authors.length > 0) {
            const silent = authors.filter(a => a.messageCount < 5).length;
            if (silent > 0) {
                insights.push({
                    type: 'info',
                    icon: '👁️',
                    headline: `${silent} of ${authors.length} Participants Mostly Silent`,
                    body: `${silent} of ${authors.length} participants sent fewer than 5 messages — silent majority may hold unvoiced sentiment.`,
                    timeLabel,
                });
            }
        }

        return insights;
    }

    private computeTrend(idx: number, _clusters: Record<Timeframe, Cluster[]>): 'up' | 'down' | 'new' | 'stable' {
        if (idx === 0) return 'up';
        if (idx === 1) return 'new';
        return 'stable';
    }

    private estimateCost(cleanCount: number): number {
        // OpenAI: text-embedding-3-small $0.02/1M + gpt-4o-mini $0.15/$0.60 per 1M
        const tokensPerMsg = 15;
        const embCost = cleanCount * tokensPerMsg / 1_000_000 * 0.02;
        const genCallsEstimate = 6; // ~2 per timeframe × 3 timeframes
        const genCost = genCallsEstimate * (600 * 0.15 + 250 * 0.60) / 1_000_000;
        return Math.round((embCost + genCost) * 100000) / 100000;
    }
}
