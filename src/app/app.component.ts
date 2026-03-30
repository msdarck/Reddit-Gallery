import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { FilterComponent } from './components/filter/filter.component'
import { NavbarComponent } from './components/navbar/navbar.component'
import { SafeModeComponent } from './components/safe-mode/safe-mode.component'
import { SearchResultsComponent } from './components/search-results/search-results.component'
import { SearchComponent } from './components/search/search.component'

/**
 * The primary application access point.
 */
@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    NavbarComponent,
    SearchComponent,
    SearchResultsComponent,
    FilterComponent,
    SafeModeComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit {
  public readonly title = 'reddit-gallery'

  /**
   * Highlight where users can find more information.
   */
  public ngOnInit() {
    console.log(
      `[${this.title}] Started`
    )
  }
}
