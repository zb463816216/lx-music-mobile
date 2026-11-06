// 修补依赖源码以使构建的依赖恢复正常工作

const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.join(__dirname, './')

// ===== 诊断开关 =====
// true  = 诊断模式：把所有元数据字段写成各自的「字段名标记」，用于确定车机投屏卡片
//         第二行到底读的是哪个字段。构建后到车上播放任意歌曲，看卡片第二行显示什么字符串，
//         回报给我即可（例如显示 "M_ALBUM" 说明读 METADATA_KEY_ALBUM；"N_SubText" 说明镜像通知栏 SubText）。
// false = 正常模式：走 uCar/CarLife 语义正确方案（歌手位 = artist，绝不污染专辑位）。
const DIAGNOSTIC = true

const patchs = [
  // ───────────────────────────────────────────────────────────────
  // 0) 注入：所有元数据字段的规范变量名（Android 标准 + uCar 私有 + 通知栏）
  //    + 诊断喷射方法 sprayMetadata()。集中定义便于核对 / 后续单独适配车型。
  //    来源：Android MediaMetadataCompat 标准字段 + ICCOA/uCar 私有字段（PDF 1.0.16 第 870–969 行）
  // ───────────────────────────────────────────────────────────────
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '    private Bitmap prevArtResource = null;\n',
    `    private Bitmap prevArtResource = null;

    // ───────────────────────────────────────────────────────────────
    // 元数据字段规范变量名（集中定义：Android 标准 + ICCOA/uCar 私有 + 通知栏 MediaStyle）
    // 车机读取规则见 ICCOA/uCar 标准（PDF 1.0.16）：标准字段走 MediaMetadataCompat，
    // uCar 私有字段前缀 ucar.media.metadata.，车机优先于同名标准字段。
    // ───────────────────────────────────────────────────────────────
    // —— Android 标准 MediaMetadataCompat 字段（前缀 android.media.metadata.）——
    private static final String K_TITLE                = "android.media.metadata.TITLE";
    private static final String K_ARTIST               = "android.media.metadata.ARTIST";
    private static final String K_ALBUM                = "android.media.metadata.ALBUM";
    private static final String K_ALBUM_ARTIST         = "android.media.metadata.ALBUM_ARTIST";
    private static final String K_AUTHOR               = "android.media.metadata.AUTHOR";
    private static final String K_WRITER               = "android.media.metadata.WRITER";
    private static final String K_COMPOSER             = "android.media.metadata.COMPOSER";
    private static final String K_GENRE                = "android.media.metadata.GENRE";
    private static final String K_DATE                 = "android.media.metadata.DATE";
    private static final String K_YEAR                 = "android.media.metadata.YEAR";
    private static final String K_DISPLAY_TITLE        = "android.media.metadata.DISPLAY_TITLE";
    private static final String K_DISPLAY_SUBTITLE     = "android.media.metadata.DISPLAY_SUBTITLE";
    private static final String K_DISPLAY_DESCRIPTION  = "android.media.metadata.DISPLAY_DESCRIPTION";
    private static final String K_DISPLAY_ICON_URI     = "android.media.metadata.DISPLAY_ICON_URI";
    private static final String K_DISPLAY_ICON         = "android.media.metadata.DISPLAY_ICON";
    private static final String K_MEDIA_ID             = "android.media.metadata.MEDIA_ID";
    private static final String K_MEDIA_URI            = "android.media.metadata.MEDIA_URI";
    private static final String K_DURATION             = "android.media.metadata.DURATION";
    private static final String K_TRACK_NUMBER         = "android.media.metadata.TRACK_NUMBER";
    private static final String K_NUM_TRACKS           = "android.media.metadata.NUM_TRACKS";
    private static final String K_DISC_NUMBER          = "android.media.metadata.DISC_NUMBER";
    private static final String K_BT_FOLDER_TYPE       = "android.media.metadata.BT_FOLDER_TYPE";
    private static final String K_ART_URI              = "android.media.metadata.ART_URI";
    private static final String K_ALBUM_ART_URI        = "android.media.metadata.ALBUM_ART_URI";
    private static final String K_ART                  = "android.media.metadata.ART";
    private static final String K_ALBUM_ART            = "android.media.metadata.ALBUM_ART";
    // —— ICCOA/uCar 私有字段（前缀 ucar.media.metadata.，车机优先于同名标准字段）——
    private static final String U_TITLE                = "ucar.media.metadata.UCAR_TITLE";
    private static final String U_ARTIST               = "ucar.media.metadata.UCAR_ARTIST";
    private static final String U_ALBUM                = "ucar.media.metadata.UCAR_ALBUM";
    // —— 通知栏 MediaStyle 字段（车机卡片可能直接镜像手机通知栏，第 273–275 行设置）——
    // 诊断标记值统一用字段名本身，便于在车机卡片上肉眼识别。
    private void sprayMetadata(MediaMetadataCompat.Builder m) {
        m.putString(K_TITLE,               "M_TITLE");
        m.putString(K_ARTIST,              "M_ARTIST");
        m.putString(K_ALBUM,               "M_ALBUM");
        m.putString(K_ALBUM_ARTIST,        "M_ALBUM_ARTIST");
        m.putString(K_AUTHOR,              "M_AUTHOR");
        m.putString(K_WRITER,              "M_WRITER");
        m.putString(K_COMPOSER,            "M_COMPOSER");
        m.putString(K_GENRE,              "M_GENRE");
        m.putString(K_DATE,               "M_DATE");
        // 注意：METADATA_KEY_YEAR / DURATION / TRACK_NUMBER / NUM_TRACKS / DISC_NUMBER / BT_FOLDER_TYPE
        // 为 Long 数字类型，禁止 putString，故不纳入字符串喷射（避免 IllegalArgumentException 崩溃）。
        m.putString(K_DISPLAY_TITLE,       "M_DISPLAY_TITLE");
        m.putString(K_DISPLAY_SUBTITLE,    "M_DISPLAY_SUBTITLE");
        m.putString(K_DISPLAY_DESCRIPTION, "M_DISPLAY_DESC");
        // uCar 私有字段
        m.putString(U_TITLE,               "U_TITLE");
        m.putString(U_ARTIST,              "U_ARTIST");
        m.putString(U_ALBUM,               "U_ALBUM");
    }
`,
  ],
  // ───────────────────────────────────────────────────────────────
  // 1) updateMetadata（切歌）：写元数据。诊断模式喷射全部字段标记；
  //    正常模式走 uCar/CarLife 语义正确方案（歌手位=artist，专辑位保持专辑名）。
  // ───────────────────────────────────────────────────────────────
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n        prevMetadata = metadata;',
    `        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();
        prevMetadata = metadata;
        if (${DIAGNOSTIC ? 'true' : 'false'}) {
            // 诊断：把所有文本字段写成各自的字段名标记
            sprayMetadata(metadata);
        } else {
            // 正常：uCar(ICCOA) 媒体元数据 —— 标题位纯歌名、歌手位歌手、歌词位整首LRC
            metadata.putString(U_TITLE, track.title);
            metadata.putString(U_ARTIST, track.artist);
            // CarLife / 通用车机按 DISPLAY_TITLE=标题行、DISPLAY_SUBTITLE=副标题行（歌手位）显示；
            // 不写则回退成 METADATA_KEY_ALBUM（专辑），与 vivo/uCar 走 UCAR_ARTIST 是两条独立路径。
            metadata.putString(K_DISPLAY_TITLE, track.title);
            metadata.putString(K_DISPLAY_SUBTITLE, track.artist);
            // METADATA_KEY_ALBUM 由 track.toMediaMetadata() 写入，保持专辑名，仪表盘与投屏卡片的
            // 「专辑位」都读它，绝不能改写为歌手，否则仪表盘专辑位会被污染。
            if (track.lyric != null) {
                // uCar 协议 Page18：Bundle 上限 1M，歌词超 0.8M 必须截断前段（按 UTF-8 字节）
                String lrc = track.lyric;
                try {
                    byte[] bytes = lrc.getBytes("UTF-8");
                    if (bytes.length > 800 * 1024) lrc = new String(bytes, 0, 800 * 1024, "UTF-8");
                } catch (java.io.UnsupportedEncodingException ignored) { }
                metadata.putString("ucar.media.metadata.LYRICS_WHOLE", lrc);
                metadata.putLong("ucar.media.metadata.LYRICS_STATUS", 0L);
            }
        }`,
  ],
  // ───────────────────────────────────────────────────────────────
  // 2) 通知栏 MediaStyle 文本（第 273–275 行）：诊断模式喷射标记，
  //    用于判断车机卡片第二行是否「镜像通知栏 SubText」。
  // ───────────────────────────────────────────────────────────────
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '        builder.setContentTitle(track.title);\n        builder.setContentText(track.artist);\n        builder.setSubText(track.album);',
    `        if (${DIAGNOSTIC ? 'true' : 'false'}) {
            builder.setContentTitle("N_ContentTitle");
            builder.setContentText("N_ContentText");
            builder.setSubText("N_SubText");
        } else {
            builder.setContentTitle(track.title);
            builder.setContentText(track.artist);
            builder.setSubText(track.album);
        }`,
  ],
  // ───────────────────────────────────────────────────────────────
  // 3) updateTitles（逐句 / 设置项刷新）：诊断模式不覆盖喷射标记，
  //    正常模式保留原本逻辑（基于 prevMetadata 增量，uCar 字段不会丢）。
  // ───────────────────────────────────────────────────────────────
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '    public void updateTitles(Bundle data) {\n      if (prevMetadata == null) return;\n      if (data.containsKey("title")) {\n        prevMetadata.putString(METADATA_KEY_TITLE, data.getString("title"));\n      }\n      if (data.containsKey("artist")) {\n        prevMetadata.putString(METADATA_KEY_ARTIST, data.getString("artist"));\n      }\n      if (data.containsKey("album")) {\n        prevMetadata.putString(METADATA_KEY_ALBUM, data.getString("album"));\n      }\n      if (data.containsKey("lyric")) {\n        prevMetadata.putString("android.media.metadata.LYRICS", data.getString("lyric"));\n      }\n      session.setMetadata(prevMetadata.build());\n      updatePlaybackState(manager.getPlayback());\n    }',
    `    public void updateTitles(Bundle data) {
      if (prevMetadata == null) return;
      if (${DIAGNOSTIC ? 'true' : 'false'}) {
        // 诊断模式：保持喷射标记不被逐句刷新覆盖
        session.setMetadata(prevMetadata.build());
        updatePlaybackState(manager.getPlayback());
        return;
      }
      if (data.containsKey("title")) {
        prevMetadata.putString(METADATA_KEY_TITLE, data.getString("title"));
      }
      if (data.containsKey("artist")) {
        prevMetadata.putString(METADATA_KEY_ARTIST, data.getString("artist"));
      }
      if (data.containsKey("album")) {
        prevMetadata.putString(METADATA_KEY_ALBUM, data.getString("album"));
      }
      if (data.containsKey("lyric")) {
        prevMetadata.putString("android.media.metadata.LYRICS", data.getString("lyric"));
      }
      session.setMetadata(prevMetadata.build());
      updatePlaybackState(manager.getPlayback());
    }`,
  ],
  // ───────────────────────────────────────────────────────────────
  // 4) 封面异步加载：原实现用全新 builder 覆盖整个 metadata，会冲掉喷射字段。
  //    改为基于 prevMetadata 增量更新（保留 uCar / 诊断标记）。
  // ───────────────────────────────────────────────────────────────
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n\n        metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap);\n        builder.setLargeIcon(bitmap);\n\n        session.setMetadata(metadata.build());',
    `        if (prevMetadata == null) return;
        prevMetadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap);
        builder.setLargeIcon(bitmap);

        session.setMetadata(prevMetadata.build());`,
  ],
]

