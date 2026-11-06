// 修补依赖源码以使构建的依赖恢复正常工作

const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.join(__dirname, './')

// ============================ 车机歌词：两条通道分流 ============================
// 实车探针（1.9.2-probe.1）结论：车机只读 DISPLAY_TITLE / ALBUM / LYRICS_WHOLE，
// 不读 ARTIST、DISPLAY_SUBTITLE、GENRE、TITLE、LYRICS_LINE、extras.LYRIC。
// 官方 vivo 自带音乐实车对照：大屏「歌名 / 歌手」，仪表「歌名-歌手 / 专辑」，
// 歌词由车机按带时间戳的整首 LRC 自行高亮滚动。
//
// 蓝牙歌词（AVRCP 逐句字幕）与车机互联（uCar / ICCOA MediaSession）是两套通道：
//   · 车机互联（未连 A2DP）：标题歌手走 UCAR_TITLE / UCAR_ARTIST，
//     歌词只走 ucar.media.metadata.LYRICS_WHOLE 整首 LRC，由车机按进度滚动；
//     逐句事件直接忽略，不打扰车机元数据（避免冲掉 UCAR 字段 / 重置滚动）。
//   · 蓝牙 A2DP（已连）：沿用上游逐句蓝牙歌词（title 即当前歌词行），不写 uCar 字段。
// 两个开关都在 JS 侧生效：player.isShowBluetoothLyric 控制逐句事件，
// player.isShowBluetoothFullLyric 控制整首 LRC 下放；开关打开后由本补丁先判通道再分流。
//
// UCAR_TITLE / UCAR_ARTIST 取自 jovi-dev（用户实车验证「歌名 - 歌手」可用的版本），
// 确切 key 见该分支 dependencies-patch.js:26-27。
// 标准 android.media.metadata.LYRICS 通道整条移除（补丁③）。
// 不写 LYRICS_LINE / LYRICS_STATUS / extras.LYRIC / 0.8M 截断等未验证字段。
// =============================================================================
const patchs = [
  // ① updateMetadata：切歌 / 整曲元数据
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n        prevMetadata = metadata;',
    `        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();
        metadata.putString("ucar.media.metadata.UCAR_TITLE", track.title);
        metadata.putString("ucar.media.metadata.UCAR_ARTIST", track.artist);
        metadata.putString("android.media.metadata.DISPLAY_TITLE", track.title);
        metadata.putString("android.media.metadata.DISPLAY_SUBTITLE", track.artist);
        metadata.putString("android.media.metadata.GENRE", track.title);
        if (track.lyric != null) {
          metadata.putString("ucar.media.metadata.LYRICS_WHOLE", track.lyric);
        }
        android.os.Bundle allowed = new android.os.Bundle();
        allowed.putBoolean("music.media.extras.LYRIC_IS_ALLOWED", true);
        session.setExtras(allowed);
        prevMetadata = metadata;`,
  ],
  // ② updateTitles：先判通道（A2DP），再走对应歌词逻辑
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    `    public void updateTitles(Bundle data) {
      if (prevMetadata == null) return;
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
    `    public void updateTitles(Bundle data) {
      if (prevMetadata == null) return;
      boolean hasWholeLyric = data.containsKey("lyric");
      if (hasWholeLyric) {
        prevMetadata.putString("ucar.media.metadata.LYRICS_WHOLE", data.getString("lyric"));
      }
      android.media.AudioManager am = (android.media.AudioManager) service.getSystemService(android.content.Context.AUDIO_SERVICE);
      boolean a2dp = am != null && am.isBluetoothA2dpOn();

      if (!a2dp) {
        // 车机互联通道：歌词只要整首 LYRICS_WHOLE，逐句事件不写任何字段、不刷新元数据
        if (hasWholeLyric) session.setMetadata(prevMetadata.build());
        updatePlaybackState(manager.getPlayback());
        return;
      }

      // 蓝牙 A2DP 通道：沿用上游逐句蓝牙歌词，不写 uCar 字段
      if (data.containsKey("title")) {
        prevMetadata.putString(METADATA_KEY_TITLE, data.getString("title"));
      }
      if (data.containsKey("artist")) {
        prevMetadata.putString(METADATA_KEY_ARTIST, data.getString("artist"));
      }
      if (data.containsKey("album")) {
        prevMetadata.putString(METADATA_KEY_ALBUM, data.getString("album"));
      }
      session.setMetadata(prevMetadata.build());
      updatePlaybackState(manager.getPlayback());
    }`,
  ],
  // ③ TrackMetadata.toMediaMetadata：移除上游标准 LYRICS 写入
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/models/TrackMetadata.java',
    `        if (lyric != null) {
            builder.putString("android.media.metadata.LYRICS", lyric);
        }

`,
    '',
  ],
]

;(async() => {
  for (const [filePath, fromStr, toStr] of patchs) {
    console.log(`Patching ${filePath.replace(rootPath, '')}`)
    try {
      const file = (await fs.promises.readFile(filePath)).toString()
      const result = file.replace(fromStr, toStr)
      if (result === file) {
        console.error(`\n✗ 补丁锚点未命中：${filePath}\n  请检查 fork 版本是否与 d76fe8ff 一致！`)
        process.exitCode = 1
      }
      await fs.promises.writeFile(filePath, result)
    } catch (err) {
      console.error(`Patch ${filePath.replace(rootPath, '')} failed: ${err.message}`)
      process.exitCode = 1
    }
  }
  console.log('\nDependencies patch finished.\n')
})()
