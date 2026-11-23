import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('./liczip.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="core")?>([\s\S]*?)<\/script>/g)];
const compiled = scripts.map(([, body]) => new vm.Script(body));
const core = vm.runInNewContext(scripts[0][1] +
  '\n({ parseZip, inspectZip, assess, markdown, parseExpression, limits })',
  { Blob, DecompressionStream, TextDecoder, setTimeout });
const bytes = name => readFileSync(new URL(`./samples/${name}.zip`, import.meta.url));
const samples = {};
for (const name of ['licenses', 'mixed', 'boundaries', 'empty', 'nested']) {
  samples[name] = await core.inspectZip(bytes(name));
}
const assess = (name, mode = 'commercial') => core.assess(samples[name], mode);
const row = (result, path) => {
  const found = result.rows.find(entry => entry.path === path);
  assert.ok(found, path);
  return found;
};

const classifications = [
  ['MIT', 'low', 'low', 'low'], ['BSD-2-Clause', 'low', 'low', 'low'],
  ['BSD-3-Clause', 'low', 'low', 'low'], ['Apache-2.0', 'low', 'low', 'low'],
  ['ISC', 'low', 'low', 'low'], ['Unlicense', 'low', 'low', 'low'],
  ['CC0-1.0', 'low', 'low', 'low'], ['GPL-2.0', 'high', 'high', 'medium'],
  ['GPL-3.0', 'high', 'high', 'medium'], ['LGPL-2.1', 'medium', 'medium', 'low'],
  ['LGPL-3.0', 'medium', 'medium', 'low'], ['AGPL-3.0', 'high', 'high', 'medium'],
  ['MPL-2.0', 'medium', 'medium', 'low'], ['EPL-2.0', 'medium', 'medium', 'low'],
  ['CC-BY-4.0', 'low', 'low', 'low'], ['CC-BY-SA-4.0', 'medium', 'medium', 'medium'],
  ['CC-BY-NC-4.0', 'high', 'low', 'medium'], ['CC-BY-NC-SA-4.0', 'high', 'low', 'medium'],
  ['CC-BY-ND-4.0', 'medium', 'medium', 'medium'], ['Public Domain', 'low', 'low', 'low']
];
const modes = ['commercial', 'free', 'oss'];
const evaluations = modes.map(mode => assess('licenses', mode));
for (const [identifier, ...risks] of classifications) {
  test(`${identifier} の本文分類・継承・3配布形態の判定`, () => {
    for (const [index, result] of evaluations.entries()) {
      const entry = row(result, `components/${identifier}/work.txt`);
      assert.equal(entry.labels.join(), identifier);
      assert.equal(entry.risk, risks[index]);
      assert.match(entry.evidence.join(), /COPYING|LICENCE\.txt/);
    }
  });
}

test('stored / deflate、データディスクリプタ、UTF-8ファイル名を読み取る', () => {
  const result = assess('mixed');
  assert.equal(row(result, 'LICENSE').method, 0);
  assert.equal(row(result, 'src/main.js').method, 8);
  assert.equal(row(result, 'src/main.js').labels.join(), 'MIT');
  assert.equal(row(result, '素材/art.svg').labels.join(), 'CC-BY-NC-SA-4.0');
});

test('小計はファイル数と一致し、ディレクトリも一覧に載る', () => {
  const result = evaluations[0];
  assert.equal(result.files, 40);
  assert.equal(result.rows.length, 60);
  assert.equal(row(result, 'components/MIT/').risk, '');
  assert.equal(Object.values(result.counts).reduce((total, count) => total + count), result.files);
});

test('下位ディレクトリとファイル自身のSPDX宣言を優先する', () => {
  const result = assess('mixed');
  assert.equal(row(result, 'vendor/copyleft/src/module.js').labels.join(), 'GPL-3.0');
  assert.equal(row(result, 'vendor/copyleft/override.js').labels.join(), 'Apache-2.0');
  assert.ok(row(result, 'vendor/copyleft/override.js').tasks.includes('include'));
  assert.equal(row(result, 'vendor/copyleft/override.js').risk, 'high');
  assert.match(row(result, 'vendor/copyleft/override.js').evidence.join(), /適用範囲要確認/);
  assert.ok(row(result, 'vendor/copyleft/override.js').tasks.includes('notice'));
  assert.ok(!row(result, 'src/main.js').tasks.includes('include'));
  assert.equal(row(result, 'vendor/ambiguous/nothing.js').labels.length, 0);
});

test('SPDX複合式は式全体を要確認にし、部分判定しない', () => {
  const result = assess('mixed');
  const expression = row(result, 'other/expression.js');
  assert.equal(expression.risk, 'unknown');
  assert.ok(expression.tasks.includes('expression'));
  assert.ok(!expression.tasks.includes('source'));
  assert.equal(row(result, 'other/custom.txt').risk, 'unknown');
  assert.equal(row(result, 'other/vendor-license.txt').risk, 'unknown');
  assert.equal(core.parseExpression('MIT OR (GPL-3.0-only').ids.length, 0);
});

test('第三者らしい不明ファイル・一般の不明ファイルを区別する', () => {
  for (const [i, mode] of modes.entries()) {
    const result = assess('boundaries', mode);
    assert.equal(row(result, 'vendor/asset.png').risk, ['high', 'medium', 'medium'][i]);
    assert.equal(row(result, 'local.txt').risk, 'unknown');
  }
});

test('NC素材の対応は配布形態によって変わる', () => {
  const path = '素材/art.svg';
  assert.ok(row(assess('mixed'), path).tasks.includes('remove'));
  assert.ok(row(assess('mixed', 'free'), path).tasks.includes('nc'));
  assert.ok(row(assess('mixed', 'oss'), path).tasks.includes('sa'));
});

test('NOTICE / AUTHORS / CREDITS を帰属情報の候補として記録する', () => {
  const entry = row(assess('boundaries'), 'other/art.svg');
  assert.equal(entry.labels.join(), 'CC-BY-4.0');
  assert.match(entry.evidence.join(), /NOTICE.*AUTHORS\.md.*CREDITS/);
  assert.ok(entry.tasks.includes('attribution'));
  assert.ok(!entry.tasks.includes('credits'));
  const withoutCredits = row(evaluations[0], 'components/CC-BY-4.0/work.txt');
  assert.ok(withoutCredits.tasks.includes('credits'));
});

test('1階層目のネストZIPを検査し、アーカイブ間で継承を分離する', () => {
  const result = assess('nested');
  assert.equal(row(result, 'bundle/one.ZIP › hidden.js').risk, 'high');
  assert.equal(row(result, 'bundle/two.zip › plain.txt').labels.length, 0);
  assert.equal(row(result, 'bundle/two.zip › vendor/sample/work.txt').labels.join(), 'GPL-3.0');
  assert.match(row(result, 'bundle/two.zip › deeper.zip').issue, /2階層目/);
  assert.ok(!result.rows.some(entry => entry.path.includes('deeper.zip ›')));
  assert.match(row(result, 'bundle/bad.zip').issue, /終端/);
  assert.match(row(result, 'bundle/empty.zip').evidence.join(), /検査済み/);
  assert.equal(result.state, '部分検査');
  assert.match(core.markdown(result, 'nested.zip'), /bundle\/two.*deeper/);
});

test('SPDXはバイト単位の先頭2 KiBのみを照合し、長い本文も末尾までCRCを検査する', () => {
  const result = assess('boundaries');
  assert.equal(row(result, 'unicode.js').labels.length, 0);
  assert.equal(row(result, 'prefix.js').labels.join(), 'MIT');
  assert.match(row(result, 'large.js').issue, /上限/);
  assert.match(row(result, 'late-crc.txt').issue, /CRC/);
  assert.equal(row(result, 'late-crc.txt').labels.length, 0);
});

test('CRC不整合と特殊パスを警告する', () => {
  const result = assess('boundaries');
  assert.match(row(result, 'broken.txt').issue, /CRC/);
  assert.match(result.rows.find(entry => entry.path.endsWith('../unsafe.js')).issue, /特殊なパス/);
  assert.ok(row(result, 'broken.txt').tasks.includes('unread'));
});

test('不明圧縮方式と暗号化を明示する', async () => {
  const changed = Buffer.from(bytes('mixed'));
  const first = changed.indexOf(Buffer.from([0x50, 0x4b, 1, 2]));
  changed.writeUInt16LE(99, first + 10);
  assert.match((await core.parseZip(changed))[0].issue, /未対応/);
  changed.writeUInt16LE(1, first + 8);
  assert.match((await core.parseZip(changed))[0].issue, /暗号化/);
});

test('非ZIP・切り詰め・分割・ZIP64を拒否し、空ZIPを扱う', async () => {
  await assert.rejects(() => core.parseZip(Buffer.from('fiction')), /終端/);
  await assert.rejects(() => core.parseZip(bytes('mixed').subarray(0, -1)), /終端/);
  const changed = Buffer.from(bytes('empty'));
  changed.writeUInt16LE(1, 4);
  await assert.rejects(() => core.parseZip(changed), /分割/);
  changed.writeUInt16LE(0xffff, 10);
  await assert.rejects(() => core.parseZip(changed), /ZIP64/);
  assert.equal(assess('empty').rows.length, 0);
});

test('Markdown出力に根拠・義務・免責文があり、ZIP由来の記号をエスケープする', () => {
  const report = core.markdown(assess('mixed'), '<fake>.zip');
  assert.match(report, /有料・商用配布/);
  assert.match(report, /- \[ \] 非商用条件の素材を除去/);
  assert.match(report, /法的判断/);
  assert.match(report, /&#60;偽&#62;&#124;&#91;資料&#93;/);
  assert.ok(!report.includes('<fake>'));
});

test('単一HTMLの両スクリプトが構文解析でき、通信をCSPで禁止する', () => {
  assert.equal(compiled.length, 2);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]*\b(?:src|href)=/i);
});

