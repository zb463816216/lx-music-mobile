// 修补依赖源码以使构建的依赖恢复正常工作

const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.join(__dirname, './')

// ============================ 车机显示：按实车槽位直接给值 ============================
// 三轮实车探针 + vivo 官方 APK 反编译 + ICCOA 1.0.16 的结论：
//
// 1) 这台车机对第三方 APP 走通用映射，元数据实际只读三个槽：
//      标题槽   <- android.media.metadata.DISPLAY_TITLE
//      副标题槽 <- android.media.metadata.ALBUM      （探针中 A:/DS:/G:/T/L/E 标记全部未显示）
//      歌词槽   <- ucar.media.metadata.LYRICS_WHOLE  （带时间戳 LRC，车机自行滚动，已实车验证正常）
//    协议 Page 17 标准字段表里并没有 METADATA_KEY_ALBUM，vivo 官方 APP 之所以能显示歌手，
//    是因为它走系统级 MediaBrowserService 绑定（clientPackageName 白名单）。
//    salt.5 补的绑定服务实测没有改变这台车机的槽位映射，故不再依赖「判通道」来决定写什么。
//
// 2) 因此副标题槽直接写歌手名：ALBUM = track.artist。
//    代价：仪表第二行也随之显示歌手而非专辑（该槽同样读 ALBUM，无法拆开）。
//    ❗ updateTitles 绝不能再写 ALBUM，否则逐句事件会把歌手覆盖回专辑。
//
// 3) 两套歌词靠字段天然隔离，不需要任何通道判断：
//      车机：LYRICS_WHOLE 整首 LRC（车机按进度滚动）
//      蓝牙：TITLE = 当前歌词行、ARTIST = "歌名 - 歌手"（上游 JS 已实现，车机不读这两个槽）
//    ❌ 不再用 isBluetoothA2dpOn()（车机互联本身就走 A2DP，实车恒 true）；
//    ❌ 不再用 MediaBrowserService 绑定状态做分流（实测车机未按预期绑定）。
//
// 4) 字段其余部分照搬 vivo 官方 i(Z)：
//    DISPLAY_TITLE=歌名 / DISPLAY_SUBTITLE=歌手 / GENRE=歌名 / LYRIC_IS_ALLOWED=true。
//    ❌ 不写 UCAR_TITLE / UCAR_ARTIST（vivo 全 APK 无此字符串，实车无效）；
//    ❌ 不写 LYRICS_LINE / LYRICS_STATUS / extras.LYRIC / 0.8M 截断 / 标准 LYRICS。
//
// 5) 封面异步加载修复：fork 原版 updateArtwork() 用全新 Builder 整条替换 metadata，
//    会把切歌时写入的车机字段全部冲掉；改为基于 prevMetadata 增量更新（salt.5 实车已验证有效）。
// =================================================================================
const patchs = [
  // ① updateMetadata：副标题槽(ALBUM)写歌手，其余照搬 vivo
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n        prevMetadata = metadata;',
    `        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();
        metadata.putString("android.media.metadata.ALBUM", track.artist);
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
  // ② updateTitles：不再判通道；整首歌词走 LYRICS_WHOLE，逐句只写 TITLE/ARTIST，绝不碰 ALBUM
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
      if (data.containsKey("lyric")) {
        prevMetadata.putString("ucar.media.metadata.LYRICS_WHOLE", data.getString("lyric"));
      }
      if (data.containsKey("title")) {
        prevMetadata.putString(METADATA_KEY_TITLE, data.getString("title"));
      }
      if (data.containsKey("artist")) {
        prevMetadata.putString(METADATA_KEY_ARTIST, data.getString("artist"));
      }
      // 不写专辑字段：副标题槽固定为歌手，逐句事件不能覆盖回专辑
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
  // ⑥ MusicService：暴露 session token 给 CarMediaBrowserService（仅用于协议绑定，不作分流判据）
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/MusicService.java',
    `    MusicManager manager;
    Handler handler;`,
    `    MusicManager manager;
    Handler handler;
    public static volatile MediaSessionCompat.Token carSessionToken = null;`,
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
