import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-method-badge',
  standalone: true,
  imports: [],
  template: `<span class="method-badge" [class]="type">{{ label }}</span>`,
  styles: [`
    .method-badge {
      font-family: var(--mono);
      font-size: 8px;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .ts  { background: rgba(59,130,246,0.1);  color: #3b82f6; border: 1px solid rgba(59,130,246,0.2); }
    .emb { background: rgba(167,139,250,0.1); color: #a78bfa; border: 1px solid rgba(167,139,250,0.2); }
    .ai  { background: rgba(0,212,255,0.08);  color: var(--accent); border: 1px solid rgba(0,212,255,0.18); }
  `],
})
export class MethodBadgeComponent {
  @Input() type: 'ts' | 'emb' | 'ai' = 'ts';

  get label(): string {
    return { ts: 'Pure TS', emb: 'Embeddings', ai: 'AI' }[this.type];
  }
}
