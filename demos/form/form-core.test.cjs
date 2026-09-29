const test = require('node:test');
const assert = require('node:assert/strict');
const form = require('./form-core.js');

function validState(step = 'basics') {
  return { step, values: { title: '新闻主题探索', area: 'nlp', question: '比较不同新闻主题的关键词分布，观察主题之间的相似性，并用可视化解释差异。', source: 'synthetic', dataNote: '', output: 'notebook' } };
}

test('validation blocks progression and preserves the original state', () => {
  const state = form.createState();
  const result = form.transition(state, 'NEXT');
  assert.equal(result.state, state);
  assert.deepEqual(Object.keys(result.errors), ['title', 'area']);
  assert.equal(state.step, 'basics');
  assert.equal(form.validateStep('basics', { title: '   ', area: 'invalid' }).area, '请选择列表中的选项。');
});

test('all steps, backward navigation, editing and reset follow explicit transitions', () => {
  let state = validState();
  state = form.transition(state, 'NEXT').state;
  assert.equal(state.step, 'plan');
  assert.equal(form.transition(state, 'BACK').state.step, 'basics');
  state = form.transition(state, 'NEXT').state;
  assert.equal(state.step, 'review');
  assert.equal(form.transition(state, 'EDIT_BASICS').state.step, 'basics');
  assert.equal(form.transition(state, 'EDIT_PLAN').state.step, 'plan');
  state = form.transition(state, 'COMPLETE').state;
  assert.equal(state.step, 'complete');
  assert.deepEqual(form.transition(state, 'RESET').state, form.createState());
  assert.throws(() => form.transition(state, 'NEXT'), /Invalid transition/);
  assert.throws(() => form.transition(validState(), 'toString'), /Invalid transition/);
  assert.throws(() => form.transition(validState(), 'COMPLETE'), /Invalid transition/);
  assert.throws(() => form.updateField(state, 'title', 'changed'), /cannot be edited/);
});

test('conditional fields are required only for public or local data', () => {
  const state = validState('plan');
  assert.deepEqual(form.validateAll(state.values), {});
  for (const source of ['public', 'local']) {
    const changed = form.updateField(state, 'source', source);
    assert.ok(form.validateStep('plan', changed.values).dataNote);
    assert.equal(form.visible(form.FIELDS.find(field => field.key === 'dataNote'), changed.values), true);
    const ready = form.updateField(changed, 'dataNote', '使用公开新闻标题样本，保留原始来源与许可说明。');
    assert.deepEqual(form.transition(ready, 'NEXT').errors, {});
  }
  assert.equal(state.values.source, 'synthetic');
});

test('final confirmation revalidates all fields and rejects invalid bounds', () => {
  const state = validState('review');
  state.values.title = 'x'.repeat(81);
  state.values.question = 'short';
  const result = form.transition(state, 'COMPLETE');
  assert.ok(result.errors.title);
  assert.ok(result.errors.question);
  assert.equal(result.state.step, 'review');
});

test('versioned drafts round-trip without mutating values', () => {
  const state = validState('review');
  const now = '2026-09-30T00:00:00.000Z';
  const restored = form.decodeDraft(form.encodeDraft(state, now));
  assert.equal(restored.status, 'valid');
  assert.equal(restored.savedAt, now);
  assert.deepEqual(restored.state, state);
  assert.notEqual(restored.state.values, state.values);
  assert.throws(() => form.encodeDraft(validState('complete')), /editable/);
});

test('bad, oversized and unsupported drafts recover to a blank state', () => {
  const raw = JSON.parse(form.encodeDraft(validState()));
  const badCases = ['{bad json', 'null', 'x'.repeat(50001), JSON.stringify({ ...raw, step: 'complete' }), JSON.stringify({ ...raw, savedAt: 'not a date' }), JSON.stringify({ ...raw, values: [] }), JSON.stringify({ ...raw, values: { ...raw.values, source: 'remote' } }), JSON.stringify({ ...raw, values: { ...raw.values, question: 123 } })];
  for (const bad of badCases) {
    const result = form.decodeDraft(bad);
    assert.equal(result.status, 'invalid');
    assert.deepEqual(result.state, form.createState());
  }
  assert.equal(form.decodeDraft(JSON.stringify({ ...raw, version: 999 })).status, 'unsupported');
  assert.equal(form.decodeDraft(null).status, 'empty');
});

test('restored progress cannot skip incomplete steps; unknown keys are discarded', () => {
  const state = validState('review');
  state.values.title = '';
  assert.equal(form.decodeDraft(form.encodeDraft(state)).state.step, 'basics');
  state.values.title = '新闻主题探索';
  state.values.question = '';
  state.values.unexpected = 'not part of the form';
  const result = form.decodeDraft(form.encodeDraft(state));
  assert.equal(result.state.step, 'plan');
  assert.equal(Object.hasOwn(result.state.values, 'unexpected'), false);
});

test('input is retained as text data and cannot introduce unknown fields', () => {
  const text = '<img src=x onerror=alert(1)>';
  const changed = form.updateField(validState(), 'title', text);
  assert.equal(form.decodeDraft(form.encodeDraft(changed)).state.values.title, text);
  assert.throws(() => form.updateField(changed, '__proto__', 'bad'), /Unknown field/);
  assert.throws(() => form.updateField(changed, 'title', {}), /Unknown field/);
});
