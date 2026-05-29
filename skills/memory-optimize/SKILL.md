---
name: memory-optimize
description: AI 驱动的记忆优化层 — 自动补链接/写描述/标记过期/建议合并。配合 health scripts + claude-mem-viz。
---

# Memory Optimize Skill

配合 health 检查结果，对记忆文件做 AI 层面的优化。不是每次对话都要跑，按需触发。

## 触发条件

- 用户说"优化记忆""整理记忆""跑优化" → 先跑 `npm run health`，再按结果修复
- `npm run health` 跑完后显示 70-89% → 建议用户跑优化
- `npm run health` 跑完后显示 70% 以下 → 必须跑优化

## 工作流

```
health 报告 → 分析各项分数 → 逐条修复（validate → links → orphans）→ 最终 health 确认
```

每次只修一个文件，改完确认再改下一个。

## 1. Validate 修复

### missing name / name 与文件名不匹配
- 用文件名（去掉 `.md`）作为 `name: xxx`
- 确保 name 是英文 kebab-case

### description 为空
- 读文件正文前 200 字
- 用一句话概括，不超过 20 字
- 示例："刘轩个人档案 — 生平/家庭/搭档关系"、"记忆可视化工具 — 3D + 2D 关系图"

### type 无效/缺失
- 按内容判断：项目计划 → `project`、个人经历 → `user`、行为规则 → `feedback`、环境/路径记录 → `reference`
- 无法确定时问用户

## 2. Links 修复

### 断链（指向不存在的文件）
- 读源文件正文，理解 `[[broken-link]]` 的上下文
- 笔误修正：如 `[[enviroment]]` → `[[environment-reference]]`
- 指向不存在文件且不是笔误 → 删掉 `[[broken-link]]`
- 拿不准的问用户

### 建议新链接
- 扫描孤立文件和连线稀疏的文件（outgoing < 2）
- 读正文提取关键名词/项目名
- 和已有文件库的 name/description 匹配
- 找到匹配的，在文件末尾加 `关联: [[相关文件]]`
- 同时也给目标文件加反向链接
- 不硬连，确实相关才加

## 3. Orphans 修复

### 判断文件性质
- 读孤立文件正文
- 是纯路径记录/独立规则/个人偏好？→ `metadata: standalone: true`，跳过
- 是项目记录/行为规则/参考文档？→ 尝试关联已有文件

### 关联方法
- 如果内容是 project → 连到 `[[overall-plan]]` 或同类项目
- 如果内容是 feedback → 连到相关行为规则（如 `[[prefer-direct-execution]]`）
- 如果内容是 reference → 看是否提到其他项目

## 4. 标记过期

### 检查标准
- 文件内是否有"最后更新：YYYY-MM-DD"或类似标记
- 日期超过 30 天且内容明显是临时性的 → 建议用户更新或归档
- 日期超过 90 天 → 标记 `stale: true` 到 metadata
- 没有日期标记 → 不判断，跳过

### stale 标记的效果
- health 脚本会降低评分（待实现）
- claude-mem-viz 会显示为灰色（待实现）

## 5. 建议合并

如果发现两个文件内容高度重叠（如相似的 description、相似的正文关键词），输出合并建议：

```
建议合并: [[file-a]] + [[file-b]]
理由: 两者都记录了 XXXX
方案: 保留内容更丰富的那个，删掉另一个并在 MEMORY.md 中移除条目
```

不自动执行合并，只输出建议让用户决定。

## 配合工具

- `npm run health` — 先跑健康检查，看问题清单
- `scripts/validate.js` / `check-links.js` / `find-orphans.js` — 单项检查
- claude-mem-viz 前端健康面板 — 图形化查看问题
