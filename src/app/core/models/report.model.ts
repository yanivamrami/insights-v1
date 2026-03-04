import { Timeframe } from './message.model';

export interface Topic {
    id: string;
    label: string;
    messageCount: number;
    percentage: number;
    trend: 'up' | 'down' | 'new' | 'stable';
    sentimentScore: number;
    centroidMessageText: string;
}

export interface AuthorStat {
    author: string;
    initials: string;
    messageCount: number;
    volumeRank: number;
    influenceScore: number;
    influenceRank: number;
    colorIndex: number;
}

export interface Insight {
    type: 'alert' | 'warning' | 'info';
    icon: string;
    headline: string;
    body: string;
    timeLabel: string;
}

export interface Report {
    timeframe: Timeframe;
    totalMessages: number;
    cleanMessages: number;
    droppedMessages: number;
    activeAuthorCount: number;
    dateRangeLabel: string;
    hourlyActivity: number[];
    dailyActivity: number[];
    dataEndDayOfWeek: number; // JS getDay() of the latest message in this bucket (0=Sun…6=Sat)
    peakHour: string;
    volumeVsPrevious: number;
    tokensRaw: number;
    tokensFiltered: number;
    tokensPayload: number;
    authors: AuthorStat[];
    estimatedCostUsd: number;
    topics: Topic[] | null;
    overallSentimentScore: number | null;
    overallVibeEmoji: string | null;
    overallVibeLabel: string | null;
    overallVibeDescription: string | null;
    insights: Insight[] | null;
    summaryExec: string | null;
    summaryAnalyst: string | null;
}

export interface ReportCache {
    today: Report | null;
    yesterday: Report | null;
    '7days': Report | null;
    [key: string]: Report | null;
}
