import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const project = fileURLToPath(new URL('..', import.meta.url));
const artifacts = path.join(project, 'artifacts');
const pageErrors = [];
let context;
let profile;
let page;
let extensionURL;
let barId;
let otherId;
let category;
let first;
let second;

async function bookmarkCall(method, ...args) {
  const result = await page.evaluate(({ method, args }) => chrome.bookmarks[method](...args), { method, args });
  // Millisecond timestamps must differ for creation-order assertions to be deterministic.
  if (method === 'create' && result.url) await page.waitForFunction((date) => Date.now() > date, result.dateAdded);
  return result;
}

async function waitForIds(expected) {
  await page.waitForFunction((ids) => {
    const actual = [...document.querySelectorAll('#bookmark-list .bookmark-link')].map((link) => link.dataset.bookmarkId);
    return JSON.stringify(actual) === JSON.stringify(ids)
      && !document.querySelector('#bookmark-list').hidden
      && !document.querySelector('#bookmark-count').hidden
      && document.querySelector('#state').hidden
      && document.querySelector('.inbox').getAttribute('aria-busy') === 'false';
  }, expected);
  assert.equal(await page.locator('#bookmark-count').textContent(), String(expected.length));
}

before(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-inbox-test-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    args: [`--disable-extensions-except=${project}`, `--load-extension=${project}`],
  });
  context.setDefaultTimeout(8000);
  context.setDefaultNavigationTimeout(10000);
  context.on('page', (openedPage) => openedPage.on('pageerror', (error) => pageErrors.push(error.message)));
  page = await context.newPage();
  await page.goto('chrome://newtab/');
  await page.waitForFunction(() => document.querySelector('#inbox-title')?.textContent === '待阅读');
  extensionURL = await page.evaluate(() => chrome.runtime.getURL('newtab.html'));
  const tree = await bookmarkCall('getTree');
  const roots = tree[0].children;
  barId = roots.find((node) => node.folderType === 'bookmarks-bar' || node.id === '1').id;
  otherId = roots.find((node) => node.folderType === 'other' || node.id === '2').id;
});

after(async () => {
  if (context) await context.close();
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
  assert.deepEqual(pageErrors, [], 'Extension pages must not throw uncaught errors');
});

test('Chrome new-tab override loads the real extension with no search box and a genuine empty state', async () => {
  assert.match(extensionURL, /^chrome-extension:\/\/[a-p]{32}\/newtab\.html$/);
  assert.equal(await page.locator('input:visible, [role="searchbox"], input[type="search"]').count(), 0);
  await page.locator('#state').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#state-title').textContent(), '这一页，暂时读完了');
  assert.equal(await page.locator('#bookmark-count').textContent(), '0');
});

test('the header restores the eight original shortcuts and removes the decorative header and text', async () => {
  const shortcuts = await page.locator('#shortcut-list a').evaluateAll((links) => links.map((link) => ({
    title: link.querySelector('.shortcut-label').textContent,
    url: link.href,
  })));
  assert.deepEqual(shortcuts, [
    { title: 'reddit', url: 'https://www.reddit.com/' },
    { title: 'wait but why', url: 'https://waitbutwhy.com/' },
    { title: 'FS', url: 'https://fs.blog/' },
    { title: 'Twitter punk6529', url: 'https://x.com/punk6529' },
    { title: '小红书', url: 'https://www.xiaohongshu.com/user/profile/5f7b5e63000000000101d422?tab=liked' },
    { title: 'Hacker News', url: 'https://news.ycombinator.com/' },
    { title: 'Discord', url: 'https://discord.com/channels/1229655852118442065/1231290232960450661' },
    { title: 'Tim Ferriss', url: 'https://mail.google.com/mail/u/0/#category/forums' },
  ]);
  assert.equal(await page.locator('#today, .brand, .page-footer, .description').count(), 0);
  const text = await page.locator('body').textContent();
  assert.equal(text.includes('读完，归档。给下一份好内容留点空间。'), false);
  assert.equal(text.includes('一次读一篇，也很好。'), false);
});

