# Applied examples

这些示例用于展示可复用的工程思路，输入数据均为合成或公开页面元数据。

| Example | Focus | Entry |
| --- | --- | --- |
| Data labeling quality | 标签定义、双人一致性、冲突复核、数据追溯 | [`data-labeling/`](./data-labeling/) |
| Public web crawler | robots.txt、限速、同域名、去重、超时和审计字段 | [`public-crawler/`](./public-crawler/) |

## Reading order

先看对应目录的 README，再看最小脚本和样例输入。示例强调边界条件与审计信息，不代表针对真实机构数据的生产系统。

## Publication boundary

不要把真实学生记录、个人联系方式、账号凭据、内部 URL、数据库导出、日志或未授权网页内容放进这些示例。发布前请检查依赖、配置和 Git 历史。
