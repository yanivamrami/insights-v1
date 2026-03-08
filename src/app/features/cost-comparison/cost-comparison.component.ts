import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ReportService } from '../../core/services/report.service';

export interface ModelProvider {
    id: string;
    name: string;
    logo: string;
    tagline: string;
    badge: string;
    badgeClass: string;
    embeddingModel: string;
    embeddingPriceLabel: string;
    embeddingPricePerM: number | null; // USD per 1M tokens, null = free
    generativeModel: string;
    generativePriceInLabel: string;
    generativePriceOutLabel: string;
    generativePriceIn: number | null;  // USD per 1M tokens
    generativePriceOut: number | null;
    privacy: 'Cloud' | 'Cloud (opt-out)' | '100% Local';
    privacyClass: 'cloud' | 'cloud-opt' | 'local';
    setup: string;
    setupLevel: 1 | 2 | 3;
    pros: string[];
    cons: string[];
}

export interface ScaleRow {
    label: string;
    desc: string;
    runsPerMonth: number;
    msgsPerRun: number;
}

@Component({
    selector: 'app-cost-comparison',
    standalone: true,
    imports: [RouterLink, DecimalPipe],
    templateUrl: './cost-comparison.component.html',
    styleUrl: './cost-comparison.component.scss',
})
export class CostComparisonComponent {
    readonly reportService = inject(ReportService);

    readonly tooltipText = signal<string | null>(null);
    readonly tooltipX = signal(0);
    readonly tooltipY = signal(0);

    showCalcTooltip(text: string, event: MouseEvent): void {
        this.tooltipText.set(text);
        this.updateTooltipPos(event);
    }

    updateTooltipPos(event: MouseEvent): void {
        this.tooltipX.set(event.clientX);
        this.tooltipY.set(event.clientY);
    }

    hideCalcTooltip(): void {
        this.tooltipText.set(null);
    }

    providers: ModelProvider[] = [
        {
            id: 'gemini',
            name: 'Google Gemini',
            logo: '🟦',
            tagline: 'Best price-to-quality for mixed workloads',
            badge: 'Also supported',
            badgeClass: 'neutral',
            embeddingModel: 'gemini-embedding-001',
            embeddingPriceLabel: '$0.15 / 1M tokens',
            embeddingPricePerM: 0.15,
            generativeModel: 'gemini-2.5-flash-lite',
            generativePriceInLabel: '$0.10 / 1M tokens',
            generativePriceOutLabel: '$0.40 / 1M tokens',
            generativePriceIn: 0.10,
            generativePriceOut: 0.40,
            privacy: 'Cloud',
            privacyClass: 'cloud',
            setup: 'API key only',
            setupLevel: 1,
            pros: [
                '768-dim CLUSTERING embeddings — purpose-built for this',
                'Gemini 2.5 Flash: strong reasoning at low cost',
                '1M context window for long group histories',
                'Same key for embedding + generative',
            ],
            cons: [
                'Data processed on Google servers',
                'Rate limits on free tier',
                'Embedding latency slightly higher than OpenAI',
            ],
        },
        {
            id: 'openai',
            name: 'OpenAI',
            logo: '⬛',
            tagline: 'Industry standard — fastest embeddings',
            badge: 'Current default',
            badgeClass: 'active',
            embeddingModel: 'text-embedding-3-small',
            embeddingPriceLabel: '$0.02 / 1M tokens ($0.01 batch)',
            embeddingPricePerM: 0.02,
            generativeModel: 'gpt-4o-mini',
            generativePriceInLabel: '$0.15 / 1M tokens',
            generativePriceOutLabel: '$0.60 / 1M tokens',
            generativePriceIn: 0.15,
            generativePriceOut: 0.60,
            privacy: 'Cloud',
            privacyClass: 'cloud',
            setup: 'API key only',
            setupLevel: 1,
            pros: [
                'Fastest embedding throughput in class',
                'gpt-4o-mini: excellent JSON reliability',
                'Well-documented, battle-tested APIs',
                'Separate keys for each capability',
            ],
            cons: [
                'Data processed on OpenAI servers',
                'Embedding dims (1536) larger → more RAM per run',
                'Slightly higher embedding cost than Gemini',
            ],
        },
        {
            id: 'llama',
            name: 'Local Llama',
            logo: '🦙',
            tagline: 'Zero API cost · 100% private · runs offline',
            badge: 'Coming soon',
            badgeClass: 'future',
            embeddingModel: 'nomic-embed-text (Ollama)',
            embeddingPriceLabel: '$0 — runs on your hardware',
            embeddingPricePerM: 0,
            generativeModel: 'llama3.3 / llama3.2 (Ollama)',
            generativePriceInLabel: '$0 — runs on your hardware',
            generativePriceOutLabel: '$0 — runs on your hardware',
            generativePriceIn: 0,
            generativePriceOut: 0,
            privacy: '100% Local',
            privacyClass: 'local',
            setup: 'Ollama + GPU recommended',
            setupLevel: 3,
            pros: [
                'No data ever leaves your machine',
                'Zero per-token cost at any scale',
                'Works fully offline',
                'No rate limits',
            ],
            cons: [
                'Requires Ollama + ≥8 GB RAM (16 GB recommended)',
                'Slower than API-based models without GPU',
                'JSON output reliability lower without fine-tuning',
                'Hardware cost if using cloud GPU (~$0.10–0.50/hr)',
            ],
        },
    ];

