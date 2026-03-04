import { Component, Input, signal, HostListener } from '@angular/core';

@Component({
    selector: 'app-section-help',
    standalone: true,
    templateUrl: './section-help.component.html',
    styleUrl: './section-help.component.scss',
})
export class SectionHelpComponent {
    @Input({ required: true }) title!: string;
    @Input({ required: true }) content!: string;
    @Input() popupUp = false;

    get formattedContent(): string {
        return this.content.replace(/\\n/g, '\n');
    }

    open = signal(false);

    toggle(event: MouseEvent): void {
        event.stopPropagation();
        this.open.update(v => !v);
    }

    close(): void {
        this.open.set(false);
    }

    @HostListener('document:keydown.escape')
    onEscape(): void {
        this.open.set(false);
    }
}
