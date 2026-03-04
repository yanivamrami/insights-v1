import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AppState } from '../../../core/state/app.state';
import { Audience } from '../../../core/models/message.model';

@Component({
    selector: 'app-header',
    standalone: true,
    imports: [RouterLink, RouterLinkActive],
    templateUrl: './header.component.html',
    styleUrl: './header.component.scss',
})
export class HeaderComponent {
    appState = inject(AppState);

    setAudience(a: Audience): void {
        this.appState.setAudience(a);
    }
}