test('shortcuts can be added, edited, persisted across reloads and tabs, and removed without creating bookmarks', async () => {
  await page.locator('#add-shortcut').click();
  await page.locator('#shortcut-title').fill('Example reading');
  await page.locator('#shortcut-url').fill('example.com/reading');
  await page.locator('#save-shortcut').click();
  await page.locator('#shortcut-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#shortcut-list a').count(), 9);
  assert.equal(await page.locator('#shortcut-list a').last().getAttribute('href'), 'https://example.com/reading');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#shortcut-list a').length === 9);
  const anotherPage = await context.newPage();
  await anotherPage.goto('chrome://newtab/');
  await anotherPage.waitForFunction(() => document.querySelectorAll('#shortcut-list a').length === 9);

  await page.bringToFront();
  await page.locator('#shortcut-list .shortcut-item').nth(8).hover();
  await page.getByRole('button', { name: '编辑 Example reading', exact: true }).click();
  await page.locator('#shortcut-title').fill('Updated shortcut');
  await page.locator('#shortcut-url').fill('https://example.com/updated');
  await page.locator('#save-shortcut').click();
  await page.locator('#shortcut-dialog').waitFor({ state: 'hidden' });
  await anotherPage.waitForFunction(() => [...document.querySelectorAll('.shortcut-label')].some((label) => label.textContent === 'Updated shortcut'));
  assert.equal(await page.locator('#shortcut-list a').last().getAttribute('href'), 'https://example.com/updated');

  await page.locator('#shortcut-list .shortcut-item').nth(8).hover();
  await page.getByRole('button', { name: '编辑 Updated shortcut', exact: true }).click();
  await page.locator('#delete-shortcut').click();
  await page.locator('#shortcut-dialog').waitFor({ state: 'hidden' });
  await anotherPage.waitForFunction(() => document.querySelectorAll('#shortcut-list a').length === 8);
  assert.equal(await page.locator('#shortcut-list a').count(), 8);
  assert.equal(await page.locator('#bookmark-count').textContent(), '0');
  assert.deepEqual(await bookmarkCall('getChildren', barId), []);
  await anotherPage.close();
});

test('shortcut validation rejects executable URLs and cancel preserves the original shortcuts', async () => {
  await page.locator('#add-shortcut').click();
  await page.locator('#shortcut-title').fill('Unsafe shortcut');
  await page.locator('#shortcut-url').fill('javascript:alert(1)');
  await page.locator('#save-shortcut').click();
  await page.locator('#shortcut-error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#shortcut-dialog').isVisible(), true);
  assert.equal(await page.locator('#shortcut-list a').count(), 8);
  await page.locator('#cancel-shortcut').click();
  await page.locator('#shortcut-dialog').waitFor({ state: 'hidden' });
  await page.reload();
  await page.locator('#add-shortcut').waitFor();
  assert.equal(await page.locator('#shortcut-list a').count(), 8);
});

test('native bookmark creation updates the inbox while folders and other-bookmark links stay excluded', async () => {
  category = await bookmarkCall('create', { parentId: barId, title: 'AI · 已归档' });
  await bookmarkCall('create', { parentId: category.id, title: 'Archived article', url: 'https://archived.example/article' });
  await bookmarkCall('create', { parentId: otherId, title: 'Other bookmarks', url: 'https://other.example/' });
  first = await bookmarkCall('create', { parentId: barId, title: 'Build a Durable AI Agent · Cloudflare Workflows docs', url: 'https://developers.cloudflare.com/workflows/' });
  second = await bookmarkCall('create', { parentId: barId, title: 'List of all my projects ever — @levelsio (Pieter Levels)', url: 'https://levels.io/projects/' });
  await waitForIds([second.id, first.id]);
  assert.equal(await page.locator('#state').isVisible(), false);
  assert.equal(await page.locator(`.bookmark-link[data-bookmark-id="${first.id}"] .bookmark-domain`).textContent(), 'developers.cloudflare.com');
});

