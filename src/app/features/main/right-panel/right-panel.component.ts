import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppState } from '../../../core/state/app.state';
import { ReportService } from '../../../core/services/report.service';
import { Timeframe } from '../../../core/models/message.model';
import { ActivityPulseComponent } from './sections/activity-pulse/activity-pulse.component';
import { TopicIntelligenceComponent } from './sections/topic-intelligence/topic-intelligence.component';
import { SentimentEngineComponent } from './sections/sentiment-engine/sentiment-engine.component';
import { UserEngagementComponent } from './sections/user-engagement/user-engagement.component';
import { DeepInsightsComponent } from './sections/deep-insights/deep-insights.component';
import { ExecutiveSummaryComponent } from './sections/executive-summary/executive-summary.component';
import { SectionHelpComponent } from '../../../shared/components/section-help/section-help.component';

@Component({
    selector: 'app-right-panel',
    standalone: true,
    imports: [
        CommonModule,
        ActivityPulseComponent,
        TopicIntelligenceComponent,
        SentimentEngineComponent,
        UserEngagementComponent,
        DeepInsightsComponent,
        ExecutiveSummaryComponent,
        SectionHelpComponent,
    ],
    templateUrl: './right-panel.component.html',
    styleUrl: './right-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RightPanelComponent {
    appState = inject(AppState);
    reportService = inject(ReportService);

    timeframes: { label: string; value: Timeframe }[] = [
        { label: 'Today', value: 'today' },
        { label: 'Yesterday', value: 'yesterday' },
        { label: '7 Days', value: '7days' },
    ];

    setTimeframe(tf: Timeframe): void {
        this.appState.setTimeframe(tf);
    }
}
