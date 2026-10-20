import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectInbox, describeBookmark } from '../bookmarks.js';

test('only direct bookmark-bar links appear, preserving ties and duplicate URLs', () => {
  const tree = [{ id: '0', children: [
    { id: 'bar', folderType: 'bookmarks-bar', children: [
      { id: 'a', title: 'First', url: 'https://example.com/' },
      { id: 'category', title: 'AI', children: [{ id: 'archived', url: 'https://archived.example/' }] },
      { id: 'b', title: 'Second', url: 'https://second.example/' },
      { id: 'duplicate', title: 'A second bookmark', url: 'https://example.com/' },
    ] },
    { id: 'other', folderType: 'other', children: [{ id: 'other-link', url: 'https://other.example/' }] },
    { id: 'mobile', folderType: 'mobile', children: [{ id: 'mobile-link', url: 'https://mobile.example/' }] },
  ] }];
  assert.deepEqual(collectInbox(tree).map(({ id }) => id), ['a', 'b', 'duplicate']);
});

test('inbox sorts by newest creation time rather than reversing native order, without changing the bookmark bar', () => {
  const children = [
    { id: 'middle', title: 'Middle', url: 'https://middle.example/', dateAdded: 20 },
    { id: 'newest', title: 'Newest', url: 'https://newest.example/', dateAdded: 30 },
    { id: 'missing', title: 'Missing date', url: 'https://missing.example/' },
    { id: 'oldest', title: 'Oldest', url: 'https://oldest.example/', dateAdded: 10 },
    { id: 'tie', title: 'Same time', url: 'https://tie.example/', dateAdded: 30 },
    { id: 'archived', title: 'AI', children: [{ id: 'excluded', url: 'https://excluded.example/', dateAdded: 40 }] },
  ];
  const tree = [{ id: '0', children: [{ id: '1', folderType: 'bookmarks-bar', children }] }];
  assert.deepEqual(collectInbox(tree).map(({ id }) => id), ['newest', 'tie', 'middle', 'oldest', 'missing']);
  assert.deepEqual(children.map(({ id }) => id), ['middle', 'newest', 'missing', 'oldest', 'tie', 'archived']);
});

test('localized folder names and multiple local/account bookmark bars do not depend on a fixed ID', () => {
  const tree = [{ id: '0', children: [
    { id: '77', title: '收藏栏', folderType: 'bookmarks-bar', children: [{ id: 'local', url: 'https://local.example/' }] },
    { id: '103', title: 'ブックマーク バー', folderType: 'bookmarks-bar', children: [{ id: 'account', url: 'https://account.example/' }] },
    { id: '1', title: 'Bookmarks bar', folderType: 'other', children: [{ id: 'wrong', url: 'https://wrong.example/' }] },
  ] }];
  assert.deepEqual(collectInbox(tree).map(({ id }) => id), ['local', 'account']);
});

test('legacy Chrome fallback uses the built-in bar ID rather than a matching folder title', () => {
  const tree = [{ id: '0', children: [
    { id: '1', title: '书签栏', children: [{ id: 'pending', url: 'https://pending.example/' }] },
    { id: '2', title: 'Bookmarks bar', children: [{ id: 'other', url: 'https://other.example/' }] },
  ] }];
  assert.deepEqual(collectInbox(tree).map(({ id }) => id), ['pending']);
  assert.deepEqual(collectInbox([{ id: '0', children: [] }]), []);
});

test('script and malformed bookmarks remain visible without becoming executable links', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'bad url']) {
    const description = describeBookmark({ title: 'A bookmark', url });
    assert.equal(description.navigable, false, url);
    assert.equal(description.favicon, false, url);
  }
  assert.equal(describeBookmark({ title: 'Search', url: 'https://www.google.com/' }).domain, 'google.com');
  assert.equal(describeBookmark({ title: '  ', url: 'https://example.com/' }).title, 'https://example.com/');
  assert.equal(describeBookmark({ title: 'Bookmarks', url: 'chrome://bookmarks/' }).navigable, true);
});
