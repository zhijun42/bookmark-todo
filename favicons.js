export function loadFavicon(image, fallback, pageURL) {
  image.addEventListener('load', () => {
    image.hidden = false;
    fallback.hidden = true;
  }, { once: true });
  image.addEventListener('error', () => {
    image.hidden = true;
    fallback.hidden = false;
  }, { once: true });
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageURL);
  url.searchParams.set('size', '32');
  image.src = url.href;
}
