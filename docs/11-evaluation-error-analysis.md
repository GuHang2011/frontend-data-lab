# Evaluation and error analysis | 评估与误差分析

## 指标要和代价匹配

- 类别不均衡时，不要只报 accuracy；同时查看 precision、recall、F1 和每类支持数。
- 需要排序或筛选时，查看 PR-AUC、top-k recall 或校准曲线。
- 回归任务至少报告 MAE，并解释业务可以接受的误差范围。
- 预测概率用于人工分流时，要检查校准，而不是只比较准确率。

## 报告混淆矩阵

混淆矩阵能告诉读者错误发生在哪里。对每个重要错误保存输入摘要、真实标签、预测标签、置信度和可能原因，避免只展示一个平均分数。

## 分层评估

按时间、来源渠道、文本长度、缺失情况或其他合理切片分别评估。小样本切片要标注不确定性，不要把偶然差异写成稳定结论。

## 误差复盘循环

1. 抽取高置信度错误和低置信度正确样本。
2. 判断是标签问题、特征问题、切分问题还是模型容量问题。
3. 只针对一个原因做改动。
4. 在固定验证流程上比较；方案与阈值冻结后，才用独立测试集做最终报告，不根据测试结果反复调参。
5. 更新实验记录与已知限制。

## 继续阅读

- [scikit-learn · Model evaluation](https://scikit-learn.org/stable/modules/model_evaluation.html)
- [scikit-learn · Probability calibration](https://scikit-learn.org/stable/modules/calibration.html)
