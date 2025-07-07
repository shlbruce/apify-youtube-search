export enum DELAY {
    PAGE_LOAD = 6000,      // Wait after page navigation (ms)
    PARTIAL_PAGE_LOAD = 3000,      // Wait after page navigation (ms)
    SCROLL = 2500,         // Wait after each scroll (ms)
    CLICK = 1500,          // Wait after a click (ms)
    SHORT = 500,           // Very short pause (ms)
    LONG = 20000           // For very slow or heavy pages (ms)
}
