import browser from './browser-polyfill';

let currentActiveTabId: number | undefined;
let currentWindowId: number | undefined;

export async function updateCurrentActiveTab(windowId: number) {
	const tabs = await browser.tabs.query({ active: true, windowId: windowId });
	if (tabs[0] && tabs[0].id && tabs[0].url) {
		currentActiveTabId = tabs[0].id;
		currentWindowId = windowId;
		browser.runtime.sendMessage({
			action: "activeTabChanged",
			tabId: currentActiveTabId,
			url: tabs[0].url,
			isValidUrl: isValidUrl(tabs[0].url),
			isBlankPage: isBlankPage(tabs[0].url)
		});
	}
}

export function isValidUrl(url: string): boolean {
	return url.startsWith('http://') || 
		   url.startsWith('https://') || 
		   url.startsWith('file:///');
}

export function isBlankPage(url: string): boolean {
	return url === 'about:blank' || url === 'chrome://newtab/' || url === 'edge://newtab/';
}

export function isPdfUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		const pathname = parsed.pathname.toLowerCase();

		// Direct .pdf extension
		if (pathname.endsWith('.pdf')) {
			return true;
		}

		// Known PDF URL patterns (e.g. arxiv.org/pdf/...)
		const pdfPathPatterns = [
			/^\/pdf\//,          // arxiv.org/pdf/2603.12081
			/^\/pdf$/,           // some sites use /pdf?id=...
			/\/pdf\/download\//,
		];

		for (const pattern of pdfPathPatterns) {
			if (pattern.test(pathname)) {
				return true;
			}
		}

		return false;
	} catch {
		return false;
	}
}
