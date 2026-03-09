import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { Report, Insight } from '../../../../../core/models/report.model';

@Component({
    selector: 'app-deep-insights',
    standalone: true,
    imports: [],
    templateUrl: './deep-insights.component.html',
    styleUrl: './deep-insights.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeepInsightsComponent {
    @Input({ required: true }) report!: Report;

    insightBorderColor(type: Insight['type']): string {
        if (type === 'alert') return 'var(--red)';
        if (type === 'warning') return 'var(--yellow)';
        return 'var(--accent)';
    }

    insightIconEmoji(type: Insight['type']): string {
        if (type === 'alert') return '🔴';
        if (type === 'warning') return '⚠️';
        return '💡';
    }
}
