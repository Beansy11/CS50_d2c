// The Content-Security-Policy of a page shown in the page editor or the site
// preview (src/pageShell.ts): what the page may load, as a browser would
// load it from the site.
//
// The page's own files come from the webview (`cspSource`); pictures and
// fonts may also come from the web. Frames may only be YouTube's and
// Vimeo's players, the two hosted videos the editor embeds (src/videos.ts),
// so a video added in the editor plays there as it will on the site.
//
// No nonce on purpose: with a nonce present, browsers ignore
// 'unsafe-inline', and the site's own inline scripts would be blocked.
//
// Plain Node - no vscode import - so test/videos.test.js can run it.

/** The hosts a page's frames may load from: the players of the hosted videos. */
export const FRAME_HOSTS: readonly string[] = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'];

export function pageCsp(cspSource: string): string {
    return [
        `default-src 'none'`,
        `img-src ${cspSource} data: https:`,
        `media-src ${cspSource} data:`,
        `font-src ${cspSource} data: https:`,
        `style-src ${cspSource} 'unsafe-inline' https:`,
        `script-src ${cspSource} 'unsafe-inline'`,
        `frame-src ${FRAME_HOSTS.join(' ')}`,
    ].join('; ');
}
