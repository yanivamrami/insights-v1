import { Component } from '@angular/core';
import { LeftPanelComponent } from './left-panel/left-panel.component';
import { RightPanelComponent } from './right-panel/right-panel.component';

@Component({
    selector: 'app-main',
    standalone: true,
    imports: [LeftPanelComponent, RightPanelComponent],
    templateUrl: './main.component.html',
    styleUrl: './main.component.scss',
})
export class MainComponent { }
