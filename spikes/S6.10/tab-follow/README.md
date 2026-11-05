# Tab follow (spike S6.10)

Throwaway test of a small extension that switches to Claude's tab when that tab starts loading a page. See `docs/decisions/S6.10-show-browser.md`.

## Try it

1. Open `brave://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder.
3. Ask Claude to open two or three web pages in the browser, then click one of your own tabs while it works.

It worked if Brave switches to Claude's tab each time that tab loads a new page.

To remove it, click **Remove** on its card in `brave://extensions`.

## Limits to check

- It reacts only when a page loads, so clicks or typing that stay on one page don't switch tabs.
- While it's on, Claude's page loads will pull you away from a tab you're using in that window.
