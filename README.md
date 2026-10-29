# 论文工作台 · Obsidian 面板

> An Obsidian (Dataview) dashboard for a local research-paper workbench: daily paper recommendations (arXiv + Hugging Face Daily Papers) with briefs, paper library, your marks and reading queue, interest keyword tree, classics and must-reads, field history and per-stream hotspot trends. All data comes from the backend at [Obsidian-ResearchWorkbench-Backend](https://github.com/Roderick-Stinson/Obsidian-ResearchWorkbench-Backend). Docs are in Chinese.

面板只负责展示，数据都来自本机的后端服务（[Obsidian-ResearchWorkbench-Backend](https://github.com/Roderick-Stinson/Obsidian-ResearchWorkbench-Backend)）。论文和 PDF 都存在后端；vault 里只保存阅读笔记、实验记录和面板配置。

## 安装

第一次用的话，先看后端 README 里的[从零开始](https://github.com/Roderick-Stinson/Obsidian-ResearchWorkbench-Backend#从零开始)：要写哪个配置文件、先做什么后做什么都在那里。下面只是面板本身的安装。

1. 把 `论文工作台/` 文件夹整个放到 vault 根目录，保持 `论文面板.md` 与 `面板组件/` 同级。
2. 安装并启用 [Dataview](https://github.com/blacksmithgu/obsidian-dataview) 插件，在它的设置里打开 JavaScript 查询。
3. 按后端仓库的 README 安装并启动后端：
   ```bash
   cd ~/PaperWorkbench && .venv/bin/python -m pwb serve
   ```
4. 打开 `论文面板.md`，切到阅读视图。右上角显示“后端已连接”就可以用了。`我的研究领域.md` 是关键词树的编辑页：先在这里“添加一级领域”，再到“关注论文”页贴几篇代表论文的 arXiv 链接。
5. 后端地址默认是 `http://127.0.0.1:8765/api/v1`。要改地址或设置 token，在面板“设置 → 后端连接”里改，会保存到 `面板组件/config.json`（这个文件不要提交，里面可能有 token）。

后端没启动时，面板显示上次成功同步的数据（缓存在 Obsidian 本地，不写进 vault），并提示“后端未连接”。改了 `view.js` 或 `view.css` 之后，用命令面板运行 `Dataview: Rebuild current view`。

## 每日推荐

- “论文推荐”页按天显示核心 / 邻近 / 热点三类，“立刻刷新今天的推荐”马上跑一次；首页是当天的简报、精选和新中稿。
- “设置 → 每日推荐”里改运行时间、来源开关（每个 arXiv 论文流、Hugging Face）、阈值、速读范围、精选篇数和打分权重；检索词等研究方向的文字在后端的 `data/profile.json`。
- 推荐卡片上标“相关”的论文才进论文库；标“不相关”的会成为以后初筛的反例。

## 面板会读写 vault 里的哪些地方

- `论文阅读/论文笔记整理/`：阅读笔记（frontmatter 里的 `paper_id` 关联到后端的论文），在面板上点“建阅读笔记”“存为阅读笔记”时新建；
- `实验记录/`：在面板上“新建实验记录”时新建；
- `论文工作台/面板组件/config.json`：后端地址和 token。

除此之外不读写 vault；论文条目和 PDF 都不在 vault 里。

## 接口约定

前后端之间的接口约定在 `论文工作台/后端约定/`：`数据格式约定.md` 是说明，`schemas/` 是每个返回体的 JSON Schema，`examples/` 是示例。后端仓库的 `contract/` 是这里的副本（`python -m pwb sync-contract <vault>/论文工作台/后端约定` 同步过去）。

## 开发

面板代码在 vault 里直接改、在 Obsidian 里看效果；改完用脚本同步进这个仓库再提交：

```bash
./sync_from_vault.sh <你的 vault 路径>
```

## 许可证

[MIT](LICENSE)
