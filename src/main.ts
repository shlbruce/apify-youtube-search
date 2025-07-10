import { Actor } from 'apify';
import { chromium } from 'playwright';
import { DELAY } from './constants.js';
import { isVideoAfter, isYouTubeShortUrl } from './helper.js';

type VideoResult = { title: string; url: string, uploadTime: string };
type Input = { keywords: string[], maxCount: number, startDate?: string };
type ParsedInput = {
    keywords: string[];
    maxCount: number;
    startDateObj?: Date;
};

const width = 2048;
const height = 1152;

//PWDEBUG=1 node dist/main.js

async function main() {
    await Actor.init();

    const input = await Actor.getInput() as Input;
    const { keywords, maxCount, startDateObj } = parseApifyInput(input);

    
    //const browser = await chromium.launch({ headless: true });
    const browser = await chromium.launch({ headless: false, slowMo: 100, args: [`--window-size=${width},${height}`] });
    const context = await browser.newContext({
        viewport: { width, height }
    });
    const page = await context.newPage();

    for (const keyword of keywords) {
        try {
            const detailQueue: VideoResult[] = await search(page, keyword, maxCount, startDateObj);
            // --- Process detail pages one by one ---
            for (const video of detailQueue) {
                await scrapeVideoDetail(context, video);
            }

            console.log(`Finished processing keyword: ${keyword} : ${detailQueue.length} video`);
        }
        catch (err) {
            console.error(`Error while processing keyword "${keyword}":`, err);
            continue; // Skip this keyword if any error occurs
        }
    }

    await browser.close();
    await Actor.exit();
}

function parseApifyInput(input: Input): ParsedInput {
    const keywords = input.keywords ?? [];
    const maxCount = input.maxCount ?? 20;
    let startDateObj: Date | undefined = undefined;

    if (input.startDate) {
        const [year, month, day] = input.startDate.split('-').map(Number);
        if (year && month && day) {
            startDateObj = new Date(year, month - 1, day);
        }
    }

    return { keywords, maxCount, startDateObj };
}

async function search(page: any, keyword: string, maxCount: number, startDateObj?: Date) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    console.log(`Searching for keyword: ${keyword}`);
    await page.waitForSelector('ytd-video-renderer', { timeout: DELAY.PAGE_LOAD });

    await page.click('#filter-button'); // Click the button

    // Wait for the filter menu to appear (replace parent selector if needed)
    await page.waitForTimeout(DELAY.PARTIAL_PAGE_LOAD);

    // Click the "Upload date" filter label
    await page.click('div[title="Sort by upload date"]');
    await page.waitForTimeout(DELAY.PARTIAL_PAGE_LOAD);


    // Use a Map to keep track of unique videos by URL
    const videoMap = new Map<string, VideoResult>();

    while (videoMap.size < maxCount) {
        // Extract video results on current page
        const results: VideoResult[] = await page.evaluate(() => {

            function findAgoTimeSpan(metadataDiv: any) {
                // Match e.g. "3 minutes ago", "1 hour ago", etc.
                const agoRegex = /\b\d+\s*(minute|hour|day|week|month|year)s?\s+ago\b/i;
                const spans = metadataDiv.querySelectorAll('span');
                for (const span of spans) {
                    const text = span.textContent && span.textContent.trim();
                    if (text && agoRegex.test(text)) {
                        return text; // Return the first matching span's text
                    }
                }
                return null; // No match found
            }

            const videosContainers = document.querySelectorAll('#contents');

            if (videosContainers.length === 0) {
                console.warn('No video containers found on this page.');
                return [];
            }

            const results = [];
            for (const videosContainer of videosContainers) {
                videosContainer.id = 'contents-1'; // Mark as processed to avoid duplicates

                const videos = Array.from(videosContainer.querySelectorAll('ytd-video-renderer'));
                for (const v of videos) {
                    const titleElem = v.querySelector('#video-title');
                    const title = titleElem && titleElem.textContent ? titleElem.textContent.trim() : '';
                    const url = titleElem && titleElem.getAttribute('href')
                        ? 'https://www.youtube.com' + titleElem.getAttribute('href')
                        : '';
                    const metadataDiv = v.querySelector('#metadata-line');
                    const uploadTime = findAgoTimeSpan(metadataDiv);
                    //handle live, when uploadTime is null
                    console.log(`Found video: ${title} - ${url} - ${uploadTime}`);
                    results.push({ title, url, uploadTime });
                }
            }
            //debugger;
            return results;
        });

        // Add unique videos to the map
        for (const video of results) {
            try {
                if (video.url && !videoMap.has(video.url)) {
                    console.log(`Processing video: ${video.title} - ${video.url} - ${video.uploadTime}`);
                    if (!isVideoAfter(startDateObj, video.uploadTime)) {
                        console.log(`Video "${video.title}" is before start date, skipping.`);
                        maxCount = videoMap.size - 1; // Stop if video is before startDate
                        break;
                    }
                    if (!isYouTubeShortUrl(video.url)) {
                        videoMap.set(video.url, video);
                    }
                }
            }
            catch (err) {
                console.error(`Error processing video "${video.title}":`, err);
                continue; // Skip this video if any error occurs
            }   
        }

        // Stop if we already reached enough unique videos
        if (videoMap.size >= maxCount) break;

        // Scroll down for more results
        await page.evaluate(() => {
            window.scrollBy(0, window.innerHeight * 0.9);
        });
        console.log(`Scrolled down, current unique videos count: ${videoMap.size}`);
        await page.waitForTimeout(DELAY.SCROLL);
    }

    console.log(`Found ${videoMap.size} unique videos for keyword "${keyword}"`);

    // --- Build a queue of video links ---
    const detailQueue = Array.from(videoMap.values()).slice(0, maxCount);

    return detailQueue;
}

