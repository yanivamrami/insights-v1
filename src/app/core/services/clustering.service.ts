import { Injectable } from '@angular/core';
import { Message } from '../models/message.model';

export interface Cluster {
    id: number;
    messages: Message[];
    centroidMessage: Message;
    centroidVector: number[];
}

/** Serialised cluster shape returned by the clustering.worker */
interface RawCluster {
    centroidVector: number[];
    centroidMessageId: string;
    messageIds: string[];
}

@Injectable({ providedIn: 'root' })
export class ClusteringService {

    /**
     * Async version of kMeans — runs the full clustering pipeline in a Web Worker
     * so the main thread (and Angular change detection) remains unblocked.
     */
    kMeansAsync(msgs: Message[]): Promise<Cluster[]> {
        const withEmb = msgs.filter(m => m.embedding?.length);
        if (!withEmb.length) return Promise.resolve([]);

        return new Promise((resolve, reject) => {
            const worker = new Worker(new URL('./clustering.worker', import.meta.url), { type: 'module' });

            // Serialise only what the worker needs
            const rawMsgs = withEmb.map(m => ({
                id: m.id,
                embedding: m.embedding!,
                text: m.text,
                author: m.author,
                timestamp: m.timestamp.getTime(),
            }));

            worker.onmessage = ({ data }: MessageEvent<{ clusters?: RawCluster[]; error?: string }>) => {
                worker.terminate();
                if (data.error) { reject(new Error(data.error)); return; }

                // Rebuild full Cluster objects from serialised result
                const msgById = new Map(withEmb.map(m => [m.id, m]));
                const clusters: Cluster[] = (data.clusters ?? []).map((rc, i) => {
                    const messages = rc.messageIds.map(id => msgById.get(id)!).filter(Boolean);
                    const centroidMessage = msgById.get(rc.centroidMessageId) ?? messages[0];
                    return { id: i, messages, centroidMessage, centroidVector: rc.centroidVector };
                });
                resolve(clusters);
            };

            worker.onerror = (err) => { worker.terminate(); reject(err); };
            worker.postMessage({ msgs: rawMsgs });
        });
    }

}