    scales: ScaleRow[] = [
        { label: 'Starter', desc: '1 group · daily  (1 × 30 days)', runsPerMonth: 30, msgsPerRun: 1000 },
        { label: 'Growth', desc: '20 groups · daily  (20 × 30)', runsPerMonth: 600, msgsPerRun: 2000 },
        { label: 'Scale', desc: '100 groups · daily  (100 × 30)', runsPerMonth: 3000, msgsPerRun: 5000 },
        { label: 'Enterprise', desc: '500 groups · daily  (500 × 30)', runsPerMonth: 15000, msgsPerRun: 10000 },
    ];

    // Cost model:
    // embedding: (msgs * avgCharsPerMsg) / 1000 * pricePerKChars
    // generative: 12 calls — 4 per period (labelClusters × 1 + generateVibeInfo × 1 + generateSummaries × 2) × 3 periods
    //             × (600 input + 250 output) tokens each
    estimateMonthlyCost(provider: ModelProvider, scale: ScaleRow): string {
        if (provider.generativePriceIn === null) return '—';

        const avgCharsPerMsg = 60;
        const genCallsPerRun = 12; // 4 calls/period × 3 periods
        const inputTokensPerCall = 600;
        const outputTokensPerCall = 250;

        const embeddingCostPerRun = provider.embeddingPricePerM === null || provider.embeddingPricePerM === 0
            ? 0
            : (scale.msgsPerRun * avgCharsPerMsg / 4) / 1_000_000 * provider.embeddingPricePerM;

        const genInCostPerRun = provider.generativePriceIn === 0
            ? 0
            : (genCallsPerRun * inputTokensPerCall) / 1_000_000 * provider.generativePriceIn;

        const genOutCostPerRun = provider.generativePriceOut === 0
            ? 0
            : (genCallsPerRun * outputTokensPerCall) / 1_000_000 * (provider.generativePriceOut ?? 0);

        const totalPerRun = embeddingCostPerRun + genInCostPerRun + genOutCostPerRun;
        const monthly = totalPerRun * scale.runsPerMonth;

        if (provider.id === 'llama') {
            return monthly === 0 ? '~$0*' : `~$${monthly.toFixed(2)}`;
        }

        if (monthly < 0.01) return `~${(monthly * 100).toFixed(2)}¢`;
        if (monthly < 1) return `~$${monthly.toFixed(3)}`;
        if (monthly < 100) return `~$${monthly.toFixed(2)}`;
        return `~$${Math.round(monthly).toLocaleString()}`;
    }

