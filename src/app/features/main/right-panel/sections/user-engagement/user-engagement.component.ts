import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Report, AuthorStat } from '../../../../../core/models/report.model';

@Component({
    selector: 'app-user-engagement',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './user-engagement.component.html',
    styleUrl: './user-engagement.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserEngagementComponent {
    @Input({ required: true }) report!: Report;

    get byVolume(): AuthorStat[] {
        return [...this.report.authors]
            .sort((a, b) => b.messageCount - a.messageCount)
            .slice(0, 5);
    }

    get byInfluence(): AuthorStat[] {
        return [...this.report.authors]
            .sort((a, b) => b.influenceScore - a.influenceScore)
            .slice(0, 5);
    }

    initials(name: string): string {
        return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
    }
}
