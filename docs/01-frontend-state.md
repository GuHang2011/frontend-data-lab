# 01 · 前端状态与表单

一个筛选面板最容易出错的地方不是按钮样式，而是多个显示区域各自保存了不一致的“结果”。本例把用户选择视为原始状态，把筛选后的记录、指标、图表和表格视为派生结果。

## 先确定状态所有权

表单保存 `region/channel/from/to`。`filterRows` 只负责选择记录，`summarize` 负责指标，`dailySeries` 负责日历补零。页面不分别维护一个“图表数据数组”和另一个“下载数据数组”；CSV 与表格共享 `currentSeries`。这样修改日期后，页面看到的数字和下载文件具有相同来源。

```js
const selected = filterRows(data.rows, state);
const metrics = summarize(selected);
const daily = dailySeries(selected, state.from, state.to);
```

纯函数不读取 DOM、不发请求，易于用小样本验证。`boot()` 则负责 DOM 事件、焦点以外的界面更新和下载等副作用。迁移到 React/Vue 时，可以继续复用纯函数，避免把所有计算塞进组件生命周期。

## 校验失败的语义

开始日期晚于结束日期时，不应静默交换日期，否则用户无法判断实际使用了哪个范围。本例展示错误提示，保留上一份有效结果，暂停下载。错误文字明确说明“当前仍展示上一次有效筛选结果”。这比保留旧图表但不说明来源更容易检查。

用户清空日期也会触发无效态。原生 `type=date` 的 `min/max` 是输入辅助，仍需 JavaScript 校验；客户端校验也不能代替未来服务端的权限和数据校验。

## 即时筛选与提交筛选

本例全部数据在内存，`change` 后立即计算足够简单。若筛选会触发远程请求，更适合“编辑态 → 点击应用 → 已应用态”，或者使用取消机制防止旧请求覆盖新请求。去抖只减少请求次数，不能保证响应顺序。

```js
let activeController;
async function load(url) {
  activeController?.abort();
  activeController = new AbortController();
  return fetch(url, {signal: activeController.signal});
}
```

这是后续服务端版本的设计说明；当前静态页面不发送请求。更复杂的场景还需请求序号检查，因为取消并不是数据库事务回滚。

## 重置与可预测性

重置统一恢复完整时间范围与全部维度，同时把表格恢复为最近十四天。重置不应只清空输入框而保留旧派生结果。`change` 不会把键盘焦点移动到图表，筛选结果通过 `role=status` 播报，用户可以继续操作表单。

进一步阅读：[MDN — Forms](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms)、[AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)。
