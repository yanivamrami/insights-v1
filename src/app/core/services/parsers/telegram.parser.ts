import { Injectable } from '@angular/core';
import { Message } from '../../models/message.model';
import { IParser } from './parser.interface';

interface TelegramTextEntity { text: string; type?: string; }
type TelegramText = string | TelegramTextEntity[];

interface TelegramMessage {
    id?: number;
    type?: string;
    date?: string;
    from?: string;
    actor?: string;
    text?: TelegramText;
}

interface TelegramExport {
    messages?: TelegramMessage[];
}

@Injectable({ providedIn: 'root' })
export class TelegramParser implements IParser {
    canParse(fileName: string): boolean {
        return fileName.toLowerCase().endsWith('.json');
    }

    parse(content: string): Message[] {
        let data: TelegramExport;
        try {
            data = JSON.parse(content) as TelegramExport;
        } catch {
            throw new Error('Invalid Telegram JSON export');
        }

        const messages = data.messages ?? [];
        const result: Message[] = [];

        for (const m of messages) {
            if (m.type !== 'message') continue;

            const text = this.extractText(m.text);
            if (!text.trim()) continue;

            const author = m.from ?? m.actor ?? 'Unknown';
            const timestamp = m.date ? new Date(m.date) : new Date();

            result.push({
                id: String(m.id ?? Math.random()),
                timestamp,
                author,
                text,
                source: 'telegram',
            });
        }

        return result;
    }

    private extractText(text: TelegramText | undefined): string {
        if (!text) return '';
        if (typeof text === 'string') return text;
        return text.map(e => (typeof e === 'string' ? e : e.text ?? '')).join('');
    }
}
