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
  // ① 切歌 / 整曲元数据：updateMetadata
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n        prevMetadata = metadata;',
    `        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();
        // uCar (ICCOA) 自定义媒体元数据
        metadata.putString("ucar.media.metadata.UCAR_TITLE", track.title);
        metadata.putString("ucar.media.metadata.UCAR_ARTIST", track.artist);
        if (track.lyric != null) {
          metadata.putString("ucar.media.metadata.LYRICS_WHOLE", track.lyric);
          metadata.putLong("ucar.media.metadata.LYRICS_STATUS", 0L);
        }
        prevMetadata = metadata;`,
  ],
  // ② 逐行 / 设置项刷新：updateTitles
  // 合并用户 1.7 版逻辑：仅当当前输出为「蓝牙 A2DP」（车机/蓝牙耳机）时，才把标准 TITLE 覆盖为当前歌词行，
  // 实现车机标题位置滚动歌词；非 A2DP（手机扬声器等）时标准 TITLE 保持歌名不变。
  // 同时始终同步 uCar(ICCOA) 字段。整体替换整个 updateTitles 方法，避免与"无条件写 TITLE"冲突。
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '    public void updateTitles(Bundle data) {\n      if (prevMetadata == null) return;\n      if (data.containsKey("title")) {\n        prevMetadata.putString(METADATA_KEY_TITLE, data.getString("title"));\n      }\n      if (data.containsKey("artist")) {\n        prevMetadata.putString(METADATA_KEY_ARTIST, data.getString("artist"));\n      }\n      if (data.containsKey("album")) {\n        prevMetadata.putString(METADATA_KEY_ALBUM, data.getString("album"));\n      }\n      if (data.containsKey("lyric")) {\n        prevMetadata.putString("android.media.metadata.LYRICS", data.getString("lyric"));\n      }\n      session.setMetadata(prevMetadata.build());\n      updatePlaybackState(manager.getPlayback());\n    }',
    `    public void updateTitles(Bundle data) {
      if (prevMetadata == null) return;
      // 判断当前是否蓝牙 A2DP 输出（车机/蓝牙耳机）。是才把「标准标题」写成当前歌词行。
      boolean isA2dp = false;
      try {
        android.media.AudioManager am = (android.media.AudioManager) service.getSystemService(android.content.Context.AUDIO_SERVICE);
        if (am != null) {
          if (android.os.Build.VERSION.SDK_INT >= 23) {
            android.media.AudioDeviceInfo[] devs = am.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS);
            for (android.media.AudioDeviceInfo d : devs) {
              if (d.getType() == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) { isA2dp = true; break; }
            }
          } else if (am.isBluetoothA2dpOn()) {
            isA2dp = true;
          }
        }
      } catch (Throwable ignored) {}
      if (data.containsKey("title")) {
        // uCar 标题始终同步（当前歌词行即 title）
        prevMetadata.putString("ucar.media.metadata.UCAR_TITLE", data.getString("title"));
        // 仅蓝牙 A2DP 时，把标准标题也改为歌词行，实现车机标题位置滚歌词；否则保持歌名
        if (isA2dp) {
          prevMetadata.putString(METADATA_KEY_TITLE, data.getString("title"));
        }
      }
      if (data.containsKey("artist")) {
        prevMetadata.putString("ucar.media.metadata.UCAR_ARTIST", data.getString("artist"));
        // 标准 artist 仅在 A2DP 时覆盖为「歌名 - 歌手」，非 A2DP 保持原歌手
        if (isA2dp) {
          prevMetadata.putString(METADATA_KEY_ARTIST, data.getString("artist"));
        }
      }
      if (data.containsKey("album")) {
        prevMetadata.putString(METADATA_KEY_ALBUM, data.getString("album"));
      }
      if (data.containsKey("lyric")) {
        prevMetadata.putString("android.media.metadata.LYRICS", data.getString("lyric"));
        prevMetadata.putString("ucar.media.metadata.LYRICS_WHOLE", data.getString("lyric"));
      }
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
