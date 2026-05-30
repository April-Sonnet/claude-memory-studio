# Bug Fix Log

## 2026-05-30

### 3D 视图暗色球不可见
- **问题：** 零连接或低连接节点在 3D 视图中几乎看不见
- **原因：** 发光强度最低值设得太低（emissiveIntensity 最低 0.04，glow opacity 最低 0.08）
- **修复：** emissiveIntensity 最低提到 0.15，glow opacity 最低提到 0.20
- **文件：** `public/app.js` line 541, 552

### 2D/3D 视图缺少类型过滤栏
- **问题：** 切换到 2D/3D/Chart/Health 视图时，类型过滤按钮（All/User/Feedback/Project/Reference）消失
- **原因：** 过滤栏只在卡片视图激活时显示，deactivateViews() 将其隐藏且其他视图未重新显示
- **修复：** 在 2D/3D/Chart/Health 视图激活时添加 `cardToolbar.style.display = 'flex'`
- **文件：** `public/app.js` line 1002, 1016, 1030, 1044

### 页面完全空白
- **问题：** 浏览器访问显示白屏，无法加载可视化界面
- **原因：** `public/app.js` 文件开头多了 `<script type="module">`、结尾多了 `</script>` HTML 标签，浏览器解析为 JS 时报语法错误，模块加载失败导致页面空白
- **修复：** 移除文件首行的 `<script type="module">` 和末行的 `</script>`
- **文件：** `public/app.js`

### 2D 视图缺少线颜色说明
- **问题：** README 文档没有说明 2D 视图中红蓝橙线的含义
- **原因：** 文档遗漏
- **修复：** 在 README 中新增 2D 视图线颜色说明章节
- **文件：** `README.md`

### 多 server 实例冲突
- **问题：** 多次重启导致多个 memory 服务实例同时运行，端口被占用，新实例自动递增端口，造成混淆
- **原因：** `pkill -f "node.*server.js"` 误杀当前 shell，旧实例未清理干净
- **修复：** 按 PID 精确杀死旧进程后再启动

### 同名节点重叠（user-profile 两个球叠在一起）
- **问题：** 2D/3D 视图中两个 `user-profile` 节点完全重叠，视觉上只看到一个
- **原因：** 服务器 `scanMemories()` 用 `name` 字段做节点 ID，两个不同项目的文件 `name: user-profile` 撞 ID → 布局用 `pos[n.id]` 第二次覆盖第一次 → 两个 DOM 元素渲染在同一个坐标
- **修复：** 服务器检测到重复 name 时自动追加 `@项目名` 后缀（`user-profile@test-project`），保持节点唯一性；同步更新 `findNodeFile()` 支持后缀格式的文件查找
- **文件：** `server.js` line 133-135（去重），line 237-258（findNodeFile）

### 2D 线条箭头被节点遮挡
- **问题：** 箭头渲染在节点中心，被节点元素（z-index 更高）盖住，完全看不到方向
- **原因：** 线条终点设在节点圆心，SVG z-index: 2 低于节点 z-index: 5
- **修复：** 计算节点间方向向量，线条终点缩进 1.2%，箭头从节点边缘伸出
- **文件：** `public/app.js` line 685, 1088（两处 edge 渲染）

### 2D 双向连接箭头方向随机
- **问题：** A→B 和 B→A 合并成一条线后，箭头方向由字母排序决定而非实际连接方向，双向连接只能看到一个方向的箭头
- **原因：** `[e.from, e.to].sort().join('|')` 去重丢失方向信息
- **修复：** 检测反向连接是否存在；双向连接添加 `marker-start` 反向箭头（两端箭头），悬停 trace 时出链入链正确使用 `marker-end`/`marker-start`，方向不互相覆盖
- **文件：** `public/app.js`（4 处修改: 初始渲染 + rebuild2DEdges + clear2DTrace + show2DTrace），`index.html`（新增 arrow-reverse/arrow-trace-reverse/arrow-trace-in-reverse 三个 SVG marker）
