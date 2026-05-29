---
name: memory-management
description: 记忆文件全生命周期管理 — 建/改/连/查/修，一条龙。配合 claude-mem-viz 可视化。
---

# Memory Management Skill

装了这个 skill 后，每次操作记忆文件都要遵守以下规则。

## 文件位置

记忆文件在 `~/.claude/projects/*/memory/` 目录下。每个项目目录有自己的 `memory/` 文件夹，里面是 `.md` 文件。索引文件为同目录下的 `MEMORY.md`。

**重要：** 操作时要扫描该目录下**所有** `.md` 文件，不只是当前项目。

## 工作流

```
创建/更新文件 → 自动连线 → MEMORY.md 更新 → 自检（3+文件时）→ 如有问题→修复
```

每次创建或更新记忆文件后：
1. 按下面规则连线和更新索引
2. 如果一次性改了 3 个以上文件，跑 `npm run health` 自检
3. 有问题的按「AI 修复」流程处理

## 1. 新建记忆文件

创建新的 `.md` 文件时，必须使用以下模板，放在 `~/.claude/projects/<project>/memory/` 下：

```markdown
---
name: kebab-case-id
description: "一句话描述（不超过 20 字）"
metadata:
  type: project | user | reference | feedback
---

正文...
```

- `name` 必须是英文 kebab-case，全局唯一
- `type` 四选一：`project`（项目/计划）、`user`（用户本人信息）、`reference`（参考/环境配置）、`feedback`（行为规则/偏好）
- `standalone: true`（可选）— 标记该文件天生不需要 `[[link]]` 关联（如纯路径记录、独立规则），健康检查不计入孤立节点
- 文件名必须和 `name` 一致，假设 `name: my-project` → `my-project.md`

## 2. 自动关联连线

**新建或更新文件正文后**，扫描该目录下所有 `.md` 文件的 `name` 和 `description`，如果当前文件的内容和某个已有文件相关，在文件末尾追加：

```markdown
关联: [[related-file-a]] [[related-file-b]]
```

扫描规则（具体操作）：
1. 提取当前文件正文中的所有名词/项目名/关键短语
2. 逐一比对已有文件的 `name` 和 `description`，看是否匹配或高度相关
3. 匹配上的，给当前文件末尾加 `[[已有文件ID]]`
4. 同时也反过来：如果当前文件的内容对已有文件构成了补充，给已有文件也追加 `[[当前文件ID]]`
5. 连线不要过度——确实相关才加，不是沾边就加。拿不准就不连

`关联:` 行放在文件末尾，多个 link 用空格分隔。

## 3. MEMORY.md 索引维护

每次增删改记忆文件后，同步更新同目录下的 `MEMORY.md`：

- 新增文件 → 在对应的 section 下加一行 `- [标题](file.md) — 一句话说明`
- 删除文件 → 删对应行
- 改名 → 更新对应行
- `MEMORY.md` 如果不存在 → 新建，按 section 组织

MEMORY.md 的 section 结构参考：
```markdown
- [个人文件](file.md) — 说明

### 项目记忆
- [项目文件](file.md) — 说明
```

## 4. 定期自检

以下情况触发 `npm run health`（在 claude-mem-viz 目录）：
- 一次性创建或更新了 3 个以上记忆文件后
- 不确定上次操作是否正确时
- 主动想检查整体健康状况时

`health-report` 会给出四项评分：
- **Validate** — frontmatter 格式评分。100% 意味着 name/description/type 全部合法且一致
- **Links** — 断链评分。100% = 无断链。代码段里的 `[[link]]`（反引号包裹）自动跳过
- **Orphans** — 孤立节点评分。允许 2 个或总数 10%（取大值）的天然孤儿不扣分。标记了 `standalone: true` 的文件不计入孤立节点
- **Overall** — 三项平均分

分数解读：
- 90%+ → 健康，不需人工干预
- 70-89% → 有少量问题，建议跑 AI 修复流程
- 70% 以下 → 数据质量明显有问题，必须修复

## 5. AI 修复

跑完 `npm run health` 发现的问题，按类型处理：

### Validate 问题
- **name 与文件名不匹配** — 用文件名更新 frontmatter 的 `name`，跟用户确认
- **name 缺失** — 用文件名补上
- **description 为空** — 读文件正文，用一句话概括补上（不超过 20 字）
- **type 无效** — 按内容判断最合适的 `user/project/feedback/reference` 类型

### 断链（Broken links）
- 读源文件正文，理解 `[[broken-link]]` 的上下文
- 如果看起来是笔误（如 `[[link]]` 应该是 `[[claude-mem-viz]]`），修掉
- 如果确实指向不存在的文件，且不是笔误，删掉该 `[[link]]`
- 拿不准的问用户

### 孤立节点（Orphans）
- 读孤立文件正文
- 判断：该文件是否天生不需要连接（纯路径记录、独立规则、个人偏好等）？
  - 如果是 → 给 metadata 加 `standalone: true`，跳过
  - 如果不是 → 判断它和哪些已有文件相关
- 补上 `[[相关文件]]` 到文件末尾的 `关联:` 行
- 同时也给目标文件补上 `[[孤立节点]]`

**原则：** 每次修复只做一个文件，改完读一遍确认没问题再改下一个。拿不准的停下来问用户。

## 适用场景

- 创建新的 Numerai 模型记录 → 自动连到 [[numerai-project]] 和 [[overall-plan]]
- 创建新的 CLI 工具记录 → 自动连到 [[cli-tools-platforms]] 和 [[claude-mem-viz]]
- 更新个人档案 → 自动更新索引和连线
- 跑 `npm run health` → 发现断链/孤立/格式问题 → 按 AI 修复流程处理

## 配合 claude-mem-viz

- Skill 保证数据质量
- claude-mem-viz 负责可视化展示和手动编辑
- 健康检查脚本在 `scripts/` 目录下