async function scrapeVideoDetail(context: any, video: VideoResult) {
    try {
        const videoPage = await context.newPage();
        await videoPage.goto(video.url, { waitUntil: 'domcontentloaded' });
        await videoPage.waitForTimeout(DELAY.PARTIAL_PAGE_LOAD); // Let content load
        console.log(`Processing video: ${video.title} - ${video.url}`);

        await videoPage.evaluate(() => {
            window.scrollBy(0, window.innerHeight * 0.3);
        });
        await videoPage.waitForTimeout(DELAY.SCROLL);

        //debug begin
        //videoPage.on('console', msg => console.log('[browser]', msg.text()));
        //debug end

        const expandButton = await videoPage.$('#bottom-row tp-yt-paper-button#expand');
        if (expandButton) {
            await expandButton.click();
            await videoPage.waitForTimeout(DELAY.CLICK);
        } else {
            console.warn('No expand button found inside #bottom-row.');
        }

        // Scrape details using page.evaluate for info you want
        const detail = await videoPage.evaluate(async () => {
            //Extract channel info and other elements
            function getText(sel: string) {
                const el = document.querySelector(sel);
                return el ? el.textContent?.trim() : '';
            }
            function getAttr(sel: string, attr: string) {
                const el = document.querySelector(sel);
                return el ? (el as HTMLElement).getAttribute(attr) : '';
            }

            function extractNumber(str: string) {
                const match = str.match(/(\d[\d,]*)/); // Finds first sequence of digits (possibly with commas)
                if (match) {
                    // Remove any commas before parsing
                    return parseInt(match[1].replace(/,/g, ''), 10);
                }
                return 0;
            }
            //421K subscribers
            function extractSubscriberCount(text: string) {
                // Match number part with optional suffix (K, M, B, etc.)
                const match = text.match(/^([\d,.]+[KMB]?)\s*subscribers?$/i);
                return match ? match[1] : '';
            }

            function parseISODuration(durationStr: string) {
                // Example: PT8M24S, PT1H5M, PT45S, PT2H3S, etc.
                const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
                const [, h, m, s] = durationStr.match(regex) || [];
                const hours = parseInt(h || '0', 10);
                const mins = parseInt(m || '0', 10);
                const secs = parseInt(s || '0', 10);

                if (hours) {
                    // Pad with zeros for mm:ss and hh:mm:ss
                    return [
                        hours.toString().padStart(2, '0'),
                        mins.toString().padStart(2, '0'),
                        secs.toString().padStart(2, '0')
                    ].join(':');
                } else {
                    return [
                        mins.toString().padStart(2, '0'),
                        secs.toString().padStart(2, '0')
                    ].join(':');
                }
            }

            function removeYouTubeSuffix(title: string) {
                const suffix = " - YouTube";
                if (title.endsWith(suffix)) {
                    return title.slice(0, -suffix.length);
                }
                return title;
            }

            const description = getText('#bottom-row ytd-text-inline-expander yt-attributed-string');

            const channelName = getText('ytd-channel-name a');
            const channelUrl = getAttr('ytd-channel-name a', 'href')
                ? 'https://www.youtube.com' + getAttr('ytd-channel-name a', 'href')
                : '';
            const channelId = channelUrl.split('/').pop() || '';
            //debugger;
            const subscriberCountStr = getText('#above-the-fold #upload-info #owner-sub-count');
            const subscribers = subscriberCountStr ? extractSubscriberCount(subscriberCountStr) : 0;

            const viewStr = getText('.view-count') || getText('span.view-count');
            const viewMatch = (viewStr ?? '').replace(/,/g, '').match(/([\d,]+)/);
            const views = viewMatch ? parseInt(viewMatch[1], 10) : undefined;

            const likesDislikes = document.querySelector('#top-row #top-level-buttons-computed');
            const likesButton = likesDislikes?.querySelector('like-button-view-model button-view-model button')
            const likesString = likesButton?.getAttribute('aria-label');
            const likes = likesString ? extractNumber(likesString) : 0;
            const dislikesButton = likesDislikes?.querySelector('dislike-button-view-model button-view-model button')
            const dislikesString = dislikesButton?.getAttribute('aria-label');
            const dislikes = dislikesString ? extractNumber(dislikesString) : 0;

            const durationContent = (document.querySelector('meta[itemprop="duration"]') as HTMLMetaElement | null)?.content || null;
            const duration = durationContent ? parseISODuration(durationContent) : null;
            const publishDate = (document.querySelector('meta[itemprop="datePublished"]') as HTMLMetaElement | null)?.content || null;
            const uploadDate = (document.querySelector('meta[itemprop="uploadDate"]') as HTMLMetaElement | null)?.content || null;
            const embedUrl = (document.querySelector('link[itemprop="embedUrl"]') as HTMLLinkElement | null)?.href || null;
            const isFamilyFriendly = (document.querySelector('meta[itemprop="isFamilyFriendly"]') as HTMLMetaElement | null)?.content || null;
            const keywords = (document.querySelector('meta[name="keywords"]') as HTMLMetaElement | null)?.content || '';
            const genre = (document.querySelector('meta[itemprop="genre"]') as HTMLMetaElement | null)?.content || '';

            const liveBlock = document.querySelector('span[itemprop="publication"][itemtype*="BroadcastEvent"]');
            const isLive = !!liveBlock?.querySelector('meta[itemprop="isLiveBroadcast"][content="True"]');
            const startDate = (liveBlock?.querySelector('meta[itemprop="startDate"]') as HTMLMetaElement | null)?.content || null;
            const endDate = (liveBlock?.querySelector('meta[itemprop="endDate"]') as HTMLMetaElement | null)?.content || null;

            const thumbEl = document.querySelector('span[itemprop="thumbnail"]');
            const thumbnailUrl = (thumbEl?.querySelector('link[itemprop="url"]') as HTMLLinkElement | null)?.href || null;
            const width = (thumbEl?.querySelector('meta[itemprop="width"]') as HTMLMetaElement | null)?.content || null;
            const height = (thumbEl?.querySelector('meta[itemprop="height"]') as HTMLMetaElement | null)?.content || null;
            const comments = document.querySelector('#comments #count yt-formatted-string')?.textContent || '';
            const commentCount = extractNumber(comments);

            return {
                type: 'video',
                id: new URL(window.location.href).searchParams.get('v') || window.location.pathname.split('/').pop(),
                title: removeYouTubeSuffix(window.document.title),
                url: window.location.href,
                description,
                publishDate,
                uploadDate,
                duration,
                views,
                likes,
                dislikes,
                commentCount,
                thumbnail: {
                    url: thumbnailUrl,
                    width: width,
                    height: height
                },
                channel: {
                    id: channelId,
                    name: channelName,
                    url: channelUrl,
                    subscribers: subscribers
                },
                embedUrl,
                isLive,
                isFamilyFriendly,
                genre,
                keywords: keywords.split(',').map((k) => k.trim()),
                live: {
                    isLive,
                    startDate,
                    endDate
                }
            };
        });

        // Push result to dataset
        await Actor.pushData(detail);
        await videoPage.close();
    }
    catch (err) {
        console.error(`Error while processing video "${video.title}":`, err);
    }
}

main().catch((err) => {
    console.error('Actor failed:', err);
    process.exit(1);
});
