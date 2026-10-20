import { collectInbox, describeBookmark } from './bookmarks.js';
import { loadFavicon } from './favicons.js';
import { initializeShortcuts } from './shortcuts.js';
import { initializeBookmarkBar } from './bookmark-bar.js';

const elements = {
  inbox: document.querySelector('.inbox'),
  list: document.querySelector('#bookmark-list'),
  count: document.querySelector('#bookmark-count'),
  loading: document.querySelector('#loading'),
  status: document.querySelector('#load-status'),
  state: document.querySelector('#state'),
  stateTitle: document.querySelector('#state-title'),
  stateDescription: document.querySelector('#state-description'),
  retry: document.querySelector('#retry'),
  template: document.querySelector('#bookmark-template'),
};

const dateFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
const fullDateFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' });
let refreshVersion = 0;
let refreshTimer;
let renderedSignature;
let bookmarkBar;

function showState(title, description, retry = false) {
  renderedSignature = undefined;
  elements.loading.hidden = true;
  elements.list.hidden = true;
  elements.state.hidden = false;
  elements.stateTitle.textContent = title;
  elements.stateDescription.textContent = description;
  elements.retry.hidden = !retry;
  elements.inbox.setAttribute('aria-busy', 'false');
}

function createBookmarkItem(bookmark) {
  const fragment = elements.template.content.cloneNode(true);
  const link = fragment.querySelector('.bookmark-link');
  const info = describeBookmark(bookmark);

  link.dataset.bookmarkId = bookmark.id;
  link.draggable = true;
  link.title = `${info.title}\n${bookmark.url}`;
  if (info.navigable) {
    link.href = bookmark.url;
  } else {
    link.setAttribute('aria-disabled', 'true');
  }

  fragment.querySelector('.bookmark-title').textContent = info.title;
  fragment.querySelector('.bookmark-domain').textContent = info.domain;

  const dateElement = fragment.querySelector('.bookmark-date');
  const date = new Date(bookmark.dateAdded);
  if (Number.isFinite(date.getTime())) {
    dateElement.dateTime = date.toISOString();
    dateElement.textContent = date.getFullYear() === new Date().getFullYear()
      ? dateFormatter.format(date)
      : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
    dateElement.title = fullDateFormatter.format(date);
  }

  if (info.favicon) {
    const image = fragment.querySelector('.favicon');
    const fallback = fragment.querySelector('.favicon-fallback');
    loadFavicon(image, fallback, bookmark.url);
  }

  return fragment;
}

function render(bookmarks) {
  const signature = JSON.stringify(bookmarks.map(({ id, title, url, dateAdded }) => [id, title, url, dateAdded]));
  elements.count.textContent = String(bookmarks.length);
  elements.count.setAttribute('aria-label', `${bookmarks.length} 个待阅读书签`);
  elements.count.hidden = false;
  elements.status.textContent = `${bookmarks.length} 个未归档网页`;
  elements.loading.hidden = true;
  elements.inbox.setAttribute('aria-busy', 'false');

  if (bookmarks.length === 0) {
    showState('这一页，暂时读完了', '下次遇到想读的网页，收藏到书签栏，就会出现在这里。');
    return;
  }

  elements.state.hidden = true;
  elements.list.hidden = false;
  if (signature === renderedSignature) return;

  const focusedId = document.activeElement?.dataset.bookmarkId;
  const fragment = document.createDocumentFragment();
  for (const bookmark of bookmarks) fragment.append(createBookmarkItem(bookmark));
  elements.list.replaceChildren(fragment);
  renderedSignature = signature;

  if (focusedId) {
    [...elements.list.querySelectorAll('.bookmark-link')]
      .find((link) => link.dataset.bookmarkId === focusedId)?.focus({ preventScroll: true });
  }
}

async function refresh() {
  const version = ++refreshVersion;
  try {
    const tree = await chrome.bookmarks.getTree();
    // A previous read can finish after a newer bookmark event has already been handled.
    if (version !== refreshVersion) return;
    bookmarkBar.update(tree);
    render(collectInbox(tree));
  } catch (error) {
    if (version !== refreshVersion) return;
    console.error('Unable to read bookmarks:', error);
    bookmarkBar.hide();
    elements.count.hidden = true;
    elements.status.textContent = '书签读取失败';
    showState('暂时无法读取书签', '请确认扩展仍处于启用状态，然后重新读取。', true);
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 40);
}

if (globalThis.chrome?.bookmarks && chrome.runtime?.id) {
  bookmarkBar = initializeBookmarkBar();
  initializeShortcuts();
  document.querySelector('.manage-link').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    try {
      await chrome.tabs.create({ url: 'chrome://bookmarks/' });
    } catch (error) {
      console.error('Unable to open bookmark manager:', error);
      button.textContent = '请在地址栏打开 chrome://bookmarks/';
    }
  });
  for (const event of ['onCreated', 'onChanged', 'onMoved', 'onRemoved', 'onChildrenReordered', 'onImportEnded']) {
    chrome.bookmarks[event].addListener(scheduleRefresh);
  }
  elements.retry.addEventListener('click', refresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleRefresh();
  });
  window.addEventListener('pageshow', scheduleRefresh);
  refresh();
} else {
  elements.status.textContent = '请通过扩展打开此页面';
  showState('在 Chrome 新标签页中打开', '安装并启用「待读」扩展后，新标签页会显示你的阅读清单。');
}
