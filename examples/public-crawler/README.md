# Public web crawler reading example

一个面向公开页面元数据的标准库教学示例。它读取起始 URL，检查 `robots.txt`，限制同源范围和请求频率，并将标题、同源链接及请求状态输出为 JSONL。离线测试使用模拟响应，不访问真实站点。

## 运行

在仓库根目录执行（Python 3.8+）：

```bash
python -m unittest discover -s tests -p "test_examples.py" -v
# 以下命令会访问网络，仅对你有权采集的公开站点运行：
python examples/public-crawler/polite_crawler.py https://example.com --max-pages 5 --max-requests 20 --delay 1.5 --timeout 10 --output crawl-results.jsonl
```

`example.com` 仅为命令占位示例；如果它没有可接受的 robots 文件，程序会正常记录 `robots_unavailable` 并停止。省略 `--output` 时逐行输出 JSON 到终端，不输出 JSON 数组。

运行前请确认目标站点的服务条款和 `robots.txt`。不要绕过登录、验证码、访问控制或付费墙；不要抓取个人联系方式、账号信息或其他敏感数据。

## 可复现设计

- 同源要求协议、主机和端口均相同；去除片段、规范化主机和默认端口后去重。
- **拒绝所有 HTTP 自动重定向**，包括 robots 请求。重定向目标不会被自动访问，避免跳过目标路径的权限检查。
- robots 必须返回 200、`text/plain` 和可解码的文本；包括 404、超时、HTML 错误页在内的不确定响应均停止采集。该规则有意比允许 robots 缺失时继续抓取更保守。
- 对每次实际请求（包括 robots、非 HTML、失败请求）保持至少 0.5 秒间隔；取用户设置、robots `Crawl-delay` 与 `Request-rate` 平均间隔的最大值。不重试。
- `--max-pages` 限制成功解析的 HTML 页数（1–100）；`--max-requests` 限制全部实际请求数，包含 robots 与失败请求（2–200）。最多保留 1000 个候选 URL，每页最多提取 1000 个链接。
- robots 限制为 100 KB，页面为 500 KB；超限拒绝解析。`--timeout` 为每次阻塞网络操作超时（0–60 秒，不含 0），不是整个任务的总时间上限。
- 每条 JSONL 记录都有 URL、UTC 时间、用户代理和状态；成功项包含标题和同源链接，失败项包含错误类型或 HTTP 状态。`fetched_at` 在跳过/失败记录中表示处理时间。

## 输出与边界

状态包括 `ok`、`robots_denied`、`robots_unavailable`、`redirect_blocked`、`skipped_content_type`、`http_error` 和 `request_error`。不支持 JavaScript 渲染、登录态、验证码、断点续传或完整内容归档；不保存响应正文。robots 检查不是法律授权，输出前仍需遵循目标站点的公开使用条款。此实现尚未对真实站点做联网验证。
