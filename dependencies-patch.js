// 修补依赖源码以使构建的依赖恢复正常工作

const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.join(__dirname, './')

// ============================ 车机歌词 + uCar 绑定通道 ============================
// 依据：ICCOA《车机投屏-媒体应用接入标准 1.0.16》Page 3-5 / 17-18
//   + vivo 官方 i 音乐 com.android.bbkmusic.manager.j 字节码实证（b/h/i/q/v/t 方法）
//
// 1) 通道判据（v1.9.2-salt.4 的错误已修正）：
//    uCar 车机互联通过 MediaBrowserService 绑定，判据 = 是否发生该绑定，
//    由 CarMediaBrowserService.onGetRoot 置 MusicService.carUcarBound=true、onDestroy 复位。
//    协议 Page 4 允许读 rootHints 的 UCAR 标识，但 vivo 车机反编译显示其只按
//    clientPackageName 判来源、未携带该标识，故不把它当唯一判据。
//    ❌ 不再用 isBluetoothA2dpOn()：车机互联本身就走蓝牙 A2DP，实车恒为 true。
//    ✅ 车机互联通道：元数据保持 vivo i(Z) 那套（歌名/歌手/专辑），歌词只走 LYRICS_WHOLE；
//       逐句事件直接忽略，不覆盖 TITLE/ARTIST，也不刷新 metadata。
//    ✅ 非车机通道：沿用上游逐句蓝牙歌词（vivo h(String)：TITLE=歌词行、ARTIST=歌名 - 歌手）。
//
// 2) 字段严格照搬 vivo 官方（反编译确认，vivo 全 APK 不含任何 UCAR 字符串）：
//    DISPLAY_TITLE=歌名 / DISPLAY_SUBTITLE=歌手 / GENRE=歌名 / ARTIST=歌手 / ALBUM=专辑
//    / LYRICS_WHOLE=整首 LRC / extras.LYRIC_IS_ALLOWED=true。
//    ❌ 不写 UCAR_TITLE / UCAR_ARTIST（协议 Page 18 有定义，但 vivo 这个 APP 未实现，实车也不生效）。
//    ❌ 不写 LYRICS_LINE / LYRICS_STATUS / extras.LYRIC / 0.8M 截断 / 标准 LYRICS。
//
// 3) 封面异步加载修复：fork 原版 updateArtwork() 用全新 Builder 整条替换 metadata，
//    会把切歌时写入的车机字段全部冲掉；改为基于 prevMetadata 增量更新。
// ==============================================================================
const patchs = [
  // ① updateMetadata：vivo b() + i(true)
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n        prevMetadata = metadata;',
    `        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();
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
  // ② updateTitles：按 uCar 绑定来源分流（不再用 A2DP）
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

      if (MusicService.carUcarBound) {
        // uCar 车机互联：歌词只要整首 LYRICS_WHOLE；逐句事件忽略，
        // 不覆盖 TITLE/ARTIST、不 setMetadata，避免把歌名歌手刷成蓝牙歌词
        if (hasWholeLyric) session.setMetadata(prevMetadata.build());
        updatePlaybackState(manager.getPlayback());
        return;
      }

      // 非车机（普通蓝牙/本地）：沿用上游逐句蓝牙歌词
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
  // ③ updateArtwork：增量更新，别冲掉车机字段
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    `        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();

        metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap);
        builder.setLargeIcon(bitmap);

        session.setMetadata(metadata.build());`,
    `        if (prevMetadata == null) return;
        prevMetadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap);
        builder.setLargeIcon(bitmap);

        session.setMetadata(prevMetadata.build());`,
  ],
  // ④ TrackMetadata.toMediaMetadata：移除上游标准 LYRICS 写入
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/models/TrackMetadata.java',
    `        if (lyric != null) {
            builder.putString("android.media.metadata.LYRICS", lyric);
        }

`,
    '',
  ],
  // ⑤ MusicService：import MediaSessionCompat
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/MusicService.java',
    'import android.os.IBinder;',
    `import android.os.IBinder;
import android.support.v4.media.session.MediaSessionCompat;`,
  ],
  // ⑥ MusicService：暴露 session token 与 uCar 绑定状态给 CarMediaBrowserService
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/MusicService.java',
    `    MusicManager manager;
    Handler handler;`,
    `    MusicManager manager;
    Handler handler;
    public static volatile MediaSessionCompat.Token carSessionToken = null;
    public static volatile boolean carUcarBound = false;`,
  ],
  // ⑦ MusicService：创建播放会话后记录 token
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/MusicService.java',
    `        manager = new MusicManager(this);
        handler = new Handler();`,
    `        manager = new MusicManager(this);
        handler = new Handler();
        carSessionToken = manager.getMetadata().getSession().getSessionToken();`,
  ],
]

;(async() => {
  for (const [filePath, fromStr, toStr] of patchs) {
    console.log(`Patching ${filePath.replace(rootPath, '')}`)
    try {
      const file = (await fs.promises.readFile(filePath)).toString()
      const result = file.replace(fromStr, toStr)
      if (result === file) {
        console.error(`\n✗ 补丁锚点未命中：${filePath}\n  片段：${fromStr.slice(0, 80).replace(/\n/g, '\\n')}\n  请检查 fork 版本是否与 d76fe8ff 一致！`)
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
