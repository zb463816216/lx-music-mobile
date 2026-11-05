// 修补依赖源码以使构建的依赖恢复正常工作

const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.join(__dirname, './')

// ============================ 字段探针版（测试用，单提交可 revert） ============================
// 目的（两张实车截图定位的两个问题）：
//   问题1 没开蓝牙歌词时副标题槽显示专辑（应显示歌手）→ 每个字段写固定标记，看车机各槽位读哪个 key
//   问题2 开蓝牙歌词后标题栏卡在第一句歌词不动 → LYRICS_LINE/TITLE/extras 每次调用递增编号 L/T/E{n}，
//         LYRICS_WHOLE 首行写 CALL#{n}：编号不涨=逐句事件断了；编号在涨=车机收到但不刷新
// 另：LYRICS_WHOLE 带时间戳（WH0/WH3/WH6…）验证车机是否跟随进度自动滚动整首歌词（协议 p18）
// ===========================================================================================
const patchs = [
  // ① updateMetadata：固定字段标记 + 时间戳整首歌词
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n        prevMetadata = metadata;',
    `        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();
        metadata.putString("android.media.metadata.TITLE", "T:标题位");
        metadata.putString("android.media.metadata.ARTIST", "A:歌手位");
        metadata.putString("android.media.metadata.ALBUM", "B:专辑位");
        metadata.putString("android.media.metadata.GENRE", "G:流派位");
        metadata.putString("android.media.metadata.DISPLAY_TITLE", "DT:显题位");
        metadata.putString("android.media.metadata.DISPLAY_SUBTITLE", "DS:副题位");
        metadata.putString("ucar.media.metadata.LYRICS_WHOLE", "[00:00.00]WH0\\n[00:03.00]WH3\\n[00:06.00]WH6\\n[00:09.00]WH9\\n[00:12.00]WH12\\n[00:15.00]WH15\\n[00:18.00]WH18\\n[00:21.00]WH21");
        android.os.Bundle allowed = new android.os.Bundle();
        allowed.putBoolean("music.media.extras.LYRIC_IS_ALLOWED", true);
        session.setExtras(allowed);
        prevMetadata = metadata;`,
  ],
  // ② updateTitles：调用计数探针（每次调用 n+1，写全部通道）
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
      probeCount++;
      String n = String.valueOf(probeCount);
      prevMetadata.putString("ucar.media.metadata.LYRICS_LINE", "L" + n);
      prevMetadata.putString("ucar.media.metadata.LYRICS_WHOLE", "CALL#" + n);
      prevMetadata.putString("android.media.metadata.TITLE", "T" + n);
      android.os.Bundle extras = new android.os.Bundle();
      extras.putString("music.media.extras.LYRIC", "E" + n);
      session.setExtras(extras);
      session.setMetadata(prevMetadata.build());
      updatePlaybackState(manager.getPlayback());
    }`,
  ],
  // ③ TrackMetadata.toMediaMetadata：移除上游标准 LYRICS 写入（与 salt.3 一致）
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/models/TrackMetadata.java',
    `        if (lyric != null) {
            builder.putString("android.media.metadata.LYRICS", lyric);
        }

`,
    '',
  ],
  // ④ 计数器字段
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '    private MediaMetadataCompat.Builder prevMetadata = null;',
    '    private MediaMetadataCompat.Builder prevMetadata = null;\n    private int probeCount = 0;',
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
