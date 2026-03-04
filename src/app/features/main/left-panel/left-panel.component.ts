import { Component, inject, HostListener, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReportService } from '../../../core/services/report.service';
import { AppState } from '../../../core/state/app.state';
import { MethodBadgeComponent } from '../../../shared/components/method-badge/method-badge.component';

@Component({
    selector: 'app-left-panel',
    standalone: true,
    imports: [MethodBadgeComponent, RouterLink],
    templateUrl: './left-panel.component.html',
    styleUrl: './left-panel.component.scss',
})
export class LeftPanelComponent {
    reportService = inject(ReportService);
    appState = inject(AppState);
    Math = Math;

    isDragOver = signal(false);
    fileError = signal<string | null>(null);

    @HostListener('dragover', ['$event'])
    onDragOver(e: DragEvent): void {
        e.preventDefault();
        this.isDragOver.set(true);
    }

    @HostListener('dragleave', ['$event'])
    onDragLeave(e: DragEvent): void {
        if (!(e.target as HTMLElement).closest('.upload-zone')) return;
        this.isDragOver.set(false);
    }

    @HostListener('drop', ['$event'])
    onDrop(e: DragEvent): void {
        e.preventDefault();
        this.isDragOver.set(false);
        const file = e.dataTransfer?.files[0];
        if (file) this.handleFile(file);
    }

    triggerUpload(input: HTMLInputElement): void {
        input.click();
    }

    onFileChange(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        // Reset so the same file can be re-uploaded and trigger change again
        input.value = '';
        if (file) this.handleFile(file);
    }

    handleFile(file: File): void {
        this.fileError.set(null);
        if (!file.name.endsWith('.json') && !file.name.endsWith('.txt')) {
            this.fileError.set('Unsupported file type. Please upload a .json (Telegram) or .txt (WhatsApp) export.');
            return;
        }
        this.reportService.analyzeFile(file);
    }

    get fileSizeKb(): string {
        return '';
    }

    get isLoaded(): boolean {
        const steps = this.reportService.pipelineSteps();
        return steps.length > 0 && steps.every(s => s.status === 'done');
    }

    get hasError(): boolean {
        return !!this.reportService.error();
    }

    get savingsPercent(): number {
        const r = this.appState.currentReport();
        if (!r || !r.tokensRaw) return 0;
        return Math.round((1 - r.tokensPayload / r.tokensRaw) * 100);
    }

    get filteredBarWidth(): string {
        const r = this.appState.currentReport();
        if (!r || !r.tokensRaw) return '70%';
        return `${Math.round((r.tokensFiltered / r.tokensRaw) * 100)}%`;
    }

    get payloadBarWidth(): string {
        const r = this.appState.currentReport();
        if (!r || !r.tokensRaw) return '8%';
        return `${Math.round((r.tokensPayload / r.tokensRaw) * 100)}%`;
    }

    formatNumber(n: number): string {
        return n.toLocaleString('en-US');
    }
}
