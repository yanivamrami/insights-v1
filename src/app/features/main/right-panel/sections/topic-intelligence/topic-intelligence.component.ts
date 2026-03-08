import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Report } from '../../../../../core/models/report.model';
import { AppState } from '../../../../../core/state/app.state';

@Component({
    selector: 'app-topic-intelligence',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './topic-intelligence.component.html',
    styleUrl: './topic-intelligence.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopicIntelligenceComponent {
    @Input({ required: true }) report!: Report;
    appState = inject(AppState);

    skeletonRows = [0, 1, 2, 3, 4];

    trendArrow(trend: string | undefined): string {
        if (trend === 'up') return '↑';
        if (trend === 'down') return '↓';
        if (trend === 'new') return '🆕';
        return '→';
    }

    trendClass(trend: string | undefined): string {
        if (trend === 'up') return 'green';
        if (trend === 'down') return 'red';
        if (trend === 'new') return 'accent';
        return 'muted';
    }
}