;(async() => {
  let failed = false
  for (const [filePath, fromStr, toStr] of patchs) {
    console.log(`Patching ${filePath.replace(rootPath, '')}`)
    try {
      const file = (await fs.promises.readFile(filePath)).toString()
      if (file.includes(fromStr)) {
        await fs.promises.writeFile(filePath, file.replace(fromStr, toStr))
      } else if (file.includes('ucar.media.metadata.UCAR_TITLE') || file.includes('sprayMetadata')) {
        console.log('  已打过补丁，跳过')
      } else {
        // 目标代码未匹配且未打过补丁：通常意味着上游 fork 该段被改动，补丁已失效
        console.error(`  ✗ 未匹配到目标代码，补丁可能已失效（上游 fork 有变动）：${filePath.replace(rootPath, '')}`)
        failed = true
      }
    } catch (err) {
      console.error(`Patch ${filePath.replace(rootPath, '')} failed: ${err.message}`)
      failed = true
    }
  }

  // 规避补丁静默失效：打完后校验关键字段是否存在，缺失则直接报错退出
  const target = path.join(rootPath, 'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java')
  try {
    const patched = (await fs.promises.readFile(target)).toString()
    if (!patched.includes('sprayMetadata')) {
      console.error('\n✗ 校验失败：MetadataManager.java 未包含 sprayMetadata，补丁未生效！请检查 dependencies-patch.js 与上游 track-player fork。')
      process.exit(1)
    }
  } catch {
    // 依赖尚未安装时文件不存在，安装脚本后续会再次执行，这里不阻断
  }

  console.log('\nDependencies patch finished.\n')
  if (failed) process.exit(1)
})()
