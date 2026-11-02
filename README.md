# 论文工作台 · Obsidian 面板

> An Obsidian (Dataview) dashboard for a local research-paper workbench: daily paper recommendations (arXiv + Hugging Face Daily Papers) with briefs, paper library, your marks and reading queue, interest keyword tree, classics and must-reads, field history and per-stream hotspot trends. All data comes from the backend at [Obsidian-ResearchWorkbench-Backend](https://github.com/Roderick-Stinson/Obsidian-ResearchWorkbench-Backend). Docs are in Chinese.

面板只负责展示，数据都来自本机的后端服务（[Obsidian-ResearchWorkbench-Backend](https://github.com/Roderick-Stinson/Obsidian-ResearchWorkbench-Backend)）。论文和 PDF 都存在后端；vault 里只保存阅读笔记、实验记录和面板配置。

## 安装

第一次用的话，先看后端 README 里的[从零开始](https://github.com/Roderick-Stinson/Obsidian-ResearchWorkbench-Backend#从零开始)：要写哪个配置文件、先做什么后做什么都在那里。下面只是面板本身的安装。

1. 把 `论文工作台/` 文件夹整个放到 vault 根目录，保持 `论文面板.md` 与 `面板组件/` 同级。
2. 安装并启用 [Dataview](https://github.com/blacksmithgu/obsidian-dataview) 插件，在它的设置里打开 JavaScript 查询。其他插件都是可选的，见下面的[插件](#插件)。
3. 按后端仓库的 README 安装并启动后端：
   ```bash
   cd ~/PaperWorkbench && .venv/bin/python -m pwb serve
   ```
4. 打开 `论文面板.md`，切到阅读视图。右上角显示“后端已连接”就可以用了。`我的研究领域.md` 是关键词树的编辑页：先在这里“添加一级领域”，再到“关注论文”页贴几篇代表论文的 arXiv 链接。
5. 后端地址默认是 `http://127.0.0.1:8765/api/v1`。要改地址或设置 token，在面板“设置 → 后端连接”里改，会保存到 `面板组件/config.json`（这个文件不要提交，里面可能有 token）。

后端没启动时，面板显示上次成功同步的数据（缓存在 Obsidian 本地，不写进 vault），并提示“后端未连接”。改了 `view.js` 或 `view.css` 之后，用命令面板运行 `Dataview: Rebuild current view`。

## 插件

**必装**

- [Dataview](https://github.com/blacksmithgu/obsidian-dataview)：面板本身就是一段 Dataview JS，设置里要打开 JavaScript 查询。

**在阅读笔记里贴论文的图（可选，推荐）**

三个第三方插件配合着用：每篇笔记的图放在它自己的文件夹里，粘贴时起名，没人引用的图定期清掉。

- [Custom Attachment Location](https://github.com/mnaoumov/obsidian-custom-attachment-location)：决定图放在哪。下面的设置名以 17.x 版为准。
  - 关掉「Follow Obsidian attachment location」，否则图还是落在 vault 根目录。
  - 「Location for new attachments」填 `./assets/{{noteFileName}}`，图就放在笔记旁边的 `assets/<笔记名>/` 里；笔记改名或移动时文件夹跟着走。
  - 「生成的附件文件名」填 `Pasted image {{date:{momentJsFormat:'YYYYMMDDHHmmss'}}}`（`image` 后面有个空格）。
  - 「Move/renames → 附件重命名模式」选「仅粘贴的图片」。
- [Paste Image Rename](https://github.com/reorx/obsidian-paste-image-rename)：粘贴时弹框起名，比如 `Fig3-框架图`，和原文的图号对上。
  - 「Image name pattern」填 `Fig`（默认的 `{{fileName}}` 是笔记名，也就是论文标题，太长）。
  - 「Auto rename」「Handle all attachments」都关着。
  - 它只认 `Pasted image ` 开头的文件，所以上面要让 Custom Attachment Location 把粘贴的图先起成这个名字。很多截图工具（比如 macOS 上把截图存成文件再复制的那类）往剪贴板里放的是一个文件，名字是一串 UUID，不这样设就不弹框。
- [Clear Unused Images](https://github.com/ozntel/oz-clear-unused-images-obsidian)：找出已经没有笔记引用的图。删除方式选移到回收站，不要选永久删除。

另外在 Obsidian 的「设置 → 文件与链接」里打开「始终更新内部链接」，移动、改名时链接才不会断。

贴图的写法：图下面另起一行写出处和你从图里看出了什么，例如 `*Fig. 3（原文）：先生成拓扑，再逐节点分配角色*`。图本身不同步给后端，这行说明会。

**Obsidian 自带的「模板」插件（可选）**：只在不经过面板、直接在 Obsidian 里新建阅读笔记时用，见[阅读笔记](#阅读笔记)。

## 每日推荐

- “论文推荐”页按天显示核心 / 邻近 / 热点三类，“立刻刷新今天的推荐”马上跑一次；首页是当天的简报、精选和新中稿。
- “设置 → 每日推荐”里改运行时间、来源开关（每个 arXiv 论文流、Hugging Face）、阈值、速读范围、精选篇数和打分权重；检索词等研究方向的文字在后端的 `data/profile.json`。
- 推荐卡片上标“相关”的论文才进论文库；标“不相关”的会成为以后初筛的反例。

## 团队

- “团队”页按作者机构聚合论文库：越和你方向相关的论文权重越高，排在前面的就是和你做同样内容的机构；每个机构里按当通讯作者 / 末位作者的次数列出人，点“关注”后他们的新论文会进每日推荐。
- 论文卡片上显示主要机构（通讯作者的在前），点“作者与机构”看每位作者的机构和院系，✉ 是通讯作者，也可以在这里关注某位作者。
- 机构信息由后端从 OpenAlex 和 PDF 第一页整理，每天补一些；想一次补完点“团队”页的“整理作者机构”。

## 阅读笔记

- 论文卡片上点“建阅读笔记”，按 `论文工作台/模板/精读笔记.md` 生成笔记：替换 `{{title}}`、`{{date}}`、`{{time}}`（写法和 Obsidian 自带的“模板”插件一样），填好“链接”“作者”两行，并在 frontmatter 写入 `paper_id`、`venue`（还没发表的写“预印本”）和 `year`。
- 模板随意改；路径在“设置 → 阅读笔记”里改。模板里删掉 `paper_id`、`tags` 或“链接”那两行也没关系：前两个面板会补上，后两行没有就不填。
- 笔记会同步给后端，推荐时参考（后端不读 vault，由面板按小节发过去）：精读 / 已读过的、面板上打了 4 星以上的论文当邻近推荐的种子，“要追的论文”里的链接加进阅读队列，“和我的研究的关系”“想法与疑问”整理成阅读要点（在“我的研究领域”里看）。`我的论文/` 下的、frontmatter 写了 `sync: false` 的不发；贴进笔记的图片也不发，图下面写的说明照发。改了这三节的标题，到“设置 → 每日推荐 → 阅读笔记”里改成一样的。
- `paper_id` 可以填 arXiv / OpenReview 链接，同步后换成论文 ID。
- 笔记的 `status` 只有 待读 / 粗读 / 精读 / 已读 四个，在论文卡片的「阅读状态」下拉框里选，写回笔记的 frontmatter。评分只在面板上打星，笔记里不写 `rating`。
- 论文库按「读没读过」筛选：笔记是精读 / 已读的算已读，笔记是粗读或打过星的算粗读，其余算未读。读过的（粗读及以上或打过星）会自动移出阅读队列；论文库里勾「只看阅读队列」看还没读的。
- 想在 Obsidian 里直接新建笔记，把“设置 → 模板 → 模板文件夹位置”设成 `论文工作台/模板`，再用“模板：插入模板”，`paper_id` 手动填。

## 面板会读写 vault 里的哪些地方

- `论文阅读/论文笔记整理/`（以及带 `#paper` 标签的笔记）：阅读笔记，frontmatter 里的 `paper_id` 关联到后端的论文。在面板上点“建阅读笔记”“存为阅读笔记”时新建；面板读出内容同步给后端，并会改写 `paper_id`（换成论文 ID）；
- `实验记录/`：在面板上“新建实验记录”时新建；
- `论文工作台/模板/`：只读，“建阅读笔记”用的模板；
- `论文工作台/面板组件/config.json`：后端地址、token 和模板路径。

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
