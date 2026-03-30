import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject
} from '@angular/core'
import { CommonModule } from '@angular/common'
import {
  IRedditResult,
  RedditPageType,
  RedditPostHint,
  VideoPlatform
} from 'src/app/models/reddit.model'
import { TrustResourcePipe } from 'src/app/pipes/trust-resource/trust-resource.pipe'
import { RedditService } from 'src/services/reddit/reddit.service'
import { GalleryComponent } from '../gallery/gallery.component'

/**
 * Displays image/video content along with any additional details
 * such as thumbnails/titles/etc.
 */
@Component({
  selector: 'app-media',
  imports: [
    CommonModule,
    TrustResourcePipe,
    GalleryComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media.component.html'
})
export class MediaComponent {
  /**
   * Injected Reddit service for managing page types and subreddit names.
   */
  private readonly redditService = inject(RedditService)

  /**
   * @inheritdoc
   */
  protected readonly redditPageType = RedditPageType

  /**
   * @inheritdoc
   *
   * Used to check against the post hint so the client knows how to render
   * each specific bit of content. For example if it's rich:video we need to
   * use an iframe, whereas for images we need to use an img element.
   */
  protected readonly redditPostHint = RedditPostHint

  /**
   * Video platform types for template usage
   */
  protected readonly videoPlatform = VideoPlatform

  /**
   * The content object from Reddit.
   * For more details {@see IRedditResult}.
   */
  private _content?: IRedditResult

  @Input()
  public get content(): IRedditResult | undefined {
    return this._content
  }

  public set content(value: IRedditResult | undefined) {
    this._content = value
    this.syncDerivedMediaState(value)
  }

  /**
   * The active Reddit page type passed in from the parent search-results
   * component. Avoids creating an RxJS subscription inside every card.
   */
  @Input()
  public activePageType?: string

  /**
   * The image source to display.
   */
  public imageSrc?: string

  /**
   * Intrinsic dimensions used to reserve layout space before image load.
   */
  public imageWidth?: number
  public imageHeight?: number

  /**
   * CSS aspect-ratio value used by the image container to reduce CLS.
   */
  public imageAspectRatio = '1 / 1'

  /**
   * CSS aspect-ratio for video containers, computed from media metadata.
   */
  public videoAspectRatio = '16 / 9'

  /**
   * The inherited content row size. This is used to ensure that
   * media items take up as much as space as their parent container.
   */
  @Input()
  public size?: number

  /**
   * Video platform computed once in ngOnChanges so the template never
   * calls getVideoPlatform() on every change-detection cycle.
   */
  public computedVideoPlatform?: VideoPlatform

  /**
   * Embed URL computed once in ngOnChanges, paired with computedVideoPlatform.
   */
  public computedVideoEmbedUrl?: string | null

  /**
   * Updates cached image/video state whenever content is set.
   */
  private syncDerivedMediaState(content?: IRedditResult): void {
    this.imageSrc = content?.url

    if (content) {
      this.computeImageDimensions(content)
      this.computeVideoData(content)
      return
    }

    this.imageWidth = undefined
    this.imageHeight = undefined
    this.imageAspectRatio = '1 / 1'
    this.videoAspectRatio = '16 / 9'
    this.computedVideoPlatform = undefined
    this.computedVideoEmbedUrl = undefined
  }

  /**
   * Precomputes intrinsic image dimensions from Reddit preview metadata so
   * the browser can reserve space before the image finishes loading.
   */
  private computeImageDimensions(content: IRedditResult): void {
    const source = content.preview?.images?.[0]?.source

    if (source?.width && source?.height) {
      this.imageWidth = source.width
      this.imageHeight = source.height
      this.imageAspectRatio = `${source.width} / ${source.height}`
      return
    }

    this.imageWidth = undefined
    this.imageHeight = undefined
    this.imageAspectRatio = '1 / 1'
  }

  /**
   * Computes both the video platform and embed URL in a single pass so
   * getVideoPlatform() is only called once per content change.
   */
  private computeVideoData(content: IRedditResult): void {
    this.videoAspectRatio = this.getVideoAspectRatio(content)

    const platform = this.getVideoPlatform(content)
    this.computedVideoPlatform = platform

    switch (platform) {
      case VideoPlatform.YOUTUBE:
        this.computedVideoEmbedUrl = this.getYouTubeEmbedUrl(content)
        break
      case VideoPlatform.TWITCH:
        this.computedVideoEmbedUrl = this.getTwitchEmbedUrl(content)
        break
      default:
        this.computedVideoEmbedUrl =
          content.secure_media_embed?.media_domain_url || null
    }
  }

  /**
   * Computes the best available video aspect ratio from content metadata.
   */
  private getVideoAspectRatio(content: IRedditResult): string {
    const redditVideo = content.preview?.reddit_video_preview
    if (redditVideo?.width && redditVideo?.height) {
      return `${redditVideo.width} / ${redditVideo.height}`
    }

    const embedWidth = content.secure_media_embed?.width
    const embedHeight = content.secure_media_embed?.height
    if (embedWidth && embedHeight) {
      return `${embedWidth} / ${embedHeight}`
    }

    const oembedWidth = content.secure_media?.oembed?.width
    const oembedHeight = content.secure_media?.oembed?.height
    if (oembedWidth && oembedHeight) {
      return `${oembedWidth} / ${oembedHeight}`
    }

    return '16 / 9'
  }

  /**
   * If the image fails to load, we can use the thumbnail as a fallback if it exists.
   */
  public onImageError(): void {
    if (this.content?.thumbnail) {
      this.imageSrc = this.content.thumbnail
    }
  }

  /**
   * Switches the current page type to the selected one.
   * When a user clicks the button they can view more content from the user or subreddit.
   */
  public viewMore(pageType: RedditPageType, author: string): void {
    // Scrolls the user to the top as the feed is being reset.
    window.scrollTo(0, 0)

    this.redditService.setRedditPageType(pageType)
    this.redditService.setSubRedditName(author)
  }

  /**
   * Detects the video platform type from Reddit content
   */
  public getVideoPlatform(content: IRedditResult): VideoPlatform {
    if (!content) return VideoPlatform.OTHER

    const domain = content.domain || ''
    const secure_media_type = content.secure_media?.type || ''

    /**
     * YouTube detection
     */
    if (
      domain.includes('youtube.com') ||
      domain.includes('youtu.be') ||
      secure_media_type.includes('youtube')
    ) {
      return VideoPlatform.YOUTUBE
    }

    /**
     * Twitch detection
     */
    if (
      domain.includes('twitch.tv') ||
      secure_media_type.includes('twitch') ||
      (content.secure_media_embed?.content || '').includes('twitch')
    ) {
      return VideoPlatform.TWITCH
    }

    return VideoPlatform.OTHER
  }

  /**
   * Extracts YouTube video ID and returns proper embed URL
   */
  private getYouTubeEmbedUrl(content: IRedditResult): string | null {
    const videoId = this.extractYouTubeId(content)
    if (!videoId) return null

    return `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0&modestbranding=1`
  }

  /**
   * Extracts Twitch video/clip ID and returns proper embed URL
   */
  private getTwitchEmbedUrl(content: IRedditResult): string | null {
    const { clipId, videoId, channelName } = this.extractTwitchInfo(content)

    if (clipId) {
      return `https://clips.twitch.tv/embed?clip=${clipId}&parent=${window.location.hostname}&autoplay=false`
    } else if (videoId) {
      return `https://player.twitch.tv/?video=${videoId}&parent=${window.location.hostname}&autoplay=false`
    } else if (channelName) {
      return `https://player.twitch.tv/?channel=${channelName}&parent=${window.location.hostname}&autoplay=false`
    }

    return null
  }

  /**
   * Extracts YouTube video ID from various URL formats
   */
  private extractYouTubeId(content: IRedditResult): string | null {
    /**
     * Try to extract from URL
     */
    if (content.url) {
      const urlMatch = content.url.match(
        /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i
      )
      if (urlMatch && urlMatch[1]) {
        return urlMatch[1]
      }
    }

    /**
     * Try to extract from embed HTML
     */
    if (content.secure_media?.oembed?.html) {
      const embedMatch = content.secure_media.oembed.html.match(
        /youtube\.com\/embed\/([^"&?/\s]{11})/i
      )
      if (embedMatch && embedMatch[1]) {
        return embedMatch[1]
      }
    }

    return null
  }

  /**
   * Extracts Twitch video/clip ID or channel name from content
   */
  private extractTwitchInfo(content: IRedditResult): {
    clipId?: string
    videoId?: string
    channelName?: string
  } {
    const result: { clipId?: string; videoId?: string; channelName?: string } = {}

    /**
     * Extract from URL
     */
    if (content.url) {
      /**
       * Check for clips - fixed escapes
       */
      const clipMatch =
        content.url.match(/twitch\.tv\/\w+\/clip\/([a-zA-Z0-9_-]+)/i) ||
        content.url.match(/clips\.twitch\.tv\/([a-zA-Z0-9_-]+)/i)
      if (clipMatch && clipMatch[1]) {
        result.clipId = clipMatch[1]
        return result
      }

      /**
       * Check for videos - fixed escapes
       */
      const videoMatch = content.url.match(/twitch\.tv\/videos\/(\d+)/i)
      if (videoMatch && videoMatch[1]) {
        result.videoId = videoMatch[1]
        return result
      }

      /**
       * Check for channels - fixed escapes
       */
      const channelMatch = content.url.match(/twitch\.tv\/([a-zA-Z0-9_]+)$/i)
      if (channelMatch && channelMatch[1]) {
        result.channelName = channelMatch[1]
        return result
      }
    }

    /**
     * Extract from embed HTML if direct URL extraction fails
     */
    if (content.secure_media?.oembed?.html) {
      const html = content.secure_media.oembed.html

      /**
       * Try to extract clip ID
       */
      const clipEmbedMatch = html.match(/clip=([a-zA-Z0-9_-]+)/i)
      if (clipEmbedMatch && clipEmbedMatch[1]) {
        result.clipId = clipEmbedMatch[1]
        return result
      }

      /**
       * Try to extract video ID
       */
      const videoEmbedMatch = html.match(/video=(\d+)/i)
      if (videoEmbedMatch && videoEmbedMatch[1]) {
        result.videoId = videoEmbedMatch[1]
        return result
      }

      /**
       * Try to extract channel name
       */
      const channelEmbedMatch = html.match(/channel=([a-zA-Z0-9_]+)/i)
      if (channelEmbedMatch && channelEmbedMatch[1]) {
        result.channelName = channelEmbedMatch[1]
        return result
      }
    }

    return result
  }
}
