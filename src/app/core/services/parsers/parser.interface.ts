import { Message } from '../../models/message.model';

export interface IParser {
    canParse(fileName: string): boolean;
    parse(content: string): Message[];
}
