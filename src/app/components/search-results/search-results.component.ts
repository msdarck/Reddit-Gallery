import { CommonModule } from '@angular/common'
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
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
   * Rendered masonry columns used to read current rendered heights.
   */
  @ViewChildren('masonryColumn')
  private masonryColumns?: QueryList<ElementRef<HTMLDivElement>>

  /**
   * Sentinel elements at the bottom of each column. When any sentinel enters
   * the viewport, the next page is requested.
   */
  @ViewChildren('columnSentinel')
  private columnSentinels?: QueryList<ElementRef<HTMLDivElement>>

  /**
   * Observable used to inform loading state (still async-piped in template).
   */
  protected readonly loading$: Observable<boolean>

  private querySubscription?: Subscription
  private pageTypeSubscription?: Subscription
  private itemsPerRowSubscription?: Subscription
  private loadingSubscription?: Subscription
  private sentinelListSubscription?: Subscription
  private sentinelObserver?: IntersectionObserver

  /**
   * Holds the nextPage token from the latest query emission so the observer can use it.
   */
  private nextPage?: string

  /**
   * Prevents repeated observer callbacks from requesting the same page while
   * a next-page fetch is already in progress.
   */
  private isRequestingNextPage = false

  /**
   * Latest results kept so rows can be recomputed when itemsPerRow changes
   * without waiting for a new query emission.
   */
  private latestResults: IRedditResult[] = []

  /**
   * Pre-computed, height-balanced columns. Items are distributed in source
   * order to the currently shortest column to avoid large vertical gaps.
   */
  public resultColumns: IRedditResult[][] = []

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
   * Tracks whether there are any results to render.
   */
  public hasResults = false

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
      this.isRequestingNextPage = false
      const incomingResults = query?.results ?? []

      if (this.isAppendedResultSet(incomingResults)) {
        const newResults = incomingResults.slice(this.latestResults.length)
        this.appendResultsToBalancedColumns(newResults)
        this.latestResults = incomingResults
      } else {
        this.latestResults = incomingResults
        this.resultColumns = this.computeColumns(this.latestResults)
      }

      this.hasResults = this.latestResults.length > 0
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
        this.resultColumns = this.computeColumns(this.latestResults)
        this.hasResults = this.latestResults.length > 0
        this.cdr.markForCheck()
      })

    // Release the next-page request guard once loading ends so retries can occur
    // if a request fails before emitting new query results.
    this.loadingSubscription = this.loading$.subscribe(isLoading => {
      if (!isLoading) {
        this.isRequestingNextPage = false
      }
    })
  }

  /**
   * @inheritdoc
   * Sets up the IntersectionObserver after the view has initialised so the
   * sentinel element is guaranteed to be in the DOM.
   */
  public ngAfterViewInit(): void {
    this.attachSentinelObserver()

    this.sentinelListSubscription = this.columnSentinels?.changes.subscribe(() => {
      this.observeColumnSentinels()
    })
  }

  /**
   * @inheritdoc
   */
  public ngOnDestroy(): void {
    this.sentinelObserver?.disconnect()
    this.querySubscription?.unsubscribe()
    this.pageTypeSubscription?.unsubscribe()
    this.itemsPerRowSubscription?.unsubscribe()
    this.loadingSubscription?.unsubscribe()
    this.sentinelListSubscription?.unsubscribe()
  }

  /**
   * Creates an IntersectionObserver that fires whenever the sentinel div
   * enters the viewport, loading the next page of results.
   */
  private attachSentinelObserver(): void {
    if (!this.columnSentinels) return

    this.sentinelObserver = new IntersectionObserver(
      entries => {
        const hasVisibleSentinel = entries.some(entry => entry.isIntersecting)

        if (hasVisibleSentinel && this.nextPage && !this.isRequestingNextPage) {
          this.isRequestingNextPage = true
          this.redditService.setSubRedditPage(this.nextPage)
        }
      },
      {
        threshold: 0,
        rootMargin: '0px'
      }
    )

    this.observeColumnSentinels()
  }

  /**
   * Rebinds observation to the current column sentinel set.
   */
  private observeColumnSentinels(): void {
    if (!this.sentinelObserver || !this.columnSentinels) return

    this.sentinelObserver.disconnect()

    for (const sentinel of this.columnSentinels.toArray()) {
      this.sentinelObserver.observe(sentinel.nativeElement)
    }
  }

  /**
   * Scrolls the window back to the top.
   */
  public scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /**
   * Distributes items across N columns by always appending the next item
   * to the currently shortest column. This avoids row-based whitespace while
   * maintaining source-order insertion.
   */
  private computeColumns(results: IRedditResult[]): IRedditResult[][] {
    const columnCount = Math.max(
      this.minItemsPerRow,
      Math.min(this.itemsPerRow, this.maxItemsPerRow)
    )

    if (!results.length) {
      return Array.from({ length: columnCount }, () => [])
    }

    const columns: IRedditResult[][] = Array.from(
      { length: columnCount },
      () => []
    )
    const columnHeights = new Array<number>(columnCount).fill(0)

    for (const result of results) {
      let targetIndex = 0

      for (let i = 1; i < columnHeights.length; i++) {
        if (columnHeights[i] < columnHeights[targetIndex]) {
          targetIndex = i
        }
      }

      columns[targetIndex].push(result)
      columnHeights[targetIndex] += this.estimateItemHeight(result)
    }

    return columns
  }

  /**
   * Appends new results to the currently shortest rendered column so
   * long scrolling sessions remain balanced using real DOM heights.
   */
  private appendResultsToBalancedColumns(newResults: IRedditResult[]): void {
    if (!newResults.length) return

    const columnCount = Math.max(
      this.minItemsPerRow,
      Math.min(this.itemsPerRow, this.maxItemsPerRow)
    )

    if (!this.resultColumns.length || this.resultColumns.length !== columnCount) {
      this.resultColumns = this.computeColumns(this.latestResults.concat(newResults))
      return
    }

    const columnHeights = this.getRenderedColumnHeights(columnCount)

    for (const result of newResults) {
      let targetIndex = 0

      for (let i = 1; i < columnHeights.length; i++) {
        if (columnHeights[i] < columnHeights[targetIndex]) {
          targetIndex = i
        }
      }

      this.resultColumns[targetIndex].push(result)
      columnHeights[targetIndex] += this.estimateItemHeight(result)
    }
  }

  /**
   * Uses current DOM heights when available, falling back to estimated
   * heights from existing column content.
   */
  private getRenderedColumnHeights(columnCount: number): number[] {
    const rendered = this.masonryColumns?.toArray() ?? []

    if (rendered.length === columnCount) {
      return rendered.map(column => column.nativeElement.offsetHeight)
    }

    return this.resultColumns.map(column =>
      column.reduce((height, result) => height + this.estimateItemHeight(result), 0)
    )
  }

  /**
   * Determines whether incoming results are an append-only continuation
   * of the current list.
   */
  private isAppendedResultSet(incomingResults: IRedditResult[]): boolean {
    if (!this.latestResults.length) return false
    if (incomingResults.length <= this.latestResults.length) return false

    for (let i = 0; i < this.latestResults.length; i++) {
      if (incomingResults[i]?.id !== this.latestResults[i]?.id) {
        return false
      }
    }

    return true
  }

  /**
   * Estimates card height so column distribution remains visually balanced.
   */
  private estimateItemHeight(result: IRedditResult): number {
    const baseCardHeight = 120
    const image = result.preview?.images?.[0]?.source

    if (image?.width && image?.height) {
      const estimatedCardWidth = 320
      const mediaHeight = Math.min(384, (image.height / image.width) * estimatedCardWidth)
      return baseCardHeight + mediaHeight
    }

    if (result.is_gallery && result.gallery_data?.items?.length) {
      return baseCardHeight + 300
    }

    if (result.preview?.reddit_video_preview || result.secure_media_embed) {
      return baseCardHeight + 200
    }

    return baseCardHeight + 220
  }
}
