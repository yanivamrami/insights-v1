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
                        trend: this.computeTrend(c, tf, clustersByTf),
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

                // Re-run insights now that topic labels are available
                const labeledInsights = this.buildInsights(
                    anomaliesByTf[tf],
                    report.authors,
                    clustersByTf[tf],
                    topics.map(t => t.label)
                );

                const updated = {
                    ...report, topics, overallSentimentScore: overallScore,
                    overallVibeEmoji: vibeEmoji, overallVibeLabel: vibeLabel,
                    overallVibeDescription: vibeDesc, estimatedCostUsd: cost,
                    insights: labeledInsights,
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
(scale: -1.0 = extremely negative, 0.0 = neutral, +1.0 = extremely positive)
- Sentiment vibe: ${report.overallVibeLabel} — "${report.overallVibeDescription}"
- Topics: ${report.topics?.map(t =>
            `${t.label} (${t.messageCount} msgs, sentiment ${t.sentimentScore.toFixed(2)})`
        ).join(', ')}
- Top author by volume: ${report.authors[0]?.author} (${report.authors[0]?.messageCount} messages)
- Top author by influence: ${report.authors.find(a => a.influenceRank === 1)?.author}
- Anomalous messages detected: ${report.insights?.filter(i => i.type === 'alert').length ?? 0}
- Active authors: ${report.activeAuthorCount}

Write the summary now.`;

        //         const execSystemPrompt = `You are a senior business intelligence analyst briefing a C-level executive.
        // Your job is to tell them what is happening, why it matters to the business, and what to do about it — in that order.
        // Always reflect the actual data. If things are going well, say so clearly. If there is risk, name it directly.
        // Never bury the headline. Lead with the single most important takeaway.
        // Sentiment scores range from -1.0 (extremely negative) to +1.0 (extremely positive). 0.0 is neutral. Positive scores indicate positive sentiment.
        // Write in plain English. No jargon, no bullet points, no hedging language like "it appears" or "it seems".
        // Maximum 4 sentences. Every sentence must earn its place.`;

        const execSystemPrompt = `You are a senior business intelligence analyst briefing a C-level executive.
Your job is to tell them what is happening, why it matters to the business, and what to do about it — in that order.
Always reflect the actual data. If things are going well, say so clearly. If there is risk, name it directly.
Never bury the headline. Lead with the single most important takeaway.
Sentiment scores range from -1.0 (extremely negative) to +1.0 (extremely positive). 0.0 is neutral. Positive scores indicate positive sentiment, negative scores indicate negative sentiment.
Write in plain English. No jargon, no bullet points, no hedging language like "it appears" or "it seems".
Maximum 4 sentences. Every sentence must earn its place.`;

        //         const analystSystemPrompt = `You are a data engineer writing a technical audit summary for a fellow analyst.
        // Your job is to report exactly what the pipeline produced — counts, ratios, scores, distributions — so the analyst can verify and reproduce the results.
        // Structure your response in this order: (1) ingestion and filtering stats, (2) cluster distribution, (3) sentiment score with methodology note, (4) anomaly details, (5) any data quality flags worth investigating.
        // Sentiment scores use a -1.0 to +1.0 scale computed via cosine similarity against embedded anchor vectors. Report the raw score, do not interpret it qualitatively.
        // Only include values that are present in the input. If a field is missing, skip it entirely — do not estimate or infer.
        // Use precise numeric language throughout. 4–6 sentences maximum.`;

        const analystSystemPrompt = `You are a data engineer writing a technical audit summary for a fellow analyst.
Your job is to report exactly what the pipeline produced — counts, ratios, scores, distributions — so the analyst can verify and reproduce the results.
Structure your response in this order: (1) ingestion and filtering stats, (2) cluster distribution, (3) sentiment score with methodology note, (4) anomaly details, (5) any data quality flags worth investigating.
Sentiment scores use a -1.0 to +1.0 scale computed via cosine similarity against embedded anchor vectors. Report the raw score, do not interpret it qualitatively.
Only include values that are present in the input. If a field is missing, skip it entirely — do not estimate or infer.
Use precise numeric language throughout. 4–6 sentences maximum.`;

        return Promise.all([
            this.ai.complete(userPrompt, execSystemPrompt),
            this.ai.complete(userPrompt, analystSystemPrompt),
        ]);
    }

    private buildInsights(anomalies: Message[], authors: AuthorStat[], clusters: Cluster[], topicLabels: string[] = []): Insight[] {
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

        // 2. Dominant cluster concentration — only flag if top cluster holds > 50% of messages
        const totalMsgs = clusters.reduce((sum, c) => sum + c.messages.length, 0);
        const topClusterShare = totalMsgs > 0 ? (clusters[0]?.messages.length ?? 0) / totalMsgs : 0;
        if (clusters.length > 0 && topClusterShare > 0.5) {
            insights.push({
                type: 'warning',
                icon: '⚠️',
                headline: 'Dominant Topic: Conversation Is Highly Concentrated',
                body: `${Math.round(topClusterShare * 100)}% of messages belong to a single topic cluster${topicLabels[0] ? ` ("${topicLabels[0]}")` : ''} (${clusters[0]?.messages.length ?? 0} of ${totalMsgs} messages). Low topic diversity may indicate a focused issue.`,
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

    private computeTrend(
        currentCluster: Cluster,
        currentTf: Timeframe,
        allClusters: Record<Timeframe, Cluster[]>
    ): 'up' | 'down' | 'new' | 'stable' {
        const prevTf: Timeframe | null = currentTf === 'today' ? 'yesterday' : currentTf === 'yesterday' ? '7days' : null;
        if (!prevTf) return 'stable';

        const prevClusters = allClusters[prevTf];
        if (!prevClusters.length) return 'new';

        // Find most similar cluster in previous timeframe by centroid cosine similarity
        let bestSim = -Infinity;
        let bestPrevCluster: Cluster | null = null;
        for (const pc of prevClusters) {
            const sim = this.embedding.cosineSimilarity(currentCluster.centroidVector, pc.centroidVector);
            if (sim > bestSim) { bestSim = sim; bestPrevCluster = pc; }
        }

        // Below threshold → topic didn't exist before
        if (bestSim < 0.75 || !bestPrevCluster) return 'new';

        const delta = currentCluster.messages.length - bestPrevCluster.messages.length;
        if (delta > 2) return 'up';
        if (delta < -2) return 'down';
        return 'stable';
    }

    private estimateCost(cleanCount: number): number {
        // Gemini: gemini-embedding-001 $0.025/1M tokens
        // gemini-2.5-flash-lite: $0.075 input / $0.30 output per 1M tokens
        const tokensPerMsg = 15;
        const embCost = cleanCount * tokensPerMsg / 1_000_000 * 0.025;
        const genCallsEstimate = 6; // ~2 per timeframe × 3 timeframes (label + vibe + summaries)
        const avgInputTokens = 600;
        const avgOutputTokens = 250;
        const genCost = genCallsEstimate * (avgInputTokens * 0.075 + avgOutputTokens * 0.30) / 1_000_000;
        return Math.round((embCost + genCost) * 100000) / 100000;
    }
}
