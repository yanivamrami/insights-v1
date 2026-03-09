import { Injectable } from '@angular/core';
import { Message, Timeframe } from '../models/message.model';
import { AuthorStat } from '../models/report.model';

const NOISE_PATTERNS = [
    /^<media omitted>$/i,
    /^image omitted$/i,
    /^audio omitted$/i,
    /^video omitted$/i,
    /^sticker omitted$/i,
    /^document omitted$/i,
    /^GIF omitted$/i,
    /^Contact card omitted$/i,
    /^This message was deleted$/i,
    /^You deleted this message$/i,
    /created group/i,
    /joined using this group's invite link/i,
    /changed the group/i,
    /added .+$/i,
    /removed .+$/i,
    /left$/i,
    /changed their phone number/i,
    /^null$/i,
];

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
    private readonly monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    filterNoise(msgs: Message[]): { clean: Message[]; dropped: number } {
        const clean = msgs.filter(m => {
            const t = m.text.trim();
            // Drop short noise (< 3 words)
            if (t.split(/\s+/).filter(w => w.length > 0).length < 3) return false;
            // Drop known system / media patterns
            for (const p of NOISE_PATTERNS) { if (p.test(t)) return false; }
            return true;
        });
        return { clean, dropped: msgs.length - clean.length };
    }

    bucketByTimeframe(msgs: Message[]): Record<Timeframe, Message[]> {
        if (!msgs.length) return { today: [], yesterday: [], '7days': [] };
        // Anchor to the latest message date in the dataset (not wall-clock),
        // so sample files with old timestamps are bucketed correctly.
        const maxTs = msgs.reduce((max, m) => m.timestamp > max ? m.timestamp : max, msgs[0].timestamp);
        const refDay = new Date(maxTs.getFullYear(), maxTs.getMonth(), maxTs.getDate());
        const yestStart = new Date(refDay.getTime() - 86400000);
        const sevenStart = new Date(refDay.getTime() - 6 * 86400000);

        return {
            today: msgs.filter(m => m.timestamp >= refDay),
            yesterday: msgs.filter(m => m.timestamp >= yestStart && m.timestamp < refDay),
            '7days': msgs.filter(m => m.timestamp >= sevenStart),
        };
    }

    getHourlyActivity(msgs: Message[]): number[] {
        const counts = new Array<number>(24).fill(0);
        for (const m of msgs) counts[m.timestamp.getHours()]++;
        return counts;
    }

    getDailyActivity(msgs: Message[]): number[] {
        const counts = new Array<number>(7).fill(0);
        if (!msgs.length) return counts;
        const maxTs = msgs.reduce((max, m) => m.timestamp > max ? m.timestamp : max, msgs[0].timestamp);
        // Normalize to local calendar midnight so UTC-parsed timestamps don't cause off-by-one
        const refDate = new Date(maxTs.getFullYear(), maxTs.getMonth(), maxTs.getDate());
        for (const m of msgs) {
            const msgDate = new Date(m.timestamp.getFullYear(), m.timestamp.getMonth(), m.timestamp.getDate());
            const diffDays = Math.round((refDate.getTime() - msgDate.getTime()) / 86400000);
            const idx = 6 - diffDays;
            if (idx >= 0 && idx < 7) counts[idx]++;
        }
        return counts;
    }

    getPeakHour(hourly: number[]): string {
        const idx = hourly.indexOf(Math.max(...hourly));
        return `${String(idx).padStart(2, '0')}:00`;
    }

    getVolumeVsPrevious(curr: Message[], prev: Message[]): number {
        if (!prev.length) return 0;
        return Math.round(((curr.length - prev.length) / prev.length) * 100);
    }

    getAuthorStats(msgs: Message[]): AuthorStat[] {
        const countMap = new Map<string, number>();
        const influenceMap = new Map<string, number>();

        for (const m of msgs) countMap.set(m.author, (countMap.get(m.author) ?? 0) + 1);

        // Influence: count how many times a message triggers a reply from a different author
        // within the next 1-3 messages in a 5-minute window
        for (let i = 0; i < msgs.length; i++) {
            const current = msgs[i];
            const window5m = current.timestamp.getTime() + 5 * 60 * 1000;
            let triggered = false;
            for (let j = i + 1; j < Math.min(i + 4, msgs.length); j++) {
                if (msgs[j].timestamp.getTime() > window5m) break;
                if (msgs[j].author !== current.author) { triggered = true; break; }
            }
            if (triggered) influenceMap.set(current.author, (influenceMap.get(current.author) ?? 0) + 1);
        }

        const authors = Array.from(countMap.keys());
        const sorted = [...authors].sort((a, b) => (countMap.get(b) ?? 0) - (countMap.get(a) ?? 0));
        const infSorted = [...authors].sort((a, b) => (influenceMap.get(b) ?? 0) - (influenceMap.get(a) ?? 0));

        return sorted.map((author, idx) => ({
            author,
            initials: author.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join(''),
            messageCount: countMap.get(author) ?? 0,
            volumeRank: idx + 1,
            influenceScore: influenceMap.get(author) ?? 0,
            influenceRank: infSorted.indexOf(author) + 1,
            colorIndex: (idx % 5) + 1,
        }));
    }

    getDateRangeLabel(msgs: Message[]): string {
        if (!msgs.length) return '—';
        const dates = msgs.map(m => m.timestamp);
        const min = new Date(Math.min(...dates.map(d => d.getTime())));
        const max = new Date(Math.max(...dates.map(d => d.getTime())));
        const monthNames = this.monthNames;
        if (min.getMonth() === max.getMonth() && min.getFullYear() === max.getFullYear()) {
            return `${min.getDate()}–${max.getDate()} ${monthNames[min.getMonth()]}`;
        }
        return `${min.getDate()} ${monthNames[min.getMonth()]} – ${max.getDate()} ${monthNames[max.getMonth()]}`;
    }

    estimateTokens(msgs: Message[]): number {
        const totalChars = msgs.reduce((sum, m) => sum + m.text.length + m.author.length + 15, 0);
        return Math.round(totalChars / 4);
    }
}
