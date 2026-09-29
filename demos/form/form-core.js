(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResearchForm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const STORAGE_KEY = 'frontend-data-lab.research-form.v1';
  const STEPS = ['basics', 'plan', 'review', 'complete'];
  const FIELDS = [
    { key: 'title', step: 'basics', label: '项目名称', type: 'text', min: 4, max: 80, hint: '用一句清楚的话命名你的研究，4–80 个字符。', placeholder: '例如：面向新闻文本的主题探索' },
    { key: 'area', step: 'basics', label: '研究方向', type: 'select', options: [['nlp', '自然语言处理'], ['multimodal', '多模态学习'], ['data', '数据分析与可视化']], hint: '选择最接近项目的一个方向。' },
    { key: 'question', step: 'plan', label: '想解决什么问题？', type: 'textarea', min: 20, max: 600, hint: '描述具体问题、研究对象或比较方式，20–600 个字符。', placeholder: '例如：比较不同新闻主题的关键词分布，观察主题之间的相似性，并用可视化解释差异。' },
    { key: 'source', step: 'plan', label: '数据来源', type: 'select', options: [['synthetic', '合成数据 · 用于教学演示'], ['public', '公开数据集'], ['local', '已有本地数据']], hint: '本页面不会读取或上传任何数据文件。' },
    { key: 'dataNote', step: 'plan', label: '数据准备说明', type: 'textarea', min: 10, max: 300, when: values => values.source === 'public' || values.source === 'local', hint: '简要说明数据来源与可用性，10–300 个字符；无需填写敏感内容。', placeholder: '例如：使用已公开的新闻标题样本，保留数据来源与许可说明。' },
    { key: 'output', step: 'plan', label: '预期产出', type: 'select', options: [['notebook', '分析 Notebook'], ['report', '研究报告'], ['prototype', '交互原型']], hint: '先确定一个可以展示和检查的成果。' }
  ];

  function emptyValues() {
    return Object.fromEntries(FIELDS.map(field => [field.key, '']));
  }

  function createState() { return { step: 'basics', values: emptyValues() }; }

  function visible(field, values) { return !field.when || field.when(values); }

  function validateStep(step, values) {
    const errors = {};
    for (const field of FIELDS.filter(field => field.step === step && visible(field, values))) {
      const value = typeof values[field.key] === 'string' ? values[field.key].trim() : '';
      if (!value) errors[field.key] = `请填写${field.label.replace('？', '')}。`;
      else if (field.options && !field.options.some(option => option[0] === value)) errors[field.key] = '请选择列表中的选项。';
      else if (field.min && value.length < field.min) errors[field.key] = `请至少输入 ${field.min} 个字符。`;
      else if (field.max && value.length > field.max) errors[field.key] = `请控制在 ${field.max} 个字符以内。`;
    }
    return errors;
  }

  function validateAll(values) {
    return { ...validateStep('basics', values), ...validateStep('plan', values) };
  }

  function updateField(state, key, value) {
    if (state.step === 'complete') throw new Error('Completed forms cannot be edited');
    if (!FIELDS.some(field => field.key === key) || typeof value !== 'string') throw new TypeError('Unknown field or invalid value');
    return { ...state, values: { ...state.values, [key]: value } };
  }

  function transition(state, action) {
    if (!STEPS.includes(state.step)) throw new Error('Unknown state');
    const table = {
      basics: { NEXT: 'plan', RESET: 'basics' },
      plan: { NEXT: 'review', BACK: 'basics', RESET: 'basics' },
      review: { COMPLETE: 'complete', BACK: 'plan', EDIT_BASICS: 'basics', EDIT_PLAN: 'plan', RESET: 'basics' },
      complete: { RESET: 'basics' }
    };
    if (!Object.prototype.hasOwnProperty.call(table[state.step], action)) throw new Error(`Invalid transition: ${state.step} / ${action}`);
    if (action === 'RESET') return { state: createState(), errors: {} };
    let errors = {};
    if (action === 'NEXT') errors = validateStep(state.step, state.values);
    if (action === 'COMPLETE' || (action === 'NEXT' && state.step === 'plan')) errors = validateAll(state.values);
    if (Object.keys(errors).length) return { state, errors };
    return { state: { step: table[state.step][action], values: { ...state.values } }, errors: {} };
  }

  function encodeDraft(state, now = new Date().toISOString()) {
    if (!['basics', 'plan', 'review'].includes(state.step)) throw new Error('Only editable states can be saved');
    return JSON.stringify({ version: VERSION, savedAt: now, step: state.step, values: state.values });
  }

  function decodeDraft(raw) {
    if (raw === null || raw === undefined || raw === '') return { status: 'empty', state: createState() };
    try {
      if (typeof raw !== 'string' || raw.length > 50000) throw new Error('Invalid draft size');
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== 'object') throw new Error('Invalid draft');
      if (draft.version !== VERSION) return { status: 'unsupported', state: createState() };
      if (!['basics', 'plan', 'review'].includes(draft.step) || !draft.values || typeof draft.values !== 'object' || Array.isArray(draft.values)) throw new Error('Invalid shape');
      if (typeof draft.savedAt !== 'string' || !Number.isFinite(Date.parse(draft.savedAt))) throw new Error('Invalid timestamp');
      const values = emptyValues();
      for (const field of FIELDS) {
        const value = draft.values[field.key];
        if (typeof value !== 'string' || value.length > (field.max || 100)) throw new Error('Invalid field');
        if (value && field.options && !field.options.some(option => option[0] === value)) throw new Error('Invalid option');
        values[field.key] = value;
      }
      let step = draft.step;
      if (Object.keys(validateStep('basics', values)).length) step = 'basics';
      else if (step === 'review' && Object.keys(validateStep('plan', values)).length) step = 'plan';
      return { status: 'valid', state: { step, values }, savedAt: draft.savedAt };
    } catch (_) {
      return { status: 'invalid', state: createState() };
    }
  }

  return { VERSION, STORAGE_KEY, STEPS, FIELDS, createState, visible, validateStep, validateAll, updateField, transition, encodeDraft, decodeDraft };
});
