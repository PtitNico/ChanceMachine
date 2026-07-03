import { Component } from '@angular/core';
import { OddsCalculator } from './odds-calculator/odds-calculator';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [OddsCalculator],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
