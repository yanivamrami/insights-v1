import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { Report } from '../../../../../core/models/report.model';

@Component({
    selector: 'app-sentiment-engine',
    standalone: true,
    imports: [],
    templateUrl: './sentiment-engine.component.html',
    styleUrl: './sentiment-engine.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SentimentEngineComponent {
    @Input({ required: true }) report!: Report;

    /** Overall sentiment score → circle border color */
    get vibeColor(): string {
        const s = this.report.overallSentimentScore;
        if (s === null) return 'var(--border)';
        if (s < -0.1) return 'var(--red)';
        if (s > 0.1) return 'var(--green)';
        return 'var(--yellow)';
    }

    /** Cursor position on gradient bar [0–100] */
    get sentimentCursorPct(): number {
        const s = this.report.overallSentimentScore ?? 0;
        return ((s + 1) / 2) * 100;
    }

    get vibeLabel(): string {
        const s = this.report.overallSentimentScore;
        if (s === null) return '–';
        if (s < -0.3) return 'Negative';
        if (s < -0.1) return 'Mixed–';
        if (s < 0.1) return 'Neutral';
        if (s < 0.3) return 'Mixed+';
        return 'Positive';
    }

    get vibeEmoji(): string {
        const s = this.report.overallSentimentScore;
        if (s === null) return '❓';
        if (s < -0.1) return '😟';
        if (s > 0.1) return '😊';
        return '😐';
    }

    sentimentBarWidth(score: number): number {
        return ((score + 1) / 2) * 100;
    }

    topicSentimentColor(score: number): string {
        if (score < -0.1) return 'var(--red)';
        if (score > 0.1) return 'var(--green)';
        return 'var(--yellow)';
    }

    get overallScore(): number {
        return this.report.overallSentimentScore ?? 0;
    }
}
