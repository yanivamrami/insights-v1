import { Injectable } from '@angular/core';
import { Message } from '../../models/message.model';
import { IParser } from './parser.interface';

// Bracket format: [DD/MM/YYYY, HH:MM:SS] Author: text
// Dash format:   DD/MM/YYYY, HH:MM - Author: text   (also handles M/D/YY)
const BRACKET_RE = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]\s*([^:]+):\s*(.+)$/i;
const DASH_RE = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\s*-\s*([^:]+):\s*(.+)$/i;

@Injectable({ providedIn: 'root' })
export class WhatsAppParser implements IParser {
    canParse(fileName: string): boolean {
        return fileName.toLowerCase().endsWith('.txt');
    }

    parse(content: string): Message[] {
        const lines = content.split('\n');
        const result: Message[] = [];
        let counter = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const match = BRACKET_RE.exec(trimmed) ?? DASH_RE.exec(trimmed);
            if (!match) continue;

            const [, datePart, timePart, author, text] = match;
            const timestamp = this.parseDateTime(datePart, timePart);

            result.push({
                id: `wa-${counter++}`,
                timestamp,
                author: author.trim(),
                text: text.trim(),
                source: 'whatsapp',
            });
        }

        return result;
    }

    private parseDateTime(datePart: string, timePart: string): Date {
        const [d, m, y] = datePart.split('/').map(Number);
        const fullYear = y < 100 ? 2000 + y : y;

        // Normalise time: "3:45 PM" → 24h
        const timeNorm = timePart.replace(/\s+/g, ' ').trim();
        const pmMatch = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i.exec(timeNorm);
        let hour = 0, minute = 0;

        if (pmMatch) {
            hour = parseInt(pmMatch[1], 10);
            minute = parseInt(pmMatch[2], 10);
            const period = pmMatch[3].toUpperCase();
            if (period === 'PM' && hour !== 12) hour += 12;
            if (period === 'AM' && hour === 12) hour = 0;
        } else {
            const plain = /(\d{1,2}):(\d{2})/.exec(timeNorm);
            if (plain) { hour = parseInt(plain[1], 10); minute = parseInt(plain[2], 10); }
        }

        return new Date(fullYear, m - 1, d, hour, minute, 0);
    }
}
