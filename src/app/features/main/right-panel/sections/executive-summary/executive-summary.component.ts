import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { Report } from '../../../../../core/models/report.model';
import { AppState } from '../../../../../core/state/app.state';

@Component({
    selector: 'app-executive-summary',
    standalone: true,
    imports: [],
    templateUrl: './executive-summary.component.html',
    styleUrl: './executive-summary.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutiveSummaryComponent {
    @Input({ required: true }) report!: Report;

    appState = inject(AppState);

    get isCLevel(): boolean {
        return this.appState.audience() === 'clevel';
    }

    get summaryText(): string | null {
        return this.isCLevel ? this.report.summaryExec : this.report.summaryAnalyst;
    }
}
