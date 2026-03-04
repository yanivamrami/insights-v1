import { Component, Input, OnDestroy, OnChanges, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { Report } from '../../../../../core/models/report.model';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { SectionHelpComponent } from '../../../../../shared/components/section-help/section-help.component';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

@Component({
    selector: 'app-activity-pulse',
    standalone: true,
    imports: [SectionHelpComponent],
    templateUrl: './activity-pulse.component.html',
    styleUrl: './activity-pulse.component.scss',
})
export class ActivityPulseComponent implements AfterViewInit, OnChanges, OnDestroy {
    @Input() report!: Report;
    @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
    private chart: Chart | null = null;

    ngAfterViewInit(): void {
        this.buildChart();
    }

    ngOnChanges(): void {
        if (this.chart) this.updateChart();
    }

    ngOnDestroy(): void {
        this.chart?.destroy();
    }

    private getLabels(): string[] {
        if (this.report?.timeframe === '7days') {
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            // Convert JS getDay() (0=Sun) to Mon-indexed (0=Mon) to match the days array
            const monIdx = ((this.report.dataEndDayOfWeek ?? new Date().getDay()) + 6) % 7;
            return Array.from({ length: 7 }, (_, i) => days[(monIdx - 6 + i + 7) % 7]);
        }
        return Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
    }

    private getData(): number[] {
        if (!this.report) return new Array(24).fill(0);
        return this.report.timeframe === '7days' ? this.report.dailyActivity : this.report.hourlyActivity;
    }

    private buildChart(): void {
        if (!this.chartCanvas) return;
        this.chart = new Chart(this.chartCanvas.nativeElement, {
            type: 'bar',
            data: {
                labels: this.getLabels(),
                datasets: [{
                    data: this.getData(),
                    backgroundColor: 'rgba(0,212,255,0.2)',
                    borderColor: 'rgba(0,212,255,0.7)',
                    borderWidth: 1,
                    borderRadius: 3,
                    hoverBackgroundColor: 'rgba(0,212,255,0.45)',
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: { label: ctx => ctx.parsed.y + ' msgs' },
                        backgroundColor: '#1a2235',
                        borderColor: '#1e2d45',
                        borderWidth: 1,
                        titleColor: '#e2e8f0',
                        bodyColor: '#64748b',
                        titleFont: { family: "'IBM Plex Mono'" },
                        bodyFont: { family: "'IBM Plex Mono'" },
                    },
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(30,45,69,0.5)' },
                        ticks: { color: '#64748b', font: { family: "'IBM Plex Mono'", size: 9 }, maxTicksLimit: 12 },
                    },
                    y: {
                        grid: { color: 'rgba(30,45,69,0.5)' },
                        ticks: { color: '#64748b', font: { family: "'IBM Plex Mono'", size: 9 } },
                    },
                },
            },
        });
    }

    private updateChart(): void {
        if (!this.chart) return;
        this.chart.data.labels = this.getLabels();
        this.chart.data.datasets[0].data = this.getData();
        this.chart.update();
    }

    get vsYesterdayClass(): string {
        if (!this.report) return '';
        return this.report.volumeVsPrevious > 0 ? 'green' : this.report.volumeVsPrevious < 0 ? 'red' : '';
    }
}