test('the page bookmark bar browses nested and empty native folders and supports keyboard navigation', async () => {
  const nested = await bookmarkCall('create', { parentId: category.id, title: 'Nested category' });
  const nestedLink = await bookmarkCall('create', { parentId: nested.id, title: '<img onerror=alert(1)> Archived reading', url: 'https://nested.example/' });
  const empty = await bookmarkCall('create', { parentId: category.id, title: 'Empty category' });
  await bookmarkCall('update', category.id, { title: 'AI · 已归档 · 更新' });
  const folder = page.locator(`#bookmark-bar-items [data-node-id="${category.id}"]`);
  await page.waitForFunction((id) => document.querySelector(`#bookmark-bar-items [data-node-id="${id}"]`)?.textContent === 'AI · 已归档 · 更新', category.id);
  assert.equal(await page.locator('#bookmark-bar').isVisible(), true);
  assert.deepEqual(await page.locator('#bookmark-bar-items .bar-entry').evaluateAll((entries) => entries.map((entry) => entry.dataset.nodeId)), [category.id, first.id, second.id]);
  await folder.focus();
  await page.keyboard.press('ArrowDown');
  await page.locator('#bookmark-menu').waitFor({ state: 'visible' });
  await page.locator(`#bookmark-menu [data-node-id="${nested.id}"]`).focus();
  await page.keyboard.press('ArrowRight');
  const archived = page.locator(`#bookmark-menu [data-node-id="${nestedLink.id}"]`);
  await archived.waitFor();
  assert.equal(await archived.getAttribute('href'), 'https://nested.example/');
  assert.equal(await archived.locator('.bar-label').textContent(), nestedLink.title);
  assert.equal(await archived.locator('.bar-label img').count(), 0);
  await page.keyboard.press('ArrowLeft');
  await page.locator(`#bookmark-menu [data-node-id="${empty.id}"]`).click();
  assert.equal(await page.locator('.bar-menu-empty').textContent(), '此文件夹为空');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#bookmark-menu').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.nodeId), category.id);
  await bookmarkCall('removeTree', nested.id);
  await bookmarkCall('remove', empty.id);
  await bookmarkCall('update', category.id, { title: category.title });
  await page.waitForFunction(({ id, title }) => document.querySelector(`#bookmark-bar-items [data-node-id="${id}"]`)?.textContent === title, category);
});

test('folders and nested folders open on hover without clicks and book links retain the arrow cursor', async () => {
  const nested = await bookmarkCall('create', { parentId: category.id, title: 'Hover nested category' });
  const other = await bookmarkCall('create', { parentId: barId, title: 'Hover another category' });
  await bookmarkCall('update', category.id, { title: 'AI · 悬停测试' });
  const folder = page.locator(`#bookmark-bar-items [data-node-id="${category.id}"]`);
  await page.waitForFunction((id) => document.querySelector(`#bookmark-bar-items [data-node-id="${id}"]`)?.textContent === 'AI · 悬停测试', category.id);
  await folder.hover();
  await page.locator(`#bookmark-menu [data-node-id="${nested.id}"]`).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#bookmark-menu').getAttribute('aria-label'), 'AI · 悬停测试');
  for (const selector of ['#bookmark-bar .bar-folder', '#bookmark-bar .bar-link', '#bookmark-menu .bar-link', '.bookmark-link', '.shortcut-link']) {
    assert.equal(await page.locator(selector).first().evaluate((element) => getComputedStyle(element).cursor), 'default', selector);
  }
  await page.locator(`#bookmark-menu [data-node-id="${nested.id}"]`).hover();
  await page.locator('.bar-menu-empty').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#bookmark-menu').getAttribute('aria-label'), 'Hover nested category');
  await page.locator(`#bookmark-bar-items [data-node-id="${other.id}"]`).hover();
  await page.waitForFunction(() => document.querySelector('#bookmark-menu').getAttribute('aria-label') === 'Hover another category');
  assert.equal(await page.locator('#bookmark-menu').isVisible(), true);
  await page.locator('#inbox-title').click();
  assert.equal(await page.locator('#bookmark-menu').isVisible(), false);
  await bookmarkCall('remove', nested.id);
  await bookmarkCall('remove', other.id);
  await bookmarkCall('update', category.id, { title: category.title });
  await page.waitForFunction(({ id, title }) => document.querySelector(`#bookmark-bar-items [data-node-id="${id}"]`)?.textContent === title, category);
});

