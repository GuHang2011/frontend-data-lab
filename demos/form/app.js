(function () {
  'use strict';
  const core = window.ResearchForm;
  const $ = id => document.getElementById(id);
  let state = core.createState();
  let errors = {};
  let saveTimer;
  let dirty = false;
  let storageAvailable = true;
  const controls = new Map();
  const headings = {
    basics: ['THE IDEA', '定义你的项目', '不必面面俱到。先说清楚你想研究什么。'],
    plan: ['THE PLAN', '让想法有一个落点', '写下问题，再选择数据来源与预期产出。'],
    review: ['THE REVIEW', '准备好了，再确认一次', '你可以返回修改。本次登记只在浏览器中完成。'],
    complete: ['READY TO EXPLORE', '一个清楚的起点。', '你已经完成这份项目登记。下一步，让想法继续生长。']
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }

  function storageMessage() { $('save-status').textContent = '本机存储不可用 · 仍可继续填写和导出'; }

  function removeDraft() {
    clearTimeout(saveTimer);
    dirty = false;
    try { window.localStorage.removeItem(core.STORAGE_KEY); }
    catch (_) { storageAvailable = false; }
  }

  function saveDraft() {
    clearTimeout(saveTimer);
    if (state.step === 'complete' || !dirty) return;
    try {
      const now = new Date();
      window.localStorage.setItem(core.STORAGE_KEY, core.encodeDraft(state, now.toISOString()));
      storageAvailable = true;
      $('save-status').textContent = `草稿已保存 · ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
      storageAvailable = false;
      storageMessage();
    }
  }

  function restoreDraft() {
    try {
      const result = core.decodeDraft(window.localStorage.getItem(core.STORAGE_KEY));
      state = result.state;
      if (result.status === 'valid') {
        notice('已恢复上次填写的草稿，你可以接着整理。');
        $('save-status').textContent = '已恢复本机草稿';
      } else if (result.status === 'invalid') {
        notice('上次草稿无法读取，已为你准备空白表单。');
        removeDraft();
      } else if (result.status === 'unsupported') {
        notice('上次草稿的版本暂不支持。你可以重新填写，或点击“清除草稿”。');
      }
    } catch (_) {
      storageAvailable = false;
      notice('浏览器暂不允许保存草稿。本次填写与导出仍可正常使用。');
      storageMessage();
    }
  }

  function updateFieldDisplay() {
    for (const [key, entry] of controls) {
      const isVisible = core.visible(entry.field, state.values);
      entry.wrapper.hidden = !isVisible;
      entry.control.disabled = !isVisible;
      entry.control.required = isVisible;
      const error = isVisible ? errors[key] : '';
      entry.control.setAttribute('aria-invalid', error ? 'true' : 'false');
      entry.error.textContent = error || '';
      entry.error.hidden = !error;
      if (entry.counter) entry.counter.textContent = `${state.values[key].length} / ${entry.field.max}`;
    }
  }

  function buildField(field) {
    const wrapper = element('div', 'field');
    const label = element('label', '', field.label);
    label.htmlFor = `field-${field.key}`;
    label.append(element('span', 'required', '必填'));
    const control = element(field.type === 'select' ? 'select' : field.type === 'textarea' ? 'textarea' : 'input', 'control');
    control.id = `field-${field.key}`;
    control.name = field.key;
    if (field.type === 'text') control.type = 'text';
    if (field.max) control.maxLength = field.max;
    if (field.placeholder) control.placeholder = field.placeholder;
    if (field.options) {
      const placeholder = element('option', '', '请选择');
      placeholder.value = '';
      control.append(placeholder);
      for (const [value, text] of field.options) {
        const option = element('option', '', text);
        option.value = value;
        control.append(option);
      }
    }
    control.value = state.values[field.key];
    const hint = element('div', 'hint');
    hint.id = `hint-${field.key}`;
    hint.append(element('span', '', field.hint));
    const counter = field.max ? element('span', 'counter') : null;
    if (counter) { counter.setAttribute('aria-hidden', 'true'); hint.append(counter); }
    const error = element('p', 'field-error');
    error.id = `error-${field.key}`;
    error.hidden = true;
    control.setAttribute('aria-describedby', `${hint.id} ${error.id}`);
    control.addEventListener('input', () => {
      state = core.updateField(state, field.key, control.value);
      dirty = true;
      if (errors[field.key]) errors[field.key] = core.validateStep(state.step, state.values)[field.key];
      $('error-summary').hidden = true;
      updateFieldDisplay();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveDraft, 350);
    });
    wrapper.append(label, control, hint, error);
    controls.set(field.key, { field, wrapper, control, error, counter });
    return wrapper;
  }

  function renderReview() {
    const review = $('review');
    review.replaceChildren();
    for (const [step, title, action] of [['basics', '01 / 项目概览', 'EDIT_BASICS'], ['plan', '02 / 研究计划', 'EDIT_PLAN']]) {
      const block = element('section', 'review-block');
      const heading = element('div', 'review-heading');
      heading.append(element('span', '', title));
      const edit = element('button', 'text-button', '修改 ↗');
      edit.type = 'button';
      edit.setAttribute('aria-label', `修改${title.slice(5)}`);
      edit.addEventListener('click', () => dispatch(action));
      heading.append(edit);
      const list = element('dl', 'review-list');
      for (const field of core.FIELDS.filter(field => field.step === step && core.visible(field, state.values))) {
        const value = state.values[field.key];
        const label = field.options ? field.options.find(option => option[0] === value)?.[1] || value : value.trim();
        list.append(element('dt', '', field.label), element('dd', '', label));
      }
      block.append(heading, list);
      review.append(block);
    }
    review.append(element('p', 'review-note', '确认后将在本页完成登记，并清除本机草稿。内容不会发送到任何服务器。'));
  }

  function showErrors() {
    const summary = $('error-summary');
    summary.replaceChildren(element('p', '', '还有几处需要补充：'));
    const list = element('ul');
    for (const field of core.FIELDS.filter(field => errors[field.key])) {
      const item = element('li');
      const link = element('a', '', `${field.label}：${errors[field.key]}`);
      link.href = `#field-${field.key}`;
      link.addEventListener('click', event => { event.preventDefault(); $(`field-${field.key}`)?.focus(); });
      item.append(link);
      list.append(item);
    }
    summary.append(list);
    summary.hidden = false;
    updateFieldDisplay();
    summary.focus();
  }

  function render(focusHeading = false) {
    const index = core.STEPS.indexOf(state.step);
    for (const item of document.querySelectorAll('[data-step]')) {
      const itemIndex = core.STEPS.indexOf(item.dataset.step);
      item.classList.toggle('active', itemIndex === index);
      item.classList.toggle('done', itemIndex < index);
      if (itemIndex === index) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
    $('step-label').textContent = index === 3 ? 'COMPLETE / 已完成' : `STEP 0${index + 1} / 03`;
    $('progress-label').textContent = ['开始整理', '继续完善', '即将完成', '整理完成'][index];
    $('progress-fill').style.width = `${index / 3 * 100}%`;
    document.querySelector('.progress-track').setAttribute('aria-valuenow', index);
    const [kicker, title, description] = headings[state.step];
    $('section-kicker').textContent = kicker;
    $('section-title').textContent = title;
    $('section-description').textContent = description;
    $('error-summary').hidden = true;
    controls.clear();
    $('fields').replaceChildren(...core.FIELDS.filter(field => field.step === state.step).map(buildField));
    updateFieldDisplay();
    $('review').hidden = state.step !== 'review';
    if (state.step === 'review') renderReview();
    $('complete').hidden = state.step !== 'complete';
    $('back-button').hidden = !['plan', 'review'].includes(state.step);
    $('export-button').hidden = state.step !== 'complete';
    $('clear-button').hidden = state.step === 'complete';
    $('next-button').textContent = ['继续规划 ↗', '检查登记 ↗', '完成本地登记 ↗', '再整理一个项目 ↗'][index];
    if (focusHeading) $('section-title').focus();
  }

  function dispatch(action) {
    const result = core.transition(state, action);
    errors = result.errors;
    if (Object.keys(errors).length) { showErrors(); return; }
    state = result.state;
    if (action === 'COMPLETE' || action === 'RESET') {
      removeDraft();
      notice('');
      $('save-status').textContent = action === 'COMPLETE' ? '本地流程已完成 · 草稿已清除' : '草稿已清除，可以重新填写';
      if (!storageAvailable) storageMessage();
    } else { dirty = true; saveDraft(); }
    render(true);
  }

  $('project-form').addEventListener('submit', event => {
    event.preventDefault();
    dispatch(state.step === 'complete' ? 'RESET' : state.step === 'review' ? 'COMPLETE' : 'NEXT');
  });
  $('back-button').addEventListener('click', () => dispatch('BACK'));
  $('clear-button').addEventListener('click', () => $('clear-dialog').showModal());
  $('cancel-clear').addEventListener('click', () => $('clear-dialog').close());
  $('confirm-clear').addEventListener('click', () => { $('clear-dialog').close(); dispatch('RESET'); });
  $('export-button').addEventListener('click', () => {
    const values = Object.fromEntries(core.FIELDS.filter(field => core.visible(field, state.values)).map(field => [field.key, state.values[field.key].trim()]));
    const data = { example: 'Frontend & Data Lab / research registration', version: core.VERSION, createdAt: new Date().toISOString(), values };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'research-project.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener('pagehide', saveDraft);
  restoreDraft();
  render();
})();
