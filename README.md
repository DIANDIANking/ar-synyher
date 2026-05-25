# 增强现实乐器 / 合成器 / synthesizer

本仓库仅用于部署 AR 乐器公开演示页面。

同一张乐器卡用于进入演示页和触发 AR 合成器：用户先用微信扫描卡片上的入口码进入受控入口页；验证通过后进入演示页面；进入页面后，页面内相机继续识别这张卡的三行文字和数据签名，显示 AR Mini Synth Workstation。

AR 合成器默认尺寸固定，不随屏幕大小、卡片远近或可视区域自动缩放。用户可以通过双指手动缩放，缩放后的合成器仍然跟随同一张卡片锚点。

卡片二维码不链接 GitHub 仓库。当前二维码写入的受控入口地址是：

```text
https://ar.diandianking.com/synth
```

该地址应由你控制的域名或中转页转到本演示包的 `access.html`。

本演示包已包含 `CNAME` 和 `/synth/` 入口路径：访问 `https://ar.diandianking.com/synth` 时会跳转到 `access.html?token=card-synth-v1`，再进入 AR 演示页。域名 DNS 需要设置 `CNAME ar.diandianking.com -> diandianking.github.io`。

本仓库不开放完整项目源码、工程文件、核心逻辑、原始素材、模型源文件、音频源文件或可复刻项目的开发说明。

© 2026 作者保留所有权利。未经许可，禁止复制、修改、二次分发、商用或用于其他项目。