    /** Builds the infrastructure-cost explanation tooltip for self-hosted Llama. */
    private llamaInfraTooltip(msgsPerRun: number, runsPerMonth?: number): string {
        // AWS g5.2xlarge (A10G GPU) — standard reference server
        const serverCostPerHr = 1.00;
        const lowThroughput = 500;   // msgs/hr — conservative, ~500-tok payloads, 1 group
        const highThroughput = 5000;  // msgs/hr — high utilization, 500+ groups concurrent

        const lowCostPerRun = serverCostPerHr / lowThroughput * msgsPerRun;
        const highCostPerRun = serverCostPerHr / highThroughput * msgsPerRun;

        const fmtN = (n: number) => n.toLocaleString();
        const fmtD = (n: number) => n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;

        const lines: string[] = [
            `⚠️  $0 = zero API cost, not zero total cost`,
            `   Self-hosted replaces per-call fees with infrastructure cost.`,
            ``,
            `── Reference server ───────────────────────────────────`,
            `Server     : AWS g5.2xlarge (A10G GPU)  ≈ $${serverCostPerHr.toFixed(2)}/hr`,
            `Formula    : ($server/hr ÷ msgs/hr) × msgs processed`,
            ``,
            `── Per-run cost — ${fmtN(msgsPerRun)} msgs ───────────────────────`,
            `Low util   : $${serverCostPerHr.toFixed(2)} ÷ ${fmtN(lowThroughput)} msgs/hr × ${fmtN(msgsPerRun)}  =  ${fmtD(lowCostPerRun)}/run`,
            `            (1 group, server mostly idle)`,
            `High util  : $${serverCostPerHr.toFixed(2)} ÷ ${fmtN(highThroughput)} msgs/hr × ${fmtN(msgsPerRun)}  =  ${fmtD(highCostPerRun)}/run`,
            `            (500+ groups, server near capacity)`,
        ];

        if (runsPerMonth !== undefined) {
            const lowMonthly = lowCostPerRun * runsPerMonth;
            const highMonthly = highCostPerRun * runsPerMonth;
            lines.push(
                ``,
                `── Monthly (× ${fmtN(runsPerMonth)} runs) ────────────────────────`,
                `Low util   : ${fmtD(lowMonthly)}/mo`,
                `High util  : ${fmtD(highMonthly)}/mo`,
            );
        }

        lines.push(
            ``,
            `── Breakeven vs managed APIs ────────────────────`,
            `Self-hosted wins at ≥ ~500 groups (high GPU utilization).`,
            `Below that, Gemini / OpenAI are cheaper all-in.`,
        );

        return lines.join('\n');
    }

    estimateMonthlyCostCalc(provider: ModelProvider, scale: ScaleRow): string {
        if (provider.generativePriceIn === null) return '';

        const tokPerMsg = 60 / 4; // avgCharsPerMsg / chars-per-token = 15
        const genCallsPerRun = 12; // 4 calls/period × 3 periods
        const inputTokPerCall = 600;
        const outputTokPerCall = 250;

        const embTok = scale.msgsPerRun * tokPerMsg;
        const genInTok = genCallsPerRun * inputTokPerCall;    // 12 × 600 = 7,200
        const genOutTok = genCallsPerRun * outputTokPerCall;  // 12 × 250 = 3,000

        const fmtN = (n: number) => n.toLocaleString();
        const fmtP = (n: number) => n.toFixed(6);

        if (provider.id === 'llama') {
            return this.llamaInfraTooltip(scale.msgsPerRun, scale.runsPerMonth);
        }

        const embCostPerRun = provider.embeddingPricePerM === null || provider.embeddingPricePerM === 0
            ? 0
            : embTok / 1_000_000 * provider.embeddingPricePerM;
        const genInCostPerRun = provider.generativePriceIn === 0
            ? 0
            : genInTok / 1_000_000 * provider.generativePriceIn;
        const genOutCostPerRun = provider.generativePriceOut === 0
            ? 0
            : genOutTok / 1_000_000 * (provider.generativePriceOut ?? 0);
        const totalPerRun = embCostPerRun + genInCostPerRun + genOutCostPerRun;
        const monthly = totalPerRun * scale.runsPerMonth;

        const monthlyFmt = monthly < 0.01
            ? `~$${(monthly * 100).toFixed(2)}¢`
            : monthly < 100
                ? `~$${monthly.toFixed(2)}`
                : `~$${Math.round(monthly).toLocaleString()}`;

        const embLine = provider.embeddingPricePerM === null || provider.embeddingPricePerM === 0
            ? `Embedding : free`
            : `Embedding : ${fmtN(scale.msgsPerRun)} msgs × ${tokPerMsg} tok/msg = ${fmtN(embTok)} tok × $${provider.embeddingPricePerM}/1M  =  $${fmtP(embCostPerRun)}/run`;

        const genInLine = provider.generativePriceIn === 0
            ? `AI (in)   : free`
            : `AI (in)   : ${genCallsPerRun} calls × ${fmtN(inputTokPerCall)} tok/call = ${fmtN(genInTok)} tok × $${provider.generativePriceIn}/1M  =  $${fmtP(genInCostPerRun)}/run`;

        const genOutLine = !provider.generativePriceOut
            ? `AI (out)  : free`
            : `AI (out)  : ${genCallsPerRun} calls × ${fmtN(outputTokPerCall)} tok/call = ${fmtN(genOutTok)} tok × $${provider.generativePriceOut}/1M  =  $${fmtP(genOutCostPerRun)}/run`;

        return [
            embLine,
            genInLine,
            genOutLine,
            ``,
            `Per run   : $${fmtP(totalPerRun)}`,
            `× ${fmtN(scale.runsPerMonth)} runs/mo  =  ${monthlyFmt} / mo`,
        ].join('\n');
    }