test('第三者の境界外のMITは継承せず、近傍の未分類文で継承を止める', () => {
  const result = assess('mixed');
  assert.equal(row(result, 'vendor/ambiguous/nothing.js').risk, 'high');
  assert.equal(row(result, 'vendor/ambiguous/nothing.js').labels.length, 0);
  assert.match(row(result, 'vendor/ambiguous/nothing.js').evidence.join(), /本文パターンが不明/);
  assert.equal(row(result, 'other/<偽>|[資料].txt').labels.join(), 'MIT');
  assert.equal(row(assess('boundaries'), 'invalid/work.txt').labels.length, 0);
});

test('パス衝突の親と配下を未検査にし、誤った継承を防ぐ', () => {
  const result = assess('boundaries');
  for (const path of ['collision', 'collision/LICENSE', 'collision/work.txt']) {
    const entry = row(result, path);
    assert.match(entry.issue, /衝突/);
    assert.equal(entry.labels.length, 0);
  }
});

test('配布形態変更では高・中・不明・低の順に再集計する', () => {
  const order = ['high', 'medium', 'unknown', 'low', ''];
  for (const mode of modes) {
    const result = assess('mixed', mode);
    const levels = result.rows.map(entry => order.indexOf(entry.risk));
    assert.deepEqual([...levels].sort((a, b) => a - b), [...levels]);
    assert.equal(result.review, result.rows.filter(entry => entry.review).length);
  }
});

