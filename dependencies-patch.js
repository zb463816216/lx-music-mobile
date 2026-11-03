// 修补依赖源码以使构建的依赖恢复正常工作

const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.join(__dirname, './')

const patchs = [
  // ───────────────────────────────────────────────────────────────
  // uCar (ICCOA 智慧车联开放联盟) 车机媒体元数据扩展
  // Jovi InCar / vivo 等车机遵循该标准，通过 MediaSession 的自定义 key 显示歌词：
  //   ucar.media.metadata.UCAR_TITLE      标题（车机优先于 METADATA_KEY_TITLE）
  //   ucar.media.metadata.UCAR_ARTIST     艺术家
  //   ucar.media.metadata.LYRICS_WHOLE    整首歌词（LRC，推荐）
  //   ucar.media.metadata.LYRICS_STATUS    歌词状态 0成功/1无/2加载中/3失败
  // 标题/艺术家由 track 自带，始终写入；整首歌词来自 JS 传入的 lyric 字段
  // （「车载歌词」或「显示完整蓝牙歌词」开启时，playList.ts 把整首 lrc 作为 lyric 传下来）。
  // ① 切歌 / 整曲元数据：updateMetadata（测试版：固定字段值）
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n        prevMetadata = metadata;',
    `        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();
        // 【测试版】uCar 固定字段值，切歌时即可在车机看到
        metadata.putString("ucar.media.metadata.UCAR_TITLE", "TIT:标题");
        metadata.putString("ucar.media.metadata.UCAR_ARTIST", "ART:歌手");
        metadata.putString("ucar.media.metadata.LYRICS_LINE", "LINE:单句歌词");
        metadata.putString("ucar.media.metadata.LYRICS_WHOLE", "WHOLE:整首歌词");
        metadata.putLong("ucar.media.metadata.LYRICS_STATUS", 0L);
        prevMetadata = metadata;`,
  ],
  // ② 逐行 / 设置项刷新：updateTitles
  // 【测试版】固定字段值，用于在车机上定位「哪个 ucar 字段被识别、显示在哪个位置」。
  // 确认后把固定值改回真实数据（title/artist/lyric 从 data 取值）即可。
  // 字段清单（对照 vivo 实测）：
  //   UCAR_TITLE   -> "TIT:标题"    (标题位置)
  //   UCAR_ARTIST  -> "ART:歌手"    (艺术家位置)
  //   LYRICS_LINE  -> "LINE:单句歌词" (单句歌词，逐句滚动)
  //   LYRICS_WHOLE -> "WHOLE:整首歌词" (整首 LRC)
  //   LYRICS_STATUS-> 0
  // 整体替换整个 updateTitles 方法。
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '    public void updateTitles(Bundle data) {\n      if (prevMetadata == null) return;\n      if (data.containsKey("title")) {\n        prevMetadata.putString(METADATA_KEY_TITLE, data.getString("title"));\n      }\n      if (data.containsKey("artist")) {\n        prevMetadata.putString(METADATA_KEY_ARTIST, data.getString("artist"));\n      }\n      if (data.containsKey("album")) {\n        prevMetadata.putString(METADATA_KEY_ALBUM, data.getString("album"));\n      }\n      if (data.containsKey("lyric")) {\n        prevMetadata.putString("android.media.metadata.LYRICS", data.getString("lyric"));\n      }\n      session.setMetadata(prevMetadata.build());\n      updatePlaybackState(manager.getPlayback());\n    }',
    `    public void updateTitles(Bundle data) {
      if (prevMetadata == null) return;
      // 【测试版】固定字段值，车机上可据此定位字段与位置
      String testTitle = "TIT:标题";
      String testArtist = "ART:歌手";
      String testLine = "LINE:单句歌词";
      String testWhole = "WHOLE:整首歌词";
      if (data.containsKey("title")) {
        prevMetadata.putString(METADATA_KEY_TITLE, testTitle);
        prevMetadata.putString("ucar.media.metadata.UCAR_TITLE", testTitle);
      }
      if (data.containsKey("artist")) {
        prevMetadata.putString(METADATA_KEY_ARTIST, testArtist);
        prevMetadata.putString("ucar.media.metadata.UCAR_ARTIST", testArtist);
      }
      if (data.containsKey("album")) {
        prevMetadata.putString(METADATA_KEY_ALBUM, data.getString("album"));
      }
      if (data.containsKey("lyric")) {
        prevMetadata.putString("android.media.metadata.LYRICS", testWhole);
        prevMetadata.putString("ucar.media.metadata.LYRICS_WHOLE", testWhole);
      }
      // 单句歌词字段（逐句滚动）
      prevMetadata.putString("ucar.media.metadata.LYRICS_LINE", testLine);
      prevMetadata.putLong("ucar.media.metadata.LYRICS_STATUS", 0L);
      session.setMetadata(prevMetadata.build());
      updatePlaybackState(manager.getPlayback());
    }`,
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
      } else if (file.includes('ucar.media.metadata.UCAR_TITLE')) {
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
    if (!patched.includes('ucar.media.metadata.UCAR_TITLE')) {
      console.error('\n✗ 校验失败：MetadataManager.java 未包含 ucar.media.metadata.UCAR_TITLE，uCar 歌词补丁未生效！请检查 dependencies-patch.js 与上游 track-player fork。')
      process.exit(1)
    }
  } catch {
    // 依赖尚未安装时文件不存在，安装脚本后续会再次执行，这里不阻断
  }

  console.log('\nDependencies patch finished.\n')
  if (failed) process.exit(1)
})()
