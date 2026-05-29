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