test('dragging an inbox bookmark into a bar folder moves the original bookmark and updates both views', async () => {
  await page.locator(`.bookmark-link[data-bookmark-id="${first.id}"]`).dragTo(page.locator(`#bookmark-bar-items [data-node-id="${category.id}"]`));
  await waitForIds([second.id]);
  assert.equal((await bookmarkCall('get', first.id))[0].parentId, category.id);
  assert.equal(await page.locator(`#bookmark-bar-items [data-node-id="${first.id}"]`).count(), 0);
  await bookmarkCall('move', first.id, { parentId: barId, index: 1 });
  await waitForIds([second.id, first.id]);
  assert.equal((await bookmarkCall('get', first.id))[0].dateAdded, first.dateAdded);
});

test('failed drag moves report an error and keep the original pending bookmark intact', async () => {
  await page.evaluate(() => {
    window.originalMove = chrome.bookmarks.move;
    chrome.bookmarks.move = async () => { throw new Error('Simulated move failure'); };
  });
  await page.locator(`.bookmark-link[data-bookmark-id="${first.id}"]`).dragTo(page.locator(`#bookmark-bar-items [data-node-id="${category.id}"]`));
  await page.locator('#bookmark-bar-error').waitFor({ state: 'visible' });
  await waitForIds([second.id, first.id]);
  assert.equal((await bookmarkCall('get', first.id))[0].parentId, barId);
  await page.evaluate(() => { chrome.bookmarks.move = window.originalMove; });
  await page.locator('#inbox-title').click();
  assert.equal(await page.locator('#bookmark-bar-error').isVisible(), false);
});

test('drag hover opens folders so a bookmark can be archived directly into a nested category', async () => {
  const nested = await bookmarkCall('create', { parentId: category.id, title: 'Drag destination' });
  await bookmarkCall('update', category.id, { title: 'AI · 拖放测试' });
  await page.waitForFunction((id) => document.querySelector(`#bookmark-bar-items [data-node-id="${id}"]`)?.textContent === 'AI · 拖放测试', category.id);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  const source = page.locator(`.bookmark-link[data-bookmark-id="${first.id}"]`);
  await source.dispatchEvent('dragstart', { dataTransfer: transfer });
  await page.locator(`#bookmark-bar-items [data-node-id="${category.id}"]`).dispatchEvent('dragover', { dataTransfer: transfer });
  await page.locator('#bookmark-menu').waitFor({ state: 'visible' });
  await page.locator(`#bookmark-menu [data-node-id="${nested.id}"]`).dispatchEvent('drop', { dataTransfer: transfer });
  await page.evaluate(() => document.dispatchEvent(new DragEvent('dragend')));
  await waitForIds([second.id]);
  assert.equal((await bookmarkCall('get', first.id))[0].parentId, nested.id);
  await bookmarkCall('move', first.id, { parentId: barId, index: 1 });
  await waitForIds([second.id, first.id]);
  await bookmarkCall('remove', nested.id);
  await bookmarkCall('update', category.id, { title: category.title });
  await page.waitForFunction(({ id, title }) => document.querySelector(`#bookmark-bar-items [data-node-id="${id}"]`)?.textContent === title, category);
  await transfer.dispose();
});

