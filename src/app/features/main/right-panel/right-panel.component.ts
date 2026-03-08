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
import { AnalystDrilldownComponent } from './sections/analyst-drilldown/analyst-drilldown.component';

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
        AnalystDrilldownComponent,
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

    /**
     * Returns the current state of a timeframe tab:
     * - 'no-data'     : no messages exist for this period in the uploaded file
     * - 'available'   : messages exist, topics not yet loaded, stage data ready → loads on click
     * - 'loading'     : AI is currently running for this timeframe
     * - 'needs-upload': topics not loaded, stage data gone (page refresh) → user must re-upload
     * - 'ready'       : fully loaded with AI results
     */
    tabState(tf: Timeframe): 'no-data' | 'available' | 'loading' | 'needs-upload' | 'ready' {
        const cache = this.reportService.reportCache()[tf];
        if (!cache) return 'no-data';
        if (this.reportService.isAnalyzingTf() === tf) return 'loading';
        if (cache.topics !== null) return 'ready';
        if (this.reportService.hasStageData()) return 'available';
        return 'needs-upload';
    }
}
