# web-pages

> 提一个 issue，自动部署一个网页到 GitHub Pages。不用为每个小 HTML 单独开仓库。

[![Deploy pages](https://github.com/Kibiandkimi/web-pages/actions/workflows/deploy.yml/badge.svg)](https://github.com/Kibiandkimi/web-pages/actions/workflows/deploy.yml)
[![站点](https://img.shields.io/badge/Pages-kibiandkimi.github.io%2Fweb--pages-2ea043)](https://kibiandkimi.github.io/web-pages/)

**站点首页（自动生成的画廊）**：<https://kibiandkimi.github.io/web-pages/>

---

## 它是怎么工作的

```
你提 issue  ──▶  Actions 解析正文  ──▶  写入 sites/<标识>/ + .meta/<标识>.json
                                          │
                                          ├─▶ 提交回 main（内容有版本历史）
                                          ├─▶ 生成首页画廊 + 404 页 → _site/
                                          └─▶ 部署到 GitHub Pages → 回评 issue 给出链接
```

每个页面就是一个 `sites/<标识>/` 目录，里面放 `index.html` 和它的静态资源，
最终地址是 `https://kibiandkimi.github.io/web-pages/<标识>/`。

---

## 快速开始

1. 打开 [新建 issue](https://github.com/Kibiandkimi/web-pages/issues/new?template=deploy.yml)
2. 填「页面标题」
3. 三选一填内容（见下）
4. 提交 → 等 30 秒左右 → issue 里会自动回复部署好的链接

### 方式 A：内联 HTML（单个文件最简单）

在「HTML 代码」框里贴完整 HTML，建议用围栏包起来：

````markdown
```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Hello</title>
</head>
<body>
  <h1>Hello, Pages!</h1>
</body>
</html>
```
````

适合：单文件小工具、演示页、数据可视化、内嵌了 CSS/JS 的页面。

### 方式 B：压缩包（多文件站点）

把整个站点打包成 `.zip`，**直接拖进「压缩包链接」框**（GitHub 会自动上传并插入链接），
或者粘贴任意可公开下载的 zip 链接。

要求：

- 根目录（或唯一的一层子目录）里要有 `index.html`
- 如果整个包外面套了一层文件夹，会自动剥掉
- 支持图片、css、js 等任意静态资源；用相对路径引用即可
- 上限：解压后 80 MiB / 2000 个文件

### 方式 C：远程网址

给一个能**直接下载到 HTML 源码**的链接（不是网页预览页），例如：

```
https://raw.githubusercontent.com/某个仓库/main/index.html
```

如果这个链接实际上是个 zip，也会自动按压缩包处理。

> ⚠️ GitHub Pages 上的内容是**公开**的。不要放密码、密钥、个人隐私数据。

---

## 链接规则

| 页面标识（slug） | 最终地址 |
| --- | --- |
| `my-demo` | `https://kibiandkimi.github.io/web-pages/my-demo/` |
| 留空，标题是 `My Demo` | `https://kibiandkimi.github.io/web-pages/my-demo/` |
| 留空，标题是纯中文 | `https://kibiandkimi.github.io/web-pages/p42/`（用 issue 号兜底） |

标识只能用小写字母、数字、`-`、`_`、`.`，最长 64 字符。
**想换链接**：评论 `/rename 新的标识`，或者直接改 issue 正文里的「页面标识」再 `/redeploy`。

---

## 更新 / 删除 / 下线

### 改内容

直接**编辑 issue 正文**，保存即可自动重新部署。
如果只是想强制重跑，评论 `/redeploy`。

### 命令一览

在 issue 里发一条只含命令的评论：

| 命令 | 作用 |
| --- | --- |
| `/redeploy` | 按当前 issue 正文重新部署 |
| `/delete` | 删除页面，源码一起删掉（**不可撤销**） |
| `/offline` | 下线：链接返回 404，但源码保留在仓库里 |
| `/online` | 恢复上线 |
| `/rename <新标识>` | 改链接，例如 `/rename my-new-name` |
| `/help` | 显示帮助 |

只有 **issue 作者** 或 **仓库协作者** 能执行命令。

### 用标签代替命令

| 标签 | 等价操作 |
| --- | --- |
| `deploy` | `/redeploy` |
| `delete` | `/delete` |
| `offline` | `/offline` |
| `online` | `/online` |

> 关掉 issue **不会**删除页面。要删请用 `/delete` 或 `delete` 标签。

---

## 仓库结构

```
web-pages/
├── .github/
│   ├── workflows/deploy.yml     # 唯一的工作流：issue → 构建 → 部署
│   └── ISSUE_TEMPLATE/deploy.yml # 提 issue 的表单
├── scripts/
│   ├── sitekit.py               # 解析 issue、slug、下载、安全解压、元数据
│   ├── handle_event.py          # 事件分发（issue / 评论 / 标签 / push）
│   ├── build_site.py            # 生成 _site/（画廊 + 各页面 + 404）
│   ├── commit_push.sh           # 带 rebase 重试的提交
│   └── templates/               # 画廊与 404 页模板
├── sites/<标识>/                # 每个页面的源码（自动生成，可以手动改）
├── .meta/<标识>.json            # 每个页面的元数据（标题/说明/标签/状态）
├── site.json                    # 站点标题、描述等配置
└── tests/test_all.py            # 本地测试
```

### 想手动加页面？

直接建一个 `sites/随便什么名字/index.html` 并 push 到 main，
即使没有 `.meta` 也会被发布（标题用目录名）。想让它出现在画廊里，
再补一个 `.meta/<名字>.json`：

```json
{
  "slug": "随便什么名字",
  "title": "显示用的标题",
  "description": "一句话说明",
  "tags": ["标签"],
  "status": "active",
  "issue": null,
  "updated_at": "2026-11-05T10:00:00Z"
}
```

---

## 本地预览

```bash
python3 scripts/build_site.py --serve
# → http://127.0.0.1:8000/
```

跑测试：

```bash
python3 -m unittest discover -s tests -v
```

只需要 Python 3.10+ 标准库，没有第三方依赖。

---

## 常见问题

**Q：为什么必须用 public 仓库？**
A：私有仓库的 GitHub Pages 需要付费计划；公开仓库免费。而且 Pages 上的内容本来就公开。

**Q：部署要多久生效？**
A：Actions 本身 30–60 秒；Pages 的 CDN 可能再缓存几秒到一分钟。看不到更新可以硬刷新。

**Q：页面可以是私密的吗？**
A：不行。Pages 是纯静态公开托管。想要口令保护只能在页面里自己做，但那只是防君子不防小人。

**Q：能放多大的东西？**
A：单站解压后 80 MiB、2000 个文件以内；GitHub Pages 站点整体建议 < 1 GB。
不适合放大视频/大图片，那些建议放对象存储。

**Q：能用自己的域名吗？**
A：可以，在仓库 Settings → Pages → Custom domain 里配置，然后加一个 `CNAME` 文件到 `sites/` 之外由工作流带过去——目前没做这个自动化。

**Q：Actions 会跑多少？**
A：公开仓库的 Actions 免费额度不限。一次部署大约 30–60 秒。

**Q：能改站点标题吗？**
A：改 `site.json` 里的 `title` / `description`，push 到 main 即可。

---

## 实现要点

- **幂等**：所有操作都基于「当前仓库状态 + issue 内容」重新计算，重复跑不会出问题。
- **原子写入**：新内容先写进临时目录，下载/解包成功后才整体替换，失败不会破坏已有站点。
- **安全**：zip 解包拒绝 `..` 路径穿越、绝对路径、符号链接；远程下载限制协议、内网地址、大小。
- **并发**：workflow 用 `concurrency` 串行化；提交带 `git pull --rebase` 重试。
- **可恢复**：`/offline` 只改元数据，源码还在；`/delete` 才有 git 历史可以翻回来。
