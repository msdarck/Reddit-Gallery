import { CommonModule } from '@angular/common'
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject
} from '@angular/core'
import { Observable, Subscription } from 'rxjs'
import { LoaderService } from 'src/services/loader/loader.service'
import { RedditService } from 'src/services/reddit/reddit.service'
import { IRedditResult } from '../../models/reddit.model'
import { MediaComponent } from '../media/media.component'
import { SubFilterComponent } from '../sub-filter/sub-filter.component'

/**
 * Displays the search result for the specified Reddit page.
 */
@Component({
  selector: 'app-search-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaComponent, CommonModule, SubFilterComponent],
  templateUrl: './search-results.component.html'
})
export class SearchResultsComponent implements OnInit, AfterViewInit, OnDestroy {
  /**
   * Injected Reddit service for managing page types and subreddit names.
   */
  private readonly redditService = inject(RedditService)

  /**
   * Injected Loader service for managing loading state.
   */
  private readonly loaderService = inject(LoaderService)

  /**
   * Injected ChangeDetectorRef for manually triggering change detection when needed.
   */
  private readonly cdr = inject(ChangeDetectorRef)

  /**
   * Sentinel element at the bottom of the list; observed to trigger next-page loading.
   */
  @ViewChild('scrollSentinel')
  private scrollSentinel?: ElementRef<HTMLDivElement>

  /**
   * Observable used to inform loading state (still async-piped in template).
   */
  protected readonly loading$: Observable<boolean>

  private querySubscription?: Subscription
  private pageTypeSubscription?: Subscription
  private itemsPerRowSubscription?: Subscription
  private sentinelObserver?: IntersectionObserver

  /**
   * Holds the nextPage token from the latest query emission so the observer can use it.
   */
  private nextPage?: string

  /**
   * Latest results kept so rows can be recomputed when itemsPerRow changes
   * without waiting for a new query emission.
   */
  private latestResults: IRedditResult[] = []

  /**
   * Pre-computed rows — updated only when results or itemsPerRow change,
   * preventing re-computation on every change-detection cycle.
   */
  public resultRows: IRedditResult[][] = []

  /**
   * Pre-computed CSS grid-template-columns string — updated only when
   * itemsPerRow changes, not on every CD cycle.
   */
  public gridTemplateColumns = 'repeat(2, minmax(0, 1fr))'

  /**
   * Becomes true after the first query emission so the results section is shown.
   */
  public hasQuery = false

  /**
   * The active Reddit page type, subscribed to once here and passed into each
   * <app-media> card as an @Input to avoid creating a per-card subscription.
   */
  public activePageType = ''

  /**
   * The number of posts rendered per row.
   */
  public itemsPerRow = 2

  /**
   * Lower bound for the row-size input.
   */
  public readonly minItemsPerRow = 1

  /**
   * Upper bound for the row-size input.
   */
  public readonly maxItemsPerRow = 6

  /**
   * @inheritdoc
   */
  public constructor() {
    this.loading$ = this.loaderService.getLoading()
  }

  /**
   * @inheritdoc
   */
  public ngOnInit(): void {
    // Subscribe to query updates and precompute rows on each emission so the
    // template reads a plain array instead of calling a method on every CD cycle.
    this.querySubscription = this.redditService.getQuery().subscribe(query => {
      this.hasQuery = true
      this.nextPage = query?.nextPage
      this.latestResults = query?.results ?? []
      this.resultRows = this.computeRows(this.latestResults)
      this.cdr.markForCheck()
    })

    // Subscribe once here so every media card doesn't create its own subscription.
    this.pageTypeSubscription = this.redditService
      .getRedditPageType()
      .subscribe(type => {
        this.activePageType = type
        this.cdr.markForCheck()
      })

    this.itemsPerRowSubscription = this.redditService
      .getItemsPerRow()
      .subscribe(items => {
        this.itemsPerRow = items
        this.gridTemplateColumns = `repeat(${this.itemsPerRow}, minmax(0, 1fr))`
        this.resultRows = this.computeRows(this.latestResults)
        this.cdr.markForCheck()
      })
  }

  /**
   * @inheritdoc
   * Sets up the IntersectionObserver after the view has initialised so the
   * sentinel element is guaranteed to be in the DOM.
   */
  public ngAfterViewInit(): void {
    this.attachSentinelObserver()
  }

  /**
   * @inheritdoc
   */
  public ngOnDestroy(): void {
    this.sentinelObserver?.disconnect()
    this.querySubscription?.unsubscribe()
    this.pageTypeSubscription?.unsubscribe()
    this.itemsPerRowSubscription?.unsubscribe()
  }

  /**
   * Creates an IntersectionObserver that fires whenever the sentinel div
   * enters the viewport, loading the next page of results.
   */
  private attachSentinelObserver(): void {
    if (!this.scrollSentinel) return

    this.sentinelObserver = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        if (entry.isIntersecting && this.nextPage) {
          this.redditService.setSubRedditPage(this.nextPage)
        }
      },
      { threshold: 0.1 }
    )

    this.sentinelObserver.observe(this.scrollSentinel.nativeElement)
  }

  /**
   * Scrolls the window back to the top.
   */
  public scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /**
   * Groups the current results into rows of itemsPerRow width.
   * Called only when results or itemsPerRow change — never from the template.
   */
  private computeRows(results: IRedditResult[]): IRedditResult[][] {
    const rows: IRedditResult[][] = []
    for (let i = 0; i < results.length; i += this.itemsPerRow) {
      rows.push(results.slice(i, i + this.itemsPerRow))
    }
    return rows
  }
}
