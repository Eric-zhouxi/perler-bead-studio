# 豆绘 Perler Studio

一个无依赖的拼豆图纸 Web App，支持图片转图纸和自由创作。

在线使用：<https://eric-zhouxi.github.io/perler-bead-studio/>

## 功能

- 使用 MARD 221 标准色号和 Lab 色差转换图片
- 图片等比例居中，画布多余区域保持空白
- 优先识别轮廓线，再识别轮廓内颜色
- 16×16、32×32、48×48 预设以及自定义规格
- 常见拼豆色板，点击颜色后直接在画布绘制
- 网格显示、缩放、撤销、清空与 PNG 导出

## 本地使用

直接用浏览器打开 `index.html` 即可，无需安装依赖。

推送到 `main` 分支后，GitHub Actions 会自动发布 GitHub Pages 网站。

## 色卡参考

色号使用 MARD 221 的 A、B、C、D、E、F、G、H、M 标准系列；屏幕 HEX 仅用于颜色匹配参考，实体拼豆会受批次、光线和显示器影响。

- <https://www.doudougongfang.com/kb/beads/mard-palette>
- <https://www.pindou.online/colors>
