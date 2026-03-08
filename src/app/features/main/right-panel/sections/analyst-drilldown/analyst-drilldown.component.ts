import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AppState } from '../../../../../core/state/app.state';
import { ReportService } from '../../../../../core/services/report.service';

@Component({
    selector: 'app-analyst-drilldown',
    standalone: true,
    imports: [DatePipe],
    templateUrl: './analyst-drilldown.component.html',
    styleUrl: './analyst-drilldown.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalystDrilldownComponent {
    appState = inject(AppState);
    private reportService = inject(ReportService);

    messages = computed(() => {
        const drill = this.appState.drillDownCluster();
        if (!drill) return [];
        return this.reportService.getClusterMessages(this.appState.timeframe(), drill.topicIndex);
    });
}