test('圧縮比・ネストZIPの上限を適用し、他のファイルを続けて検査する', async () => {
  assert.match(row(assess('boundaries'), 'ratio.js').issue, /圧縮比/);
  const previous = core.limits.nested;
  try {
    core.limits.nested = 22;
    const result = core.assess(await core.inspectZip(bytes('nested')), 'commercial');
    assert.match(row(result, 'bundle/one.ZIP').issue, /サイズ上限/);
    assert.match(row(result, 'bundle/empty.zip').evidence.join(), /検査済み/);
    assert.match(row(result, 'LICENSE').labels.join(), /MIT/);
  } finally {
    core.limits.nested = previous;
  }
});

test('失敗した本文の展開量も共有予算を消費し、残りで読める候補は検査する', async () => {
  const previous = core.limits.output;
  try {
    // Start with room for exactly the corrupted entry and the following 2-byte file.
    const fixture = bytes('budgets');
    core.limits.output = 34;
    const result = core.assess(await core.inspectZip(new Blob([fixture])), 'commercial');
    assert.match(row(result, 'a.txt').issue, /CRC/);
    assert.match(row(result, 'b.txt').issue, /合計上限/);
    assert.equal(row(result, 'c.txt').issue, '');
  } finally {
    core.limits.output = previous;
  }
});