test('overflow preserves bookmark order and exposes folders that do not fit in a narrow bar', async () => {
  const folders = [];
  for (let index = 0; index < 9; index++) folders.push(await bookmarkCall('create', { parentId: barId, title: `More category ${index}` }));
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.locator('#bookmark-overflow').waitFor({ state: 'visible' });
  await page.waitForFunction((id) => document.querySelector(`#bookmark-bar-items [data-node-id="${id}"]`)?.hidden, folders.at(-1).id);
  const hiddenIds = await page.locator('#bookmark-bar-items .bar-entry[hidden]').evaluateAll((entries) => entries.map((entry) => entry.dataset.nodeId));
  await page.locator('#bookmark-overflow').click();
  await page.locator('#bookmark-menu').waitFor({ state: 'visible' });
  assert.deepEqual(await page.locator('#bookmark-menu [data-node-id]').evaluateAll((entries) => entries.map((entry) => entry.dataset.nodeId)), hiddenIds);
  await page.screenshot({ path: path.join(artifacts, 'bookmark-bar-overflow.png') });
  await page.locator(`#bookmark-menu [data-node-id="${folders.at(-1).id}"]`).click();
  assert.equal(await page.locator('.bar-menu-empty').textContent(), '此文件夹为空');
  const rect = await page.locator('#bookmark-menu').boundingBox();
  assert.ok(rect.x >= 0 && rect.x + rect.width <= 390, 'Overflow menus remain inside the window');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'bookmark-overflow');
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page.locator(`.bookmark-link[data-bookmark-id="${first.id}"]`).dispatchEvent('dragstart', { dataTransfer: transfer });
  await page.locator('#bookmark-overflow').dispatchEvent('dragover', { dataTransfer: transfer });
  await page.locator('#bookmark-menu').waitFor({ state: 'visible' });
  await page.locator(`#bookmark-menu [data-node-id="${folders.at(-1).id}"]`).dispatchEvent('drop', { dataTransfer: transfer });
  await page.evaluate(() => document.dispatchEvent(new DragEvent('dragend')));
  await waitForIds([second.id]);
  assert.equal((await bookmarkCall('get', first.id))[0].parentId, folders.at(-1).id);
  await bookmarkCall('move', first.id, { parentId: barId, index: 1 });
  await waitForIds([second.id, first.id]);
  await transfer.dispose();
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const { id } of folders) await bookmarkCall('remove', id);
  await waitForIds([second.id, first.id]);
});

test('moving the original bookmark into a category removes it immediately; moving it back restores it', async () => {
  await bookmarkCall('move', first.id, { parentId: category.id });
  await waitForIds([second.id]);
  await bookmarkCall('move', first.id, { parentId: barId, index: 1 });
  await waitForIds([second.id, first.id]);
});

test('copies and edits preserve creation-time order, and native reordering does not change inbox sorting', async () => {
  await bookmarkCall('create', { parentId: category.id, title: first.title, url: first.url });
  await waitForIds([second.id, first.id]);
  await bookmarkCall('update', first.id, { title: '更新后的文章标题', url: 'https://updated.example/article' });
  await page.waitForFunction((id) => document.querySelector(`.bookmark-link[data-bookmark-id="${id}"] .bookmark-title`)?.textContent === '更新后的文章标题', first.id);
  assert.equal(await page.locator(`.bookmark-link[data-bookmark-id="${first.id}"] .bookmark-domain`).textContent(), 'updated.example');
  await bookmarkCall('move', first.id, { parentId: barId, index: 0 });
  await page.waitForFunction((id) => document.querySelector('#bookmark-bar-items .bar-entry')?.dataset.nodeId === id, first.id);
  await waitForIds([second.id, first.id]);
});

