import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthorStat } from '../../../../../core/models/report.model';
import { AppState } from '../../../../../core/state/app.state';
import { ReportService } from '../../../../../core/services/report.service';

@Component({
    selector: 'app-user-engagement',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './user-engagement.component.html',
    styleUrl: './user-engagement.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserEngagementComponent {
    private appState = inject(AppState);
    protected reportService = inject(ReportService);

    get report() { return this.appState.currentReport(); }

    get byVolume(): AuthorStat[] {
        const authors = this.report?.authors;
        if (!authors?.length) return [];
        return [...authors].sort((a, b) => b.messageCount - a.messageCount).slice(0, 5);
    }

    get byInfluence(): AuthorStat[] {
        const authors = this.report?.authors;
        if (!authors?.length) return [];
        return [...authors].sort((a, b) => b.influenceScore - a.influenceScore).slice(0, 5);
    }

    initials(name: string): string {
        return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
    }
}
