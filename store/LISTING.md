# Edge 加载项商店提交资料（Partner Center 填写参考）

## 程序包
- 上传文件：release/aggregate-search-panel-1.0.5.zip（npm run build 后由 dist 打包）

## 可用性
- 可见性：公开（Public）
- 市场：所有市场（或仅中国）

## 属性
- 类别：生产力工具（Productivity）
- 隐私政策：需要（扩展使用 cookies / 主机权限）。URL：https://github.com/GlibWild/aggregate-search-panel/blob/main/store/PRIVACY.md
- 网站：https://github.com/GlibWild/aggregate-search-panel
- 支持联系方式：https://github.com/GlibWild/aggregate-search-panel/issues
- 成人内容：否

## 商店列表（中文 zh-CN）
- 名称：聚合搜索 · 多站点扫码登录面板
- 简短描述（≤ 250 字）：在一个侧边栏面板中管理多个需要扫码登录的站点，跨站聚合搜索、结果按站点分组、一键跳转原页面，并自动检测登录过期。
- 详细描述：
  聚合搜索面板帮你把常用站点集中到浏览器侧边栏：
  · 跨站搜索：输入一次关键词，同时检索所有已选站点，结果按站点分组展示
  · 站点分组：自定义分组，搜索时一键选中整组
  · 扫码登录：在面板内显示站点登录二维码，手机扫码即可登录；也支持不登录直接搜索
  · 过期提醒：定期检测登录状态，过期时发送通知
  · 结果过滤：自动过滤站外广告链接，支持一键屏蔽指定域名
  · 隐私：所有配置与登录元数据仅保存在本地，不上传任何 Cookie 或数据
  本项目以 MIT 协议开源。
- 搜索词（最多 7 个）：聚合搜索, 多站点搜索, 扫码登录, 侧边栏, 搜索工具, 登录提醒, 效率
- 商店徽标：300×300 PNG（public/icons/icon128.png 放大或另行设计）
- 屏幕截图：1280×800 或 640×400，至少 1 张（搜索页、站点页、设置页）
- 小型宣传图块（可选）：440×280

## 权限说明（提交时“给认证团队的备注”可直接粘贴）
- storage：保存站点配置、设置与搜索历史
- sidePanel：提供侧边栏主界面
- tabs / scripting：在后台标签页中打开站点搜索页并提取结果、识别登录二维码
- cookies：检测站点登录状态与过期时间（不上传）
- alarms / notifications：定时检测登录状态并在过期时提醒
- offscreen：在离屏文档中解析页面 HTML
- optional_host_permissions：仅在用户添加站点并点击“授权访问”时按站点申请
测试方法：安装后点击工具栏图标打开侧边栏 → 站点页“添加站点”选择内置模板（如 B 站）→ 搜索页输入关键词即可看到结果，无需账号。
