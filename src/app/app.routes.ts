import { Routes } from '@angular/router';

export const routes: Routes = [
    { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    { path: 'dashboard', loadComponent: () => import('./features/main/main.component').then(m => m.MainComponent) },
    { path: 'how-it-works', loadComponent: () => import('./features/how-it-works/how-it-works.component').then(m => m.HowItWorksComponent) },
    { path: 'cost-comparison', loadComponent: () => import('./features/cost-comparison/cost-comparison.component').then(m => m.CostComparisonComponent) },
    { path: '**', redirectTo: 'dashboard' },
];