test('共有展開予算にはネストZIP本体と子エントリの双方を含める', async () => {
  const previous = core.limits.output;
  try {
    const outer = await core.parseZip(bytes('nested'));
    const parent = outer.find(entry => entry.path === 'bundle/one.ZIP');
    core.limits.output = parent.size + outer[0].size;
    const result = core.assess(await core.inspectZip(bytes('nested')), 'commercial');
    assert.match(row(result, 'bundle/one.ZIP › hidden.js').issue, /合計上限/);
  } finally {
    core.limits.output = previous;
  }
});

test('中止後は本文検査の結果を返さない', async () => {
  const controller = new AbortController();
  await assert.rejects(() => core.inspectZip(bytes('mixed'), {
    signal: controller.signal,
    progress: () => controller.abort()
  }), { name: 'AbortError' });
});

test('deflate未対応でもstoredを検査し、部分検査を出力する', async () => {
  const fallback = vm.runInNewContext(scripts[0][1] + '\n({ inspectZip, assess })',
    { Blob, TextDecoder, setTimeout });
  const result = fallback.assess(await fallback.inspectZip(bytes('mixed')), 'commercial');
  assert.equal(row(result, 'LICENSE').labels.join(), 'MIT');
  assert.match(row(result, 'src/main.js').issue, /deflate.*未対応/);
  assert.equal(result.state, '部分検査');
});

test('データ記述子の不一致は個別未検査として表示する', async () => {
  const changed = Buffer.from(bytes('mixed'));
  const entries = await core.parseZip(changed);
  const first = entries[0];
  const descriptor = first.dataStart + first.compressed;
  assert.equal(changed.readUInt32LE(descriptor), 0x08074b50);
  changed[descriptor + 4] ^= 1;
  const result = core.assess(await core.inspectZip(changed), 'commercial');
  assert.match(row(result, 'LICENSE').issue, /データ記述子/);
  assert.equal(row(result, 'src/main.js').labels.join(), 'MIT');
});

test('コメント内の無効なEOCD候補を飛ばす', async () => {
  const empty = Buffer.from(bytes('empty'));
  empty.writeUInt16LE(22, 20);
  const invalid = Buffer.from(bytes('empty'));
  invalid.writeUInt16LE(1, 4);
  assert.equal((await core.parseZip(Buffer.concat([empty, invalid]))).length, 0);
});

test('CP932系ファイル名・本文とUnicode Path extraを読み取る', async () => {
  const result = core.assess(await core.inspectZip(bytes('encoding')), 'commercial');
  for (const path of ['資料.js', '見本.js']) assert.equal(row(result, path).labels.join(), 'MIT');
  assert.match(row(result, '資料.js').evidence.join(), /CP932系/);
  assert.match(row(result, '見本.js').evidence.join(), /Unicode Path extra/);
});

