# 小账本 PWA

一个无需账号、数据默认只保存在当前浏览器中的个人记账应用。项目是纯 HTML、CSS 和 JavaScript，可直接部署到 GitHub Pages，不需要服务器或构建工具。

## 已包含的功能

- 新增、查看、编辑和删除收入/支出；每一笔都可填写“钱花在哪里”或收入说明
- 查看选定日期的支出分类扇形图、月度每日支出折线图，以及带消费备注的月度大类明细
- 设置月度总预算和分类预算，显示使用进度与超支提醒
- 使用 IndexedDB 在本机持久化数据
- Service Worker 缓存应用外壳，首次在线打开后可离线使用
- 导出完整 JSON 备份和 Excel/Numbers 可读的 CSV
- JSON 备份可选择合并导入或覆盖导入
- 适配 iPhone 安全区域和“添加到主屏幕”模式

## 重要的数据说明

账单不会由本项目主动上传到任何服务器。数据保存在打开网站的那个浏览器中；Safari 普通模式和无痕模式、不同浏览器、不同域名之间的数据互不相通。

清理浏览器网站数据、删除应用数据、更换设备或系统异常都可能造成数据丢失。请定期在“更多 → 导出备份”中保存 JSON 文件。

## 部署到 GitHub Pages

1. 解压下载的 `personal-ledger-pwa.zip`，确保你看到的是 `index.html`、`app.js`、`styles.css` 等文件，而不是只有一个 ZIP。
2. 登录 [GitHub](https://github.com/)，点击右上角 `+` → `New repository`。
3. 仓库名填写 `personal-ledger-pwa`，选择 `Public`，点击 `Create repository`。
4. 在空仓库页面点击 `uploading an existing file`，把解压后文件夹中的**全部文件和 icons 文件夹**拖入页面，提交到 `main` 分支。
5. 打开仓库的 `Settings` → `Pages`。
6. 在 `Build and deployment` 下选择 `Deploy from a branch`；分支选择 `main`，目录选择 `/(root)`，点击 `Save`。
7. 等待几分钟。页面顶部会显示网址，通常是：

   `https://你的GitHub用户名.github.io/personal-ledger-pwa/`

部署必须使用 HTTPS。直接双击本机的 `index.html` 可以看界面，但 Service Worker 和完整离线能力通常不会生效。

## 添加到 iPhone 主屏幕

1. 用 **Safari** 打开部署后的 HTTPS 网址，并等待页面完整加载。
2. 点击 Safari 底部的“分享”图标。
3. 向下滚动并选择“添加到主屏幕”。
4. 点击右上角“添加”。以后可从桌面图标直接打开。

首次安装后建议联网打开一次，再切换飞行模式验证离线启动。

## 本机测试（可选）

如果电脑已安装 Python，可在项目目录运行：

```powershell
python -m http.server 8080
```

然后访问 `http://localhost:8080/`。`localhost` 可用于开发测试，但 iPhone 安装仍需要部署后的 HTTPS 地址。

## 更新注意事项

修改应用文件后，把 `sw.js` 顶部的 `CACHE_NAME` 改成新版本（例如 `little-ledger-v1.1.1`），再上传 GitHub。否则已安装设备可能继续使用旧缓存。

## 文件结构

```text
personal-ledger-pwa/
├─ index.html                 页面结构
├─ app.js                     账单、统计、预算与备份逻辑
├─ styles.css                 移动端样式
├─ sw.js                      离线缓存
├─ manifest.webmanifest       PWA 安装配置
├─ .nojekyll                  GitHub Pages 静态部署标记
└─ icons/
   ├─ icon.svg
   ├─ icon-192.png
   ├─ icon-512.png
   ├─ icon-maskable-512.png
   └─ apple-touch-icon.png
```

## 浏览器兼容性

建议使用最新版本的 Safari、Chrome 或 Edge。应用依赖 IndexedDB、Service Worker、`<dialog>` 和 CSS `conic-gradient`。较旧浏览器可能无法获得完整体验。