test('opening an article uses normal navigation and does not remove or move its bookmark', async () => {
  await context.route('https://levels.io/projects/', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Reading an article</title><h1>Article</h1>' }));
  await Promise.all([
    page.waitForURL('https://levels.io/projects/'),
    page.locator(`.bookmark-link[data-bookmark-id="${second.id}"]`).click(),
  ]);
  assert.equal(await page.title(), 'Reading an article');
  assert.equal(await page.locator('#bookmark-bar').count(), 0, 'The extension bar is absent from ordinary web pages');
  await page.goBack();
  await waitForIds([second.id, first.id]);
  assert.equal((await bookmarkCall('get', second.id))[0].parentId, barId);
  await context.unroute('https://levels.io/projects/');
});

test('titles are rendered as literal text and executable bookmark URLs cannot run in the extension', async () => {
  const literalTitle = '<img src=x onerror="window.bookmarkInjected=true"> & 标题';
  const literal = await bookmarkCall('create', { parentId: barId, title: literalTitle, url: 'https://safe.example/' });
  const script = await bookmarkCall('create', { parentId: barId, title: '脚本工具', url: 'javascript:window.bookmarkInjected=true' });
  await waitForIds([script.id, literal.id, second.id, first.id]);
  const row = page.locator(`.bookmark-link[data-bookmark-id="${literal.id}"]`);
  assert.equal(await row.locator('.bookmark-title').textContent(), literalTitle);
  assert.equal(await row.locator('.bookmark-title img').count(), 0);
  const scriptRow = page.locator(`.bookmark-link[data-bookmark-id="${script.id}"]`);
  assert.equal(await scriptRow.getAttribute('href'), null);
  await scriptRow.click();
  assert.equal(await page.evaluate(() => window.bookmarkInjected), undefined);
  await bookmarkCall('remove', literal.id);
  await bookmarkCall('remove', script.id);
  await waitForIds([second.id, first.id]);
});

test('existing open new tabs update together and keyboard focus survives unrelated additions', async () => {
  const anotherPage = await context.newPage();
  await anotherPage.goto('chrome://newtab/');
  await anotherPage.locator('.bookmark-link').first().waitFor();
  await page.bringToFront();
  const firstRow = page.locator(`.bookmark-link[data-bookmark-id="${second.id}"]`);
  await firstRow.focus();
  const added = await bookmarkCall('create', { parentId: barId, title: 'A new article', url: 'https://new.example/' });
  await waitForIds([added.id, second.id, first.id]);
  await anotherPage.waitForFunction((id) => !!document.querySelector(`.bookmark-link[data-bookmark-id="${id}"]`), added.id);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.bookmarkId), second.id);
  await bookmarkCall('remove', added.id);
  await waitForIds([second.id, first.id]);
  await anotherPage.close();
});

