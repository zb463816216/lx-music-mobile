// 修补依赖源码以使构建的依赖恢复正常工作

const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.join(__dirname, './')

// 车机歌词：严格照搬 vivo i 音乐 com.android.bbkmusic.manager.j（反编译 10.7.5.5）
//   b()/i(true)  → 切歌时整首歌词写 ucar.media.metadata.LYRICS_WHOLE
//   s()          → 硬互斥：车载通道走 LYRICS_LINE 并 return；A2DP 通道沿用上游 TITLE=歌词行
//   v()          → LYRICS_LINE + setExtras("music.media.extras.LYRIC", 当前行)
//   h()          → 上游 updateRemoteLyric() 已实现（逐句把歌词放进 title），不重复写
//   t(Z)         → setExtras("music.media.extras.LYRIC_IS_ALLOWED", true)
// vivo 未实现的 UCAR_TITLE / UCAR_ARTIST / LYRICS_STATUS、0.8M 截断一律不加。
// 车机连接判据沿用旧版「是否 A2DP」细分：A2DP 已连 = 蓝牙通道，未连 = 车载通道。
const patchs = [
  // ① updateMetadata：vivo genBaseMetadataBuilder() + i(true)
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n        prevMetadata = metadata;',
    `        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();
        // 【测试版 · 可回退】ICCOA 1.0.16 Page 18 字段固定值，用于定位「车机读哪个 key、显示在哪个位置」。
        // 标准 TITLE/ARTIST 仍是真实歌名/歌手，可对比车机是否优先使用 UCAR_TITLE/UCAR_ARTIST。
        // 实测完成后 git revert 本提交即恢复真实数据。
        metadata.putString("ucar.media.metadata.UCAR_TITLE", "TIT:uCar标题");
        metadata.putString("ucar.media.metadata.UCAR_ARTIST", "ART:uCar歌手");
        metadata.putString("ucar.media.metadata.LYRICS_WHOLE", "WHOLE:整首歌词");
        metadata.putString("ucar.media.metadata.LYRICS_LINE", "LINE:单句歌词");
        metadata.putLong("ucar.media.metadata.LYRICS_STATUS", 0L);
        metadata.putString("ucar.media.metadata.FAVORITE_STATE", "1");
        metadata.putString("ucar.media.metadata.COLLECT_STATE", "1");
        metadata.putString("ucar.media.metadata.VIP", "1");
        metadata.putLong("ucar.media.metadata.PLAY_MODE", 2L);
        android.os.Bundle allowed = new android.os.Bundle();
        allowed.putBoolean("music.media.extras.LYRIC_IS_ALLOWED", true);
        session.setExtras(allowed);
        prevMetadata = metadata;`,
  ],
  // ② updateTitles：vivo s(String lyric, long position) 原样互斥
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
      android.media.AudioManager am = (android.media.AudioManager) service.getSystemService(android.content.Context.AUDIO_SERVICE);
      boolean a2dp = am != null && am.isBluetoothA2dpOn();

      if (!a2dp) {
        // vivo v(): 车载通道，逐句歌词走 LYRICS_LINE + extras，TITLE 保持歌名
        String line = data.getString("title");
        if (line != null) {
          if (!session.isActive()) session.setActive(true);
          android.os.Bundle extras = new android.os.Bundle();
          extras.putString("music.media.extras.LYRIC", line);
          session.setExtras(extras);
          prevMetadata.putString("ucar.media.metadata.LYRICS_LINE", line);
          prevMetadata.putString("android.media.metadata.LYRICS", line);
        }
        session.setMetadata(prevMetadata.build());
        updatePlaybackState(manager.getPlayback());
        return;
      }

      // vivo h(): A2DP 蓝牙通道，沿用上游，title 即当前歌词行
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
]

;(async() => {
  for (const [filePath, fromStr, toStr] of patchs) {
    console.log(`Patching ${filePath.replace(rootPath, '')}`)
    try {
      const file = (await fs.promises.readFile(filePath)).toString()
      await fs.promises.writeFile(filePath, file.replace(fromStr, toStr))
    } catch (err) {
      console.error(`Patch ${filePath.replace(rootPath, '')} failed: ${err.message}`)
    }
  }
  console.log('\nDependencies patch finished.\n')
})()

