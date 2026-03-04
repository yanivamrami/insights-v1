import { Component, inject } from '@angular/core';
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
        { label: 'Starter', desc: '1 group · daily', runsPerMonth: 30, msgsPerRun: 1000 },
        { label: 'Growth', desc: '20 groups · daily', runsPerMonth: 600, msgsPerRun: 2000 },
        { label: 'Scale', desc: '100 groups · daily', runsPerMonth: 3000, msgsPerRun: 5000 },
        { label: 'Enterprise', desc: '500 groups · daily', runsPerMonth: 15000, msgsPerRun: 10000 },
    ];

    // Cost model:
    // embedding: (msgs * avgCharsPerMsg) / 1000 * pricePerKChars
    // generative: 6 calls × (600 input + 250 output) tokens
    estimateMonthlyCost(provider: ModelProvider, scale: ScaleRow): string {
        if (provider.generativePriceIn === null) return '—';

        const avgCharsPerMsg = 60;
        const genCallsPerRun = 6;
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

        if (monthly < 0.01) return `~$${(monthly * 100).toFixed(2)}¢`;
        if (monthly < 1) return `~$${monthly.toFixed(3)}`;
        if (monthly < 100) return `~$${monthly.toFixed(2)}`;
        return `~$${Math.round(monthly).toLocaleString()}`;
    }

    estimatePerRun(provider: ModelProvider, msgsPerRun: number): string {
        if (provider.generativePriceIn === null) return '—';
        const avgCharsPerMsg = 60;
        const genCallsPerRun = 6;
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
        const inCost = stats.generativeCalls * 600 / 1_000_000 * (provider.generativePriceIn ?? 0);
        const outCost = stats.generativeCalls * 250 / 1_000_000 * (provider.generativePriceOut ?? 0);
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
        const cost = stats.generativeCalls * (600 * (provider.generativePriceIn ?? 0) + 250 * (provider.generativePriceOut ?? 0)) / 1_000_000;
        return cost < 0.00001 ? '< $0.00001' : `~$${cost.toFixed(5)}`;
    }
}