test('long titles wrap with no overflow in light, dark, and narrow layouts', async () => {
  const examples = [
    ['《置身钉内》：阿里内网 7.5 万字离职书【原文缩减版】', 'https://mp.weixin.qq.com/s/example'],
    ['活动：激活自己“捕捉需求”的意识 | Superlinear Academy', 'https://academy.superlinear.com/events'],
    ['让我非常震撼的 OpenClaw 玩法。每天因为 AI 兴奋的睡不着觉，这是最好的时代，也是需要耐心阅读、独立思考和真正消化信息的时代。', 'https://www.xiaohongshu.com/explore/example'],
    ['即刻技术团队：关于构建产品、组织协作与长期主义的一些思考', 'https://www.zhihu.com/people/jike'],
    ['一人公司榜 | 出海去孵化器', 'https://solopreneur.example/'],
    ['Shopify Editions | Winter ’26', 'https://www.shopify.com/editions/winter2026'],
    ['Agent Use Cases: what people are actually doing with AI agents', 'https://agentusecases.ai/'],
  ];
  const added = [];
  for (const [title, url] of examples) added.push(await bookmarkCall('create', { parentId: barId, title, url }));
  await waitForIds([...added.toReversed().map(({ id }) => id), second.id, first.id]);
  await page.evaluate(() => document.activeElement.blur());
  await page.mouse.move(0, 0);

  for (const [name, width, colorScheme] of [['light', 1440, 'light'], ['dark', 1440, 'dark'], ['narrow', 390, 'light']]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme });
    const layout = await page.evaluate(() => ({
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
      titlesFit: [...document.querySelectorAll('.bookmark-title')].every((title) => title.scrollWidth <= title.clientWidth),
      wrappedTitle: [...document.querySelectorAll('.bookmark-title')].some((title) => title.clientHeight > parseFloat(getComputedStyle(title).lineHeight) * 1.5),
      items: [...document.querySelectorAll('.bookmark-item')].map((item) => {
        const { x, y, height } = item.getBoundingClientRect();
        return { x, y, height };
      }),
    }));
    assert.equal(layout.pageFits, true, `${name}: no horizontal page overflow`);
    assert.equal(layout.titlesFit, true, `${name}: titles are not clipped`);
    if (name === 'narrow') assert.equal(layout.wrappedTitle, true, 'Long titles should wrap on narrow screens');
    if (name === 'narrow') {
      assert.equal(new Set(layout.items.map(({ x }) => x)).size, 1, 'Narrow windows use one column');
    } else {
      const left = layout.items.filter((_, index) => index % 2 === 0);
      const right = layout.items.filter((_, index) => index % 2 === 1);
      assert.equal(left.length, 5);
      assert.equal(right.length, 4);
      for (let index = 0; index < right.length; index++) {
        assert.ok(left[index].x < right[index].x, 'Consecutive bookmarks read left to right');
        assert.equal(left[index].y, right[index].y, 'Paired bookmarks start at the same height');
        assert.equal(left[index].height, right[index].height, 'Long titles give both cells the same height');
      }
      assert.equal(left.at(-1).y, right.at(-1).y + right.at(-1).height, 'Only the left column gets the odd final bookmark');
    }
    await page.screenshot({ path: path.join(artifacts, `inbox-${name}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' });
  const last = added.at(-1);
  await bookmarkCall('move', last.id, { parentId: category.id });
  await waitForIds([...added.slice(0, -1).reverse().map(({ id }) => id), second.id, first.id]);
  const evenColumns = await page.locator('.bookmark-item').evaluateAll((items) => {
    const heights = [0, 0];
    items.forEach((item, index) => { heights[index % 2] += item.getBoundingClientRect().height; });
    return heights;
  });
  assert.equal(evenColumns[0], evenColumns[1], 'Archiving from nine to eight bookmarks leaves two exactly equal columns');
  await page.screenshot({ path: path.join(artifacts, 'inbox-even.png'), fullPage: true });
  await bookmarkCall('move', last.id, { parentId: barId });
  await waitForIds([...added.toReversed().map(({ id }) => id), second.id, first.id]);
  for (const { id } of added) await bookmarkCall('remove', id);
  await waitForIds([second.id, first.id]);
});

test('API read failures show a retry state, and retry recovers without losing bookmarks', async () => {
  await page.evaluate(() => {
    window.originalGetTree = chrome.bookmarks.getTree;
    chrome.bookmarks.getTree = async () => { throw new Error('Simulated read failure'); };
    document.querySelector('#retry').dispatchEvent(new Event('click'));
  });
  await page.locator('#retry').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#state-title').textContent(), '暂时无法读取书签');
  assert.equal(await page.locator('#bookmark-count').isVisible(), false);
  await page.evaluate(() => { chrome.bookmarks.getTree = window.originalGetTree; });
  await page.locator('#retry').click();
  await waitForIds([second.id, first.id]);
  assert.equal(await page.locator('#state').isVisible(), false);
});

test('out-of-order asynchronous reads cannot overwrite the newer bookmark list', async () => {
  await page.evaluate(async () => {
    window.originalGetTree = chrome.bookmarks.getTree;
    const staleTree = await chrome.bookmarks.getTree();
    let reads = 0;
    chrome.bookmarks.getTree = () => {
      if (reads++ === 0) return new Promise((resolve) => { window.resolveStaleTree = () => resolve(staleTree); });
      return window.originalGetTree();
    };
    document.querySelector('#retry').dispatchEvent(new Event('click'));
  });
  const added = await bookmarkCall('create', { parentId: barId, title: 'Newest bookmark', url: 'https://newest.example/' });
  await waitForIds([added.id, second.id, first.id]);
  await page.evaluate(() => {
    window.resolveStaleTree();
    chrome.bookmarks.getTree = window.originalGetTree;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await waitForIds([added.id, second.id, first.id]);
  await bookmarkCall('remove', added.id);
  await waitForIds([second.id, first.id]);
});

test('native deletion updates the count and returns to the empty state', async () => {
  await bookmarkCall('remove', first.id);
  await waitForIds([second.id]);
  await bookmarkCall('remove', second.id);
  await page.locator('#state').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#bookmark-count').textContent(), '0');
  await page.screenshot({ path: path.join(artifacts, 'inbox-empty.png'), fullPage: true });
});

test('the management button opens the native Chrome bookmark manager in a separate tab', async () => {
  const [managerPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('.manage-link').click(),
  ]);
  await managerPage.waitForURL('chrome://bookmarks/');
  assert.equal(await page.locator('#inbox-title').textContent(), '待阅读');
  await managerPage.close();
});
