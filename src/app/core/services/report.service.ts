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
import { AI_PROVIDER } from '../../shared/const/const';

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
    /** The timeframe currently being lazily analyzed (null = none) */
    readonly isAnalyzingTf = signal<Timeframe | null>(null);
    /** True once Steps 1–7 have completed for the current file and in-memory stage data is available */
    readonly hasStageData = signal(false);

    private _fileKey = '';
    private _stageData: {
        fileKey: string;
        clustersByTf: Record<Timeframe, Cluster[]>;
        anomaliesByTf: Record<Timeframe, Message[]>;
        buckets: Record<Timeframe, Message[]>;
        partials: ReportCache;
    } | null = null;

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
        const fileKey = `${file.name}:${file.size}`;
        this._fileKey = fileKey;
        this._stageData = null;
        this.isAnalyzing.set(true);
        this.isAnalyzingTf.set(null);
        this.hasStageData.set(false);
        this.error.set(null);
        this.fileName.set(file.name);
        this.fileSource.set(null);
        this.reportCache.set({ today: null, yesterday: null, '7days': null });
        this.pipelineStats.set(null);
        this.pipelineSteps.set(INITIAL_STEPS.map(s => ({ ...s })));
        this.clearAllStorage();

        try {
            // ── STEP 1: Parse ──────────────────────────────────────────────────
            this.advanceStep(0);
            const content = await file.text();
            const isTelegram = this.telegramParser.canParse(file.name);
            const parser = isTelegram ? this.telegramParser : this.whatsappParser;
            const source: FileSource = isTelegram ? 'telegram' : 'whatsapp';
            this.fileSource.set(source);
            const raw = parser.parse(content);

            // ── STEP 2: Filter ─────────────────────────────────────────────────
            this.advanceStep(1);
            const { clean, dropped } = this.analytics.filterNoise(raw);

            // ── STEP 3: Bucket + Analytics ────────────────────────────────────
            this.advanceStep(2);
            const buckets = this.analytics.bucketByTimeframe(clean);
            const rawBuckets = this.analytics.bucketByTimeframe(raw);
            const anomaliesByTf: Record<Timeframe, Message[]> = { today: [], yesterday: [], '7days': [] };
            const clustersByTf: Record<Timeframe, Cluster[]> = { today: [], yesterday: [], '7days': [] };

            const partials: ReportCache = { today: null, yesterday: null, '7days': null };

            for (const tf of TIMEFRAMES) {
                const report = this.buildReportForTimeframe(tf, buckets, rawBuckets);
                if (!report) continue;
                (partials as Record<string, Report | null>)[tf] = report;
            }

            this.updateCache(partials);

            // ── STEP 4: Embed all messages ────────────────────────────────────
            this.advanceStep(3);
            const embeddedClean = await this.embedding.embedMessages(clean);
            const embeddingMap = new Map(embeddedClean.map(m => [m.id, m.embedding]));
            for (const tf of TIMEFRAMES) {
                buckets[tf] = buckets[tf].map(m => ({ ...m, embedding: embeddingMap.get(m.id) }));
            }

            // ── STEP 5: Cluster ───────────────────────────────────────────────
            this.advanceStep(4);
            for (const tf of TIMEFRAMES) {
                const msgs = buckets[tf].filter(m => m.embedding?.length);
                if (!msgs.length) continue;
                clustersByTf[tf] = this.clustering.kMeans(msgs);
            }

            // ── STEP 6: Sentiment scoring ─────────────────────────────────────
            this.advanceStep(5);
            // Scores are computed per-cluster in Step 8 when building topic objects

            // ── STEP 7: Anomaly detection ─────────────────────────────────────
            this.advanceStep(6);
            for (const tf of TIMEFRAMES) {
                const msgs = buckets[tf].filter(m => m.embedding?.length);
                if (!msgs.length) continue;
                const vecs = msgs.map(m => m.embedding!);
                const centroid = this.embedding.centroid(vecs);
                anomaliesByTf[tf] = this.embedding.detectAnomalies(msgs, centroid);
            }

            // Build initial insights — topic labels not yet available at this stage
            const insightsByTf: Record<Timeframe, Insight[]> = { today: [], yesterday: [], '7days': [] };
            for (const tf of TIMEFRAMES) {
                const report = (partials as Record<string, Report | null>)[tf];
                if (!report) continue;
                insightsByTf[tf] = this.buildInsights(
                    anomaliesByTf[tf],
                    report.authors,
                    clustersByTf[tf],
                    [],
                    buckets[tf]
                );
            }

            // Update reports with initial insights
            for (const tf of TIMEFRAMES) {
                const existing = (partials as Record<string, Report | null>)[tf];
                if (!existing) continue;
                const updated = { ...existing, insights: insightsByTf[tf] };
                (partials as Record<string, Report | null>)[tf] = updated;
            }
            this.updateCache(partials);

            // Capture stage data — enables lazy AI analysis for yesterday / 7days
            this._stageData = {
                fileKey,
                clustersByTf,
                anomaliesByTf,
                buckets: { today: [...buckets['today']], yesterday: [...buckets['yesterday']], '7days': [...buckets['7days']] },
                partials: { ...partials } as ReportCache,
            };
            this.hasStageData.set(true);

            // ── STEP 8 + 9: AI labels, vibe, summaries — all timeframes ─────
            this.advanceStep(7);
            let totalGenInTok = 0;
            let totalGenOutTok = 0;
            let totalGenerativeCalls = 0;
            for (const tf of TIMEFRAMES) {
                const tfClusters = clustersByTf[tf];
                const tfReport = (partials as Record<string, Report | null>)[tf];
                if (!tfClusters.length || !tfReport) continue;
                const { report: final, totalGenInTok: tfIn, totalGenOutTok: tfOut } = await this.runStep8And9(
                    tf,
                    tfClusters,
                    tfReport,
                    anomaliesByTf[tf],
                    clustersByTf,
                    buckets[tf],
                    fileKey
                );
                totalGenInTok += tfIn;
                totalGenOutTok += tfOut;
                totalGenerativeCalls += 4; // labelClusters (1) + generateVibeInfo (1) + generateSummaries (2)
                (partials as Record<string, Report | null>)[tf] = final;
                this.updateCache({ [tf]: final } as Partial<ReportCache>);
            }

            // ── DONE ──────────────────────────────────────────────────────────
            this.markAllDone();
            // Full-file cleanCount for embedding (single batch covers all timeframes).
            // Accumulate real gen tokens across all 3 timeframe runs.
            const finalEstimatedCost = this.computeActualCost(clean.length, totalGenInTok, totalGenOutTok);
            this.pipelineStats.set({
                fileName: file.name,
                fileSource: source,
                rawCount: raw.length,
                cleanCount: clean.length,
                droppedCount: dropped,
                embeddingCalls: 1,
                // 4 calls per timeframe × up to 3 timeframes
                generativeCalls: totalGenerativeCalls,
                estimatedCostUsd: finalEstimatedCost,
                actualGenInTok: totalGenInTok,
                actualGenOutTok: totalGenOutTok,
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

    private async labelClusters(clusters: Cluster[], _total: number): Promise<{ labels: string[]; inTok: number; outTok: number }> {
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

        const inTok = Math.ceil(prompt.length / 4);
        const raw = await this.ai.complete(prompt);
        const outTok = Math.ceil(raw.length / 4);
        const cleaned = raw.trim().replace(/^```(?:json)?|```$/gm, '').trim();
        return { labels: JSON.parse(cleaned) as string[], inTok, outTok };
    }

    private async generateVibeInfo(score: number, topicNames: string[]): Promise<{ emoji: string; label: string; description: string; inTok: number; outTok: number }> {
        console.log('Generating vibe info with AI:', { score, topicNames });
        const prompt = `Overall sentiment score: ${score.toFixed(2)} (range -1 very negative to +1 very positive).
Top topics: ${topicNames.slice(0, 5).join(', ')}.

Return a JSON object with exactly these keys:
- "emoji": one emoji representing the emotional vibe
- "label": one word (e.g. Negative, Positive, Mixed, Frustrated, Excited)
- "description": 1–2 sentences describing the community mood in plain language

Return ONLY valid JSON. No markdown. No extra text.`;

        const inTok = Math.ceil(prompt.length / 4);
        const raw = await this.ai.complete(prompt);
        const outTok = Math.ceil(raw.length / 4);
        const cleaned = raw.trim().replace(/^```(?:json)?|```$/gm, '').trim();
        return { ...JSON.parse(cleaned) as { emoji: string; label: string; description: string }, inTok, outTok };
    }

    private async generateSummaries(report: Report): Promise<{ exec: string; analyst: string; inTok: number; outTok: number }> {
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

        const inTok = Math.ceil((userPrompt.length + execSystemPrompt.length + analystSystemPrompt.length) / 4);
        const [exec, analyst] = await Promise.all([
            this.ai.complete(userPrompt, execSystemPrompt),
            this.ai.complete(userPrompt, analystSystemPrompt),
        ]);
        const outTok = Math.ceil((exec.length + analyst.length) / 4);
        return { exec, analyst, inTok, outTok };
    }

    private buildInsights(
        anomalies: Message[],
        authors: AuthorStat[],
        clusters: Cluster[],
        topicLabels: string[] = [],
        allMsgs: Message[] = []
    ): Insight[] {
        const insights: Insight[] = [];

        // ── 1. Sentiment trajectory ───────────────────────────────────────────
        // Split messages chronologically into thirds, compare first vs last sentiment.
        // Requires embeddings + anchor cache already populated (Step 6 complete).
        if (allMsgs.length >= 9) {
            const sorted = [...allMsgs]
                .filter(m => m.embedding)
                .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

            const timeline = this.buildSentimentTimeline(sorted);

            if (timeline.length >= 3) {
                // Pattern 1: sudden drop
                const dropIdx = timeline.findIndex((v, i) =>
                    i > 0 && timeline[i - 1] - v > 0.35
                );
                if (dropIdx > -1) {
                    const triggerMsg = sorted[dropIdx];
                    insights.push({
                        type: 'alert',
                        icon: '📉',
                        headline: 'Sudden Sentiment Drop Detected',
                        body: `Sentiment fell sharply around ${this.formatMsgTime(triggerMsg)} — from ${timeline[dropIdx - 1] >= 0 ? '+' : ''}${timeline[dropIdx - 1].toFixed(2)} to ${timeline[dropIdx] >= 0 ? '+' : ''}${timeline[dropIdx].toFixed(2)}. This pattern precedes formal complaints. Review messages at this point.`,
                        timeLabel: this.formatMsgTime(triggerMsg),
                    });
                }

                // Pattern 2: sustained negative tail (only if no sudden drop already flagged)
                else if (this.detectNegativeTail(timeline)) {
                    const lastMsg = sorted[sorted.length - 1];
                    const tailAvg = timeline.slice(-3).reduce((s, v) => s + v, 0) / 3;
                    insights.push({
                        type: 'warning',
                        icon: '📉',
                        headline: 'Conversation Ending on a Negative Trend',
                        body: `The final segment of this conversation shows a consistent downward sentiment trajectory (avg ${tailAvg >= 0 ? '+' : ''}${tailAvg.toFixed(2)}). No single spike, but sustained decline often precedes unresolved escalation.`,
                        timeLabel: this.formatMsgTime(lastMsg),
                    });
                }

                // Pattern 3: recovery
                else if (this.detectRecovery(timeline)) {
                    const midMsg = sorted[Math.floor(sorted.length / 2)];
                    insights.push({
                        type: 'info',
                        icon: '📈',
                        headline: 'Tension Resolved Mid-Conversation',
                        body: `Conversation started negatively but sentiment recovered in the second half. This signals that an issue was raised and handled — a positive indicator of team responsiveness.`,
                        timeLabel: this.formatMsgTime(midMsg),
                    });
                }
            }
        }

        // ── 2. Late-session topic shift ───────────────────────────────────────
        // Flag if any cluster has > 60% of its messages in the last 25% of the session.
        // Signals an emerging topic that appeared suddenly near the end.
        if (allMsgs.length >= 8 && clusters.length > 0) {
            const sorted = [...allMsgs].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
            const cutoff = sorted[Math.floor(sorted.length * 0.75)].timestamp;

            clusters.forEach((cluster, i) => {
                const lateMessages = cluster.messages.filter(m => m.timestamp > cutoff);
                const lateRatio = lateMessages.length / cluster.messages.length;
                if (lateRatio > 0.6 && cluster.messages.length >= 3) {
                    const label = topicLabels[i] ? `"${topicLabels[i]}"` : 'A new topic';
                    insights.push({
                        type: 'warning',
                        icon: '⚡',
                        headline: 'Late-Session Topic Spike Detected',
                        body: `${label} emerged heavily in the final quarter of the conversation (${lateMessages.length} of ${cluster.messages.length} messages). A sudden topic spike can signal an unresolved issue gaining momentum.`,
                        timeLabel: this.formatMsgTime(lateMessages[0]),
                    });
                }
            });
        }

        // ── 3. Per-author sentiment deviation ────────────────────────────────
        // Flag any author whose messages score > 0.3 below the group average.
        // Surfaces individuals who are significantly more negative than the group.
        if (allMsgs.length >= 6) {
            const anchors = this.embedding.anchors;
            if (anchors) {
                const scoreMsg = (m: Message): number | null => {
                    if (!m.embedding) return null;
                    const pos = this.embedding.cosineSimilarity(m.embedding, anchors.positive);
                    const neg = this.embedding.cosineSimilarity(m.embedding, anchors.negative);
                    const neut = this.embedding.cosineSimilarity(m.embedding, anchors.neutral);
                    const total = pos + neg + neut;
                    return total === 0 ? null : (pos - neg) / total;
                };

                const allScored = allMsgs.map(m => scoreMsg(m)).filter((s): s is number => s !== null);
                const groupAvg = allScored.reduce((s, v) => s + v, 0) / allScored.length;

                const authorGroups = new Map<string, number[]>();
                for (const m of allMsgs) {
                    const s = scoreMsg(m);
                    if (s === null) continue;
                    if (!authorGroups.has(m.author)) authorGroups.set(m.author, []);
                    authorGroups.get(m.author)!.push(s);
                }

                for (const [author, scores] of authorGroups) {
                    if (scores.length < 3) continue; // need enough messages to be meaningful
                    const authorAvg = scores.reduce((s, v) => s + v, 0) / scores.length;
                    const deviation = authorAvg - groupAvg;
                    if (deviation < -0.3) {
                        insights.push({
                            type: 'warning',
                            icon: '👤',
                            headline: `${author} Significantly More Negative Than Group`,
                            body: `${author}'s messages average ${authorAvg >= 0 ? '+' : ''}${authorAvg.toFixed(2)} against a group average of ${groupAvg >= 0 ? '+' : ''}${groupAvg.toFixed(2)}. Individual negative outliers often surface before formal complaints reach management.`,
                            timeLabel: this.formatMsgTime(allMsgs.filter(m => m.author === author).slice(-1)[0]),
                        });
                    }
                }
            }
        }

        // ── 4. Response burst after silence ──────────────────────────────────
        // Find the largest time gap in the conversation, then check if a burst
        // of messages followed it. Signals a triggering event.
        if (allMsgs.length >= 6) {
            const sorted = [...allMsgs].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
            let maxGap = 0;
            let gapIdx = 0;

            for (let i = 1; i < sorted.length; i++) {
                const gap = sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime();
                if (gap > maxGap) { maxGap = gap; gapIdx = i; }
            }

            const gapMinutes = maxGap / 60000;
            const totalSpanMinutes = (sorted[sorted.length - 1].timestamp.getTime() - sorted[0].timestamp.getTime()) / 60000;
            const burstThreshold = Math.min(120, Math.max(15, totalSpanMinutes * 0.05));
            const burstWindow = 5 * 60000; // 5 minutes
            const burstEnd = sorted[gapIdx].timestamp.getTime() + burstWindow;
            const burst = sorted.slice(gapIdx).filter(m => m.timestamp.getTime() <= burstEnd);

            if (gapMinutes >= burstThreshold && burst.length >= 4) {
                const gapLabel = gapMinutes >= 60
                    ? `${Math.round(gapMinutes / 60)}h gap`
                    : `${Math.round(gapMinutes)}min gap`;
                insights.push({
                    type: 'warning',
                    icon: '💥',
                    headline: 'Reaction Burst After Silence',
                    body: `${burst.length} messages were sent within 5 minutes after a ${gapLabel}. A sudden burst following silence typically signals a triggering event — review the messages at ${this.formatMsgTime(sorted[gapIdx])} for context.`,
                    timeLabel: this.formatMsgTime(sorted[gapIdx]),
                });
            }
        }

        // ── 5. Anomalous message content (outlier embedding) ─────────────────
        if (anomalies.length > 0) {
            const uniqueAuthors = [...new Set(anomalies.map(m => m.author))];
            const exampleMsg = anomalies[0];
            const preview = exampleMsg.text.length > 80
                ? exampleMsg.text.slice(0, 80) + '…'
                : exampleMsg.text;
            const otherCount = anomalies.length - 1;
            const tail = otherCount > 0
                ? ` +${otherCount} other outlier message${otherCount > 1 ? 's' : ''}.`
                : '';
            insights.push({
                type: 'alert',
                icon: '🚨',
                headline: `Unusual Message${anomalies.length > 1 ? 's' : ''} Detected from ${uniqueAuthors.join(', ')}`,
                body: `"${preview}"${tail} This message stands out significantly from the conversation's main themes.`,
                timeLabel: this.formatMsgTime(exampleMsg),
            });
        }

        // ── 6. Influence ≠ Volume ─────────────────────────────────────────────
        if (authors.length >= 2) {
            const volumeLeader = authors.find(a => a.volumeRank === 1);
            const influenceLeader = authors.find(a => a.influenceRank === 1);
            if (volumeLeader && influenceLeader && volumeLeader.author !== influenceLeader.author) {
                insights.push({
                    type: 'info',
                    icon: '💡',
                    headline: 'Influence ≠ Volume: Different Leaders',
                    body: `${volumeLeader.author} sends the most messages but ${influenceLeader.author} drives the most replies. The real conversation driver is not the loudest voice — worth monitoring ${influenceLeader.author}'s tone as a leading indicator.`,
                    timeLabel: this.formatMsgTime(allMsgs[allMsgs.length - 1] ?? new Date() as any),
                });
            }
        }

        return insights;
    }

    private buildReportForTimeframe(
        tf: Timeframe,
        buckets: Record<Timeframe, Message[]>,
        rawBuckets: Record<Timeframe, Message[]>
    ): Report | null {
        const msgs = buckets[tf];
        if (!msgs.length) return null;

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
        const tokensPayload = Math.round(msgs.length * 15); // 60 avg chars / 4 chars-per-token — text only (no author overhead)

        return {
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
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private buildSentimentTimeline(msgs: Message[], windowSize = 5): number[] {
        const anchors = this.embedding.anchors;
        if (!anchors || msgs.length < windowSize) return [];

        const sorted = [...msgs].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const timeline: number[] = [];

        for (let i = 0; i <= sorted.length - windowSize; i++) {
            const window = sorted.slice(i, i + windowSize).filter(m => m.embedding);
            if (!window.length) continue;

            const scores = window.map(m => {
                const pos = this.embedding.cosineSimilarity(m.embedding!, anchors.positive);
                const neg = this.embedding.cosineSimilarity(m.embedding!, anchors.negative);
                const neut = this.embedding.cosineSimilarity(m.embedding!, anchors.neutral);
                const total = pos + neg + neut;
                return total === 0 ? 0 : (pos - neg) / total;
            });

            timeline.push(scores.reduce((s, v) => s + v, 0) / scores.length);
        }

        return timeline;
    }

    // private detectSuddenDrop(timeline: number[], threshold = 0.35): boolean {
    //     for (let i = 1; i < timeline.length; i++) {
    //         if (timeline[i - 1] - timeline[i] > threshold) return true;
    //     }
    //     return false;
    // }

    private detectNegativeTail(timeline: number[]): boolean {
        if (timeline.length < 4) return false;
        const tail = timeline.slice(Math.floor(timeline.length * 0.7));
        // Check if every step in the tail is declining
        return tail.every((v, i) => i === 0 || v <= tail[i - 1]);
    }

    private detectRecovery(timeline: number[]): boolean {
        if (timeline.length < 4) return false;
        const firstHalf = timeline.slice(0, Math.floor(timeline.length / 2));
        const secondHalf = timeline.slice(Math.floor(timeline.length / 2));
        const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
        return firstAvg < -0.1 && secondAvg > firstAvg + 0.25;
    }

    private formatMsgTime(m: Message): string {
        if (!m?.timestamp) return '';
        return m.timestamp.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
        }) + ' ' + String(m.timestamp.getHours()).padStart(2, '0')
            + ':' + String(m.timestamp.getMinutes()).padStart(2, '0');
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

    private computeActualCost(cleanCount: number, actualGenInTok: number, actualGenOutTok: number): number {
        const isOpenAI = AI_PROVIDER === 'openai';
        const embPricePerM = isOpenAI ? 0.02 : 0.15;
        const genInPricePerM = isOpenAI ? 0.15 : 0.10;
        const genOutPricePerM = isOpenAI ? 0.60 : 0.40;

        const embCost = cleanCount * 15 / 1_000_000 * embPricePerM;
        const genCost = (actualGenInTok * genInPricePerM + actualGenOutTok * genOutPricePerM) / 1_000_000;
        return Math.round((embCost + genCost) * 100000) / 100000;
    }

    private estimateCost(cleanCount: number): number {
        // Prices match the active AI_PROVIDER (from const.ts)
        // OpenAI : text-embedding-3-small $0.02/1M · gpt-4o-mini $0.15 in / $0.60 out per 1M
        // Gemini : gemini-embedding-001   $0.15/1M · gemini-2.5-flash-lite $0.10 in / $0.40 out per 1M
        const isOpenAI = AI_PROVIDER === 'openai';
        const embPricePerM = isOpenAI ? 0.02 : 0.15;
        const genInPricePerM = isOpenAI ? 0.15 : 0.10;
        const genOutPricePerM = isOpenAI ? 0.60 : 0.40;

        const tokensPerMsg = 15;  // 60 avg chars ÷ 4
        const genCalls = 4;   // labelClusters + generateVibeInfo + generateSummaries×2
        const avgInputTokens = 600;
        const avgOutputTokens = 250;

        const embCost = cleanCount * tokensPerMsg / 1_000_000 * embPricePerM;
        const genCost = genCalls * (avgInputTokens * genInPricePerM + avgOutputTokens * genOutPricePerM) / 1_000_000;
        return Math.round((embCost + genCost) * 100000) / 100000;
    }

    // ── Drill-down data accessor ──────────────────────────────────────────────

    /**
     * Returns the raw messages for a specific cluster index and timeframe.
     * Used by the analyst drill-down panel.
     */
    getClusterMessages(tf: Timeframe, clusterIndex: number): import('../models/message.model').Message[] {
        return this._stageData?.clustersByTf[tf]?.[clusterIndex]?.messages ?? [];
    }

    // ── Lazy timeframe analysis ────────────────────────────────────────────────

    /**
     * Called when the user switches to a timeframe tab.
     * - If AI results are already in the cache signal → no-op.
     * - If the result is in localStorage → hydrate and return.
     * - If in-memory stage data is available → run Steps 8+9 for the timeframe.
     * - If stage data is gone (page refresh) → no-op; UI shows re-upload nudge.
     */
    async analyzeTimeframe(tf: Timeframe): Promise<void> {
        // Already fully loaded
        if (this.reportCache()[tf]?.topics !== null && this.reportCache()[tf] !== null) return;
        // Currently being analyzed
        if (this.isAnalyzingTf() === tf) return;

        // Try localStorage cache first (survives page refresh + same-file re-upload)
        const cached = this.loadFromStorage(tf, this._fileKey);
        if (cached) {
            this.updateCache({ [tf]: cached } as Partial<ReportCache>);
            return;
        }

        // No in-memory stage data (page refresh without re-upload)
        if (!this._stageData) return;

        const stage = this._stageData;
        const clusters = stage.clustersByTf[tf];
        const report = (stage.partials as Record<string, Report | null>)[tf];
        if (!clusters.length || !report) return;

        this.isAnalyzingTf.set(tf);
        // Reset pipeline to show steps 0–6 as done, 7–8 as pending
        this.pipelineSteps.set(INITIAL_STEPS.map((s, i) => ({
            ...s,
            status: (i < 7 ? 'done' : 'pending') as 'done' | 'pending',
        })));
        this.advanceStep(7);

        try {
            // const final = await this.runStep8And9(
            //     tf, clusters, report,
            //     stage.anomaliesByTf[tf], stage.clustersByTf, stage.fileKey,
            // );
            const { report: final, totalGenInTok, totalGenOutTok } = await this.runStep8And9(
                tf,
                clusters,
                report,
                stage.anomaliesByTf[tf],
                stage.clustersByTf,
                stage.buckets[tf],
                stage.fileKey
            );

            this.updateCache({ [tf]: final } as Partial<ReportCache>);

            // Update cost estimate with real tokens for this timeframe
            const stats = this.pipelineStats();
            if (stats) {
                const newCost = this.computeActualCost(stats.cleanCount, totalGenInTok, totalGenOutTok);
                this.pipelineStats.update(s => s ? ({
                    ...s,
                    actualGenInTok: totalGenInTok,
                    actualGenOutTok: totalGenOutTok,
                    estimatedCostUsd: newCost,
                }) : s);
            }

            this.markAllDone();
        } catch (err: unknown) {
            this.markStepFailed();
            const msg = err instanceof Error ? err.message : 'Analysis failed';
            this.error.set(msg);
        } finally {
            this.isAnalyzingTf.set(null);
        }
    }

    // ── Shared AI execution helper (Steps 8+9) ─────────────────────────────────

    private async runStep8And9(
        tf: Timeframe,
        clusters: Cluster[],
        report: Report,
        anomalies: Message[],
        clustersByTf: Record<Timeframe, Cluster[]>,
        allMsgs: Message[],
        fileKey: string
    ): Promise<{ report: Report; totalGenInTok: number; totalGenOutTok: number }> {
        // Sentiment scoring
        const sentimentScores = await Promise.all(
            clusters.map(c => this.embedding.scoreSentiment(c.centroidVector))
        );

        // Label clusters
        let topics: Topic[];
        let labelTok = { inTok: 0, outTok: 0 };
        try {
            const { labels, inTok, outTok } = await this.labelClusters(clusters, report.cleanMessages);
            labelTok = { inTok, outTok };
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

        // Vibe info
        let vibeEmoji = '😐', vibeLabel = 'Neutral', vibeDesc = 'Mixed sentiments across topics.';
        let vibeTok = { inTok: 0, outTok: 0 };
        try {
            const vibe = await this.generateVibeInfo(overallScore, topics.map(t => t.label));
            vibeEmoji = vibe.emoji;
            vibeLabel = vibe.label;
            vibeDesc = vibe.description;
            vibeTok = { inTok: vibe.inTok, outTok: vibe.outTok };
        } catch { /* keep defaults */ }

        const actualGenInTok = labelTok.inTok + vibeTok.inTok;
        const actualGenOutTok = labelTok.outTok + vibeTok.outTok;
        const cost = this.computeActualCost(report.cleanMessages, actualGenInTok, actualGenOutTok);
        // const labeledInsights = this.buildInsights(anomalies, report.authors, clusters, topics.map(t => t.label));
        const labeledInsights = this.buildInsights(
            anomalies,
            report.authors,
            clustersByTf[tf],
            topics.map(t => t.label),
            allMsgs
        );

        let result: Report = {
            ...report, topics, overallSentimentScore: overallScore,
            overallVibeEmoji: vibeEmoji, overallVibeLabel: vibeLabel,
            overallVibeDescription: vibeDesc, estimatedCostUsd: cost,
            insights: labeledInsights,
        };

        // Step 9: summaries
        this.advanceStep(8);
        let totalGenInTok = actualGenInTok;
        let totalGenOutTok = actualGenOutTok;
        try {
            const { exec: summaryExec, analyst: summaryAnalyst, inTok: sInTok, outTok: sOutTok } = await this.generateSummaries(result);
            totalGenInTok += sInTok;
            totalGenOutTok += sOutTok;
            const finalCost = this.computeActualCost(
                report.cleanMessages,
                totalGenInTok,
                totalGenOutTok
            );
            result = { ...result, summaryExec, summaryAnalyst, estimatedCostUsd: finalCost };
        } catch { /* summaries remain null */ }

        this.saveToStorage(tf, result, fileKey);
        return { report: result, totalGenInTok, totalGenOutTok };
    }

    // ── localStorage helpers ───────────────────────────────────────────────────

    private storageKey(tf: Timeframe, fileKey: string): string {
        return `insights-v1:${fileKey}:${tf}`;
    }

    private saveToStorage(tf: Timeframe, report: Report, fileKey: string): void {
        try {
            localStorage.setItem(this.storageKey(tf, fileKey), JSON.stringify(report));
        } catch { /* ignore quota errors */ }
    }

    private loadFromStorage(tf: Timeframe, fileKey: string): Report | null {
        if (!fileKey) return null;
        try {
            const raw = localStorage.getItem(this.storageKey(tf, fileKey));
            if (!raw) return null;
            const r = JSON.parse(raw) as Report;
            // Validate that it's actually a completed report
            if (!r?.topics) return null;
            // Restore Date objects (JSON.parse gives strings)
            return r;
        } catch { return null; }
    }

    /** Remove all insights-v1 cache entries unconditionally. Called on every new upload. */
    private clearAllStorage(): void {
        const prefix = 'insights-v1:';
        const toDelete: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(prefix)) toDelete.push(key);
        }
        toDelete.forEach(k => localStorage.removeItem(k));
    }
}
