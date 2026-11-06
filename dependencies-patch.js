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
  // 反编译旧版 APK 确认：UCAR_TITLE=纯歌名（不拼歌手）、UCAR_ARTIST=歌手、LYRICS_WHOLE=整首LRC。
  // 车机把 UCAR_TITLE(歌名) + 标准METADATA_KEY_ARTIST(歌手) 拼成一行显示「歌名 - 歌手」，不重复。
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n        prevMetadata = metadata;',
    `        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();
        // uCar (ICCOA) 媒体元数据（对齐旧版）：标题位纯歌名、歌手位歌手、歌词位整首LRC
        metadata.putString("ucar.media.metadata.UCAR_TITLE", track.title);
        metadata.putString("ucar.media.metadata.UCAR_ARTIST", track.artist);
        // CarLife / 通用车机按 DISPLAY_TITLE=标题行、DISPLAY_SUBTITLE=副标题行（歌手位）显示；
        // 不写则回退成 METADATA_KEY_ALBUM（专辑），与 vivo/uCar 走 UCAR_ARTIST 是两条独立路径。
        metadata.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, track.title);
        metadata.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, track.artist);
        // METADATA_KEY_ALBUM 保持专辑名（由 track.toMediaMetadata() 写入），仪表盘与投屏卡片的
        // 「专辑位」都读它，绝不能改写为歌手，否则仪表盘专辑位会被污染。车机卡片第二行（歌手位）
        // 走 DISPLAY_SUBTITLE(=歌手)，与 ARTIST / UCAR_ARTIST 一致；若个别车机固件仍回退到 ALBUM，
        // 则需该车型单独适配，不在此全局改写。
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
        prevMetadata = metadata;`,
  ],
  // ② 逐行 / 设置项刷新：updateTitles（完全复刻旧版 r() = updateNowPlayingTitles）
  // 旧版逻辑：isBluetoothA2dpOn → 找 A2DP 设备 → 新建 Builder → 只写标准字段 → 整条替换。
  // 不写 ucar 字段（ucar 在切歌时 updateMetadata 写入，逐句被替换后由 updatePlayback 恢复 prevMetadata）。
  // lyric 字段单独处理：写入 prevMetadata（供 LYRICS_WHOLE 更新）。
  // 整体替换整个 updateTitles 方法。
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '    public void updateTitles(Bundle data) {\n      if (prevMetadata == null) return;\n      if (data.containsKey("title")) {\n        prevMetadata.putString(METADATA_KEY_TITLE, data.getString("title"));\n      }\n      if (data.containsKey("artist")) {\n        prevMetadata.putString(METADATA_KEY_ARTIST, data.getString("artist"));\n      }\n      if (data.containsKey("album")) {\n        prevMetadata.putString(METADATA_KEY_ALBUM, data.getString("album"));\n      }\n      if (data.containsKey("lyric")) {\n        prevMetadata.putString("android.media.metadata.LYRICS", data.getString("lyric"));\n      }\n      session.setMetadata(prevMetadata.build());\n      updatePlaybackState(manager.getPlayback());\n    }',
    `    public void updateTitles(Bundle data) {
      if (prevMetadata == null) return;
      // lyric 字段：写入 prevMetadata（LYRICS_WHOLE 更新，不参与逐句替换）
      if (data.containsKey("lyric")) {
        // 同样按 uCar 协议做 0.8M UTF-8 截断
        String lrc = data.getString("lyric");
        if (lrc != null) {
          try {
            byte[] bytes = lrc.getBytes("UTF-8");
            if (bytes.length > 800 * 1024) lrc = new String(bytes, 0, 800 * 1024, "UTF-8");
          } catch (java.io.UnsupportedEncodingException ignored) { }
          prevMetadata.putString("android.media.metadata.LYRICS", lrc);
          prevMetadata.putString("ucar.media.metadata.LYRICS_WHOLE", lrc);
        }
        session.setMetadata(prevMetadata.build());
        updatePlaybackState(manager.getPlayback());
        return;
      }
      // 完全复刻旧版 r()：A2DP 判断 → 新建 Builder → 只写标准字段 → 整条替换
      android.media.AudioManager am = (android.media.AudioManager) service.getSystemService(android.content.Context.AUDIO_SERVICE);
      if (am != null && am.isBluetoothA2dpOn()) {
        android.media.AudioDeviceInfo[] devs = null;
        if (android.os.Build.VERSION.SDK_INT >= 23) {
          devs = am.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS);
        }
        if (devs != null) {
          for (android.media.AudioDeviceInfo d : devs) {
            if (d.getType() == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) {
              // 基于 prevMetadata 增量更新：复用上一次 updateMetadata 写入的 uCar 专用字段
              // （UCAR_TITLE / UCAR_ARTIST / LYRICS_WHOLE）。否则车机投屏卡片的「歌手位」会回退成专辑。
              MediaMetadataCompat.Builder builder = prevMetadata;
              if (data.containsKey("title")) {
                builder.putString(METADATA_KEY_TITLE, data.getString("title"));
                builder.putString("ucar.media.metadata.UCAR_TITLE", data.getString("title"));
              }
              if (data.containsKey("artist")) {
                builder.putString(METADATA_KEY_ARTIST, data.getString("artist"));
                builder.putString("ucar.media.metadata.UCAR_ARTIST", data.getString("artist"));
                builder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, data.getString("artist"));
              }
              // METADATA_KEY_ALBUM 保持专辑名（updateMetadata 已写入），不改写为歌手，
              // 避免污染仪表盘专辑位；歌手位由 DISPLAY_SUBTITLE 承担。
              if (prevArtwork != null) {
                builder.putString(METADATA_KEY_ART_URI, prevArtwork.toString());
              }
              if (prevArtResource != null) {
                builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, prevArtResource);
              }
              session.setMetadata(builder.build());
              break;
            }
          }
        }
      }
      updatePlaybackState(manager.getPlayback());
    }`,
  ],
  // ③ 封面异步加载：原实现用全新 builder 覆盖整个 metadata，
  // 会把 ①② 写入的 UCAR_TITLE / LYRICS_WHOLE 全部冲掉（车机歌词随机消失）。
  // 改为基于 prevMetadata 增量更新。
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