test('SPDXを正式表記に限定し、GNU旧表記のみ正規化する', () => {
  for (const value of ['mit', 'MIT OR ISC', 'CC-BY', 'MIT-only', 'LicenseRef-Fictional']) {
    assert.equal(core.parseExpression(value).ids.length, 0);
  }
  assert.equal(core.parseExpression('GPL-2.0+').ids.join(), 'GPL-2.0-or-later');
  assert.equal(core.parseExpression('GPL-2.0').ids.join(), 'GPL-2.0-only');
  assert.equal(core.parseExpression('CC-BY-2.5').ids.join(), 'CC-BY-2.5');
});

test('画面の選択・実行・再判定・コピー失敗時・中止・差し替えを確認する', async () => {
  class Element {
    children = [];
    handlers = new Map();
    hidden = false;
    addEventListener(event, handler) { this.handlers.set(event, handler); }
    emit(event, data) { return this.handlers.get(event)(data); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    querySelector() { return this.checkedMode; }
    focus() { this.focused = true; }
    select() { this.selected = true; }
  }
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const document = {
    getElementById: get,
    createElement: () => new Element(),
    createDocumentFragment: () => new Element(),
    execCommand: () => false
  };
  vm.runInNewContext(scripts.map(([, body]) => body).join('\n'), {
    document, Blob, DecompressionStream, TextDecoder, setTimeout, AbortController,
    navigator: { clipboard: { writeText: async () => { throw new Error('fixture'); } } }
  });
  const mockedZip = new File([bytes('mixed')], 'fictional.zip');
  get('archive').files = [mockedZip];
  get('archive').emit('change');
  assert.match(get('selected-file').textContent, /fictional\.zip/);
  assert.equal(get('scan').disabled, true);
  get('mode').checkedMode = { value: 'commercial' };
  get('mode').emit('change');
  assert.equal(get('scan').disabled, false);
  await get('scan').emit('click');
  assert.equal(get('results').hidden, false);
  assert.match(get('report').value, /商用配布/);
  get('mode').checkedMode = { value: 'oss' };
  get('mode').emit('change');
  assert.match(get('report').value, /OSSとして公開/);
  await get('copy').emit('click');
  assert.equal(get('report').hidden, false);
  assert.equal(get('report').selected, true);
  const inFlight = get('scan').emit('click');
  assert.equal(get('cancel').hidden, false);
  get('cancel').emit('click');
  await inFlight;
  assert.equal(get('report').value, '');
  assert.equal(get('results').hidden, true);
  assert.match(get('status').textContent, /中止/);
  get('drop').emit('drop', { preventDefault() {}, dataTransfer: { files: [mockedZip, mockedZip] } });
  assert.equal(get('scan').disabled, true);
  assert.match(get('status').textContent, /1件ずつ/);
});

test('入力・中央ディレクトリ・件数の上限と等値を確認する', async () => {
  const fixture = bytes('mixed');
  const count = fixture.readUInt16LE(fixture.length - 12);
  const central = fixture.readUInt32LE(fixture.length - 10);
  for (const [key, boundary] of [['archive', fixture.length], ['entries', count], ['central', central]]) {
    const original = core.limits[key];
    try {
      core.limits[key] = boundary;
      assert.equal((await core.parseZip(fixture)).length, count);
      core.limits[key]--;
      await assert.rejects(() => core.parseZip(fixture), /まで|上限/);
    } finally {
      core.limits[key] = original;
    }
  }
});

test('子ZIPのエントリ数も共有上限に含める', async () => {
  const fixture = bytes('nested');
  const original = core.limits.entries;
  try {
    core.limits.entries = (await core.parseZip(fixture)).length;
    const result = core.assess(await core.inspectZip(fixture), 'commercial');
    assert.match(row(result, 'bundle/one.ZIP').issue, /エントリ数の合計上限/);
    assert.match(row(result, 'bundle/empty.zip').evidence.join(), /検査済み/);
  } finally {
    core.limits.entries = original;
  }
});
