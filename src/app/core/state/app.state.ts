import { Injectable, inject, signal, computed } from '@angular/core';
import { Timeframe, Audience } from '../models/message.model';
import { ReportService } from '../services/report.service';
import { Report } from '../models/report.model';

@Injectable({ providedIn: 'root' })
export class AppState {
    private reportService = inject(ReportService);

    readonly timeframe = signal<Timeframe>('today');
    readonly audience = signal<Audience>('clevel');

    readonly currentReport = computed<Report | null>(() =>
        this.reportService.reportCache()[this.timeframe()] ?? null
    );

    setTimeframe(tf: Timeframe): void {
        this.timeframe.set(tf);
        // Trigger lazy AI analysis for this timeframe if it hasn't been loaded yet
        this.reportService.analyzeTimeframe(tf);
    }
    setAudience(a: Audience): void { this.audience.set(a); }
}
