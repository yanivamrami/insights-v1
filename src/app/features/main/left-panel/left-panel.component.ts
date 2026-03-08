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

    tooltipText = signal<string | null>(null);
    tooltipX = signal(0);
    tooltipY = signal(0);

    showHint(text: string, event: MouseEvent): void {
        this.tooltipText.set(text);
        this.tooltipX.set(event.clientX);
        this.tooltipY.set(event.clientY);
    }
    moveHint(event: MouseEvent): void {
        this.tooltipX.set(event.clientX);
        this.tooltipY.set(event.clientY);
    }
    hideHint(): void { this.tooltipText.set(null); }

    readonly HINT_RAW =
        `Every message in the uploaded file, before any filtering.\n` +
        `Formula: (text chars + author chars + 15 overhead) ÷ 4 chars/token.\n` +
        `This is the worst-case token budget if no noise filtering were applied.`;

    readonly HINT_FILTERED =
        `Tokens remaining after noise removal — what the pipeline actually works with.\n` +
        `Noise dropped: bot messages, system notifications, very short messages (<3 words),\n` +
        `and duplicate texts. Same formula as Raw, applied to clean messages only.`;

    readonly HINT_PAYLOAD =
        `Tokens sent to the embedding API — text content only, no author or metadata overhead.\n` +
        `Formula: clean messages × 15 tok/msg  (avg 60 chars ÷ 4 chars/token).\n` +
        `Lower than After Filter because author names and per-message overhead are excluded.\n` +
        `This is the number that directly drives your embedding API cost.`;

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