    estimatePerRunCalc(provider: ModelProvider, msgsPerRun: number): string {
        if (provider.generativePriceIn === null) return '';

        const tokPerMsg = 15; // 60 chars / 4
        const genCallsPerRun = 12; // 4 calls/period × 3 periods
        const inputTokPerCall = 600;
        const outputTokPerCall = 250;

        const embTok = msgsPerRun * tokPerMsg;
        const genInTok = genCallsPerRun * inputTokPerCall;
        const genOutTok = genCallsPerRun * outputTokPerCall;

        const fmtN = (n: number) => n.toLocaleString();
        const fmtP = (n: number) => n.toFixed(6);

        if (provider.id === 'llama') {
            return this.llamaInfraTooltip(msgsPerRun);
        }

        const embCostPerRun = provider.embeddingPricePerM === null || provider.embeddingPricePerM === 0
            ? 0
            : embTok / 1_000_000 * provider.embeddingPricePerM;
        const genInCostPerRun = provider.generativePriceIn === 0
            ? 0
            : genInTok / 1_000_000 * provider.generativePriceIn;
        const genOutCostPerRun = !provider.generativePriceOut
            ? 0
            : genOutTok / 1_000_000 * provider.generativePriceOut;
        const total = embCostPerRun + genInCostPerRun + genOutCostPerRun;

        const totalFmt = total < 0.001
            ? `~$${(total * 1000).toFixed(3)}m`
            : `~$${total.toFixed(4)}`;

        const embLine = provider.embeddingPricePerM === null || provider.embeddingPricePerM === 0
            ? `Embedding : free`
            : `Embedding : ${fmtN(msgsPerRun)} msgs × ${tokPerMsg} tok/msg = ${fmtN(embTok)} tok × $${provider.embeddingPricePerM}/1M  =  $${fmtP(embCostPerRun)}`;

        const genInLine = provider.generativePriceIn === 0
            ? `AI (in)   : free`
            : `AI (in)   : ${genCallsPerRun} calls × ${fmtN(inputTokPerCall)} tok/call = ${fmtN(genInTok)} tok × $${provider.generativePriceIn}/1M  =  $${fmtP(genInCostPerRun)}`;

        const genOutLine = !provider.generativePriceOut
            ? `AI (out)  : free`
            : `AI (out)  : ${genCallsPerRun} calls × ${fmtN(outputTokPerCall)} tok/call = ${fmtN(genOutTok)} tok × $${provider.generativePriceOut}/1M  =  $${fmtP(genOutCostPerRun)}`;

        return [
            embLine,
            genInLine,
            genOutLine,
            ``,
            `Total     : ${totalFmt} / run`,
        ].join('\n');
    }

    estimatePerRun(provider: ModelProvider, msgsPerRun: number): string {
        if (provider.generativePriceIn === null) return '—';
        const avgCharsPerMsg = 60;
        const genCallsPerRun = 12; // 4 calls/period × 3 periods
        const inputTokensPerCall = 600;
        const outputTokensPerCall = 250;

        const embCost = provider.embeddingPricePerM === 0
            ? 0
            : (msgsPerRun * avgCharsPerMsg / 4) / 1_000_000 * (provider.embeddingPricePerM ?? 0);
        const genIn = provider.generativePriceIn === 0
            ? 0
            : (genCallsPerRun * inputTokensPerCall) / 1_000_000 * provider.generativePriceIn;
        const genOut = provider.generativePriceOut === 0
            ? 0
            : (genCallsPerRun * outputTokensPerCall) / 1_000_000 * (provider.generativePriceOut ?? 0);

        const total = embCost + genIn + genOut;
        if (provider.id === 'llama') return '~$0*';
        if (total < 0.001) return `~$${(total * 1000).toFixed(3)}m`;
        return `~$${total.toFixed(4)}`;
    }

    setupDots(level: 1 | 2 | 3): number[] {
        return Array(3).fill(0).map((_, i) => i + 1);
    }

    // ── Live run estimate using actual imported data ───────────────────────────

    get liveStats() { return this.reportService.pipelineStats(); }

    liveRunCost(provider: ModelProvider): string {
        const stats = this.reportService.pipelineStats();
        if (!stats) return '—';
        if (provider.id === 'llama') return '~$0 *';

        const avgTokensPerMsg = 15; // ~60 chars / 4
        const embCost = stats.cleanCount * avgTokensPerMsg / 1_000_000 * (provider.embeddingPricePerM ?? 0);
        const inTok = stats.actualGenInTok > 0 ? stats.actualGenInTok : stats.generativeCalls * 600;
        const outTok = stats.actualGenOutTok > 0 ? stats.actualGenOutTok : stats.generativeCalls * 250;
        const inCost = inTok / 1_000_000 * (provider.generativePriceIn ?? 0);
        const outCost = outTok / 1_000_000 * (provider.generativePriceOut ?? 0);
        const total = embCost + inCost + outCost;

        if (total === 0) return '~$0';
        if (total < 0.0001) return `< $0.0001`;
        if (total < 0.001) return `~$${total.toFixed(5)}`;
        if (total < 1) return `~$${total.toFixed(4)}`;
        return `~$${total.toFixed(3)}`;
    }

    liveEmbedCost(provider: ModelProvider): string {
        const stats = this.reportService.pipelineStats();
        if (!stats || provider.id === 'llama') return provider.id === 'llama' ? '$0' : '—';
        const cost = stats.cleanCount * 15 / 1_000_000 * (provider.embeddingPricePerM ?? 0);
        return cost < 0.00001 ? '< $0.00001' : `~$${cost.toFixed(5)}`;
    }

    liveGenCost(provider: ModelProvider): string {
        const stats = this.reportService.pipelineStats();
        if (!stats || provider.id === 'llama') return provider.id === 'llama' ? '$0' : '—';
        const inTok = stats.actualGenInTok > 0 ? stats.actualGenInTok : stats.generativeCalls * 600;
        const outTok = stats.actualGenOutTok > 0 ? stats.actualGenOutTok : stats.generativeCalls * 250;
        const cost = (inTok * (provider.generativePriceIn ?? 0) + outTok * (provider.generativePriceOut ?? 0)) / 1_000_000;
        return cost < 0.00001 ? '< $0.00001' : `~$${cost.toFixed(5)}`;
    }

    liveRunTooltip(provider: ModelProvider): string {
        const stats = this.reportService.pipelineStats();
        if (!stats) return '';

        if (provider.id === 'llama') {
            return [
                `$0 API cost — runs entirely on local hardware.`,
                `No tokens are billed for embedding or generation.`,
                `Infrastructure cost depends on hardware (see scale table below).`,
            ].join('\n');
        }

        const fmtN = (n: number) => n.toLocaleString();
        const fmtP = (n: number) => n < 0.000001 ? `$${n.toFixed(7)}` : n < 0.001 ? `$${n.toFixed(6)}` : `$${n.toFixed(5)}`;

        const embTok = stats.cleanCount * 15;
        const embCost = embTok / 1_000_000 * (provider.embeddingPricePerM ?? 0);

        const measured = stats.actualGenInTok > 0;
        const inTok = measured ? stats.actualGenInTok : stats.generativeCalls * 600;
        const outTok = measured ? stats.actualGenOutTok : stats.generativeCalls * 250;
        const inCost = inTok / 1_000_000 * (provider.generativePriceIn ?? 0);
        const outCost = outTok / 1_000_000 * (provider.generativePriceOut ?? 0);
        const total = embCost + inCost + outCost;

        const embPriceLabel = `$${provider.embeddingPricePerM}/1M`;
        const inPriceLabel = `$${provider.generativePriceIn}/1M`;
        const outPriceLabel = `$${provider.generativePriceOut}/1M`;

        return [
            `── Embedding (full file) ─────────────────────────────────`,
            `Messages : ${fmtN(stats.cleanCount)} clean msgs`,
            `Tokens   : ${fmtN(stats.cleanCount)} × 15 tok/msg  =  ${fmtN(embTok)} tok`,
            `Price    : ${embPriceLabel} tokens`,
            `Cost     : ${fmtP(embCost)}`,
            ``,
            `── Generative (today's run · ${stats.generativeCalls} calls) ──────────────`,
            `Source   : ${measured ? 'measured from real prompts/responses' : 'estimated (no run yet)'}`,
            `In tok   : ${fmtN(inTok)} tok × ${inPriceLabel}   =  ${fmtP(inCost)}`,
            `Out tok  : ${fmtN(outTok)} tok × ${outPriceLabel}  =  ${fmtP(outCost)}`,
            ``,
            `── Total ─────────────────────────────────────────────────`,
            `${fmtP(total)}  for this import`,
        ].join('\n');
    }
}
