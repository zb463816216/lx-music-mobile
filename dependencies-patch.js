// 修补依赖源码以使构建的依赖恢复正常工作

const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.join(__dirname, './')

// ============================ 车机接入：按 ICCOA 1.0.16 用协议字段，不篡改标准字段 ============================
// 依据：vivo 开发者在线文档「媒体应用接入标准」= 本地 ICCOA 1.0.16 PDF（字段集合零差异）
//   + vivo 官方 i 音乐 APK 反编译（manager.j / MediaSessionService / car.mediasession.utils）
//
// 用户实测纠正（salt.6/7 的错误，本版全部改掉）：
//   ❌ 把 android.media.metadata.ALBUM 写成歌手 —— 篡改字段语义、专辑信息丢失，且效果仍不对。
//      本版 ALBUM 交还 track.toMediaMetadata()，保持专辑名。
//   ❌ updateTitles 把逐句歌词写进 METADATA_KEY_TITLE —— 蓝牙歌词一开，标题就被刷成歌词行。
//      本版逐句歌词只写 LYRICS_LINE，updateTitles 完全不碰 TITLE/ARTIST/ALBUM。
//
// 按协议给值（vivo 在线文档 Page 18 / PDF Page 18）：
//   UCAR_TITLE   车机专用标题，车机优先使用，不存在才回落 METADATA_KEY_TITLE
//   UCAR_ARTIST  车机专用艺术家，车机优先使用，不存在才回落 METADATA_KEY_ARTIST
//   → 这两个字段固定为歌名/歌手，逐句事件再也不会影响车机标题。
//   LYRICS_STATUS 歌词状态（Long，0=成功）；协议明确「不存在则视为不支持歌词」。
//
// 其余按文档/实证保留：
//   DISPLAY_TITLE=歌名 / DISPLAY_SUBTITLE=歌手 / GENRE=歌名（vivo i(Z) 写法）
//   LYRICS_WHOLE=整首带时间戳 LRC（车机自行滚动，实车已验证）
//   setQueue + setQueueTitle + setActiveQueueItemId（Page 14 播放队列），
//   队列项 MediaDescription 的 setSubtitle=歌手（Page 10，vivo 实证）
//   updateArtwork 基于 prevMetadata 增量更新（否则封面异步加载冲掉全部字段）
// ==========================================================================================================
const patchs = [
  // ① updateMetadata：协议字段 + 专辑保持原值 + 播放队列
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n        prevMetadata = metadata;',
    `        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();
        // uCar 专用标题/歌手：车机优先读这两个，逐句歌词不会再改动标题
        metadata.putString("ucar.media.metadata.UCAR_TITLE", track.title);
        metadata.putString("ucar.media.metadata.UCAR_ARTIST", track.artist);
        metadata.putString("android.media.metadata.DISPLAY_TITLE", track.title);
        metadata.putString("android.media.metadata.DISPLAY_SUBTITLE", track.artist);
        metadata.putString("android.media.metadata.GENRE", track.title);
        // 探针只试过 TITLE/ARTIST/ALBUM/GENRE/DISPLAY_TITLE/DISPLAY_SUBTITLE，
        // 车机副标题槽实测读 ALBUM。协议标准字段表里还有几个「艺人/描述」类字段，
        // 全部按语义填入歌手（ALBUM 仍保持专辑不动）：若车机优先读其中任一个，
        // 副标题就会显示歌手，且专辑位不受影响；都不读则无任何副作用。
        metadata.putString("android.media.metadata.ALBUM_ARTIST", track.artist);
        metadata.putString("android.media.metadata.AUTHOR", track.artist);
        metadata.putString("android.media.metadata.WRITER", track.artist);
        metadata.putString("android.media.metadata.COMPOSER", track.artist);
        metadata.putString("android.media.metadata.DISPLAY_DESCRIPTION", track.artist);
        // ALBUM 保持 track.toMediaMetadata() 写入的专辑名，不再改写
        if (track.lyric != null) {
          metadata.putString("ucar.media.metadata.LYRICS_WHOLE", track.lyric);
          metadata.putLong("ucar.media.metadata.LYRICS_STATUS", 0L);
        }
        // ICCOA Page 18/19：车机靠这些字段「是否存在」判断显示 VIP / 收藏 / 点赞 / 播放模式按钮
        // （vivo 官方 APK 同样只写字段、不调 addCustomAction）
        metadata.putString("ucar.media.metadata.FAVORITE_STATE", "0");
        metadata.putString("ucar.media.metadata.COLLECT_STATE", "0");
        metadata.putString("ucar.media.metadata.VIP", "0");
        metadata.putString("ucar.media.metadata.PLAY_FUNCTION_BUTTON_ENABLE", "true");
        metadata.putLong("ucar.media.metadata.FAVORITE_NUMBER", 0L);
        metadata.putLong("ucar.media.metadata.PLAY_MODE", 2L);
        android.os.Bundle allowed = new android.os.Bundle();
        allowed.putBoolean("music.media.extras.LYRIC_IS_ALLOWED", true);
        session.setExtras(allowed);
        // ICCOA Page 14：播放队列；QueueItem 的 MediaDescription.setSubtitle 即歌手
        android.support.v4.media.MediaDescriptionCompat.Builder qdesc = new android.support.v4.media.MediaDescriptionCompat.Builder();
        qdesc.setMediaId("0");
        qdesc.setTitle(track.title);
        qdesc.setSubtitle(track.artist);
        if (track.artwork != null) qdesc.setIconUri(track.artwork);
        java.util.List<android.support.v4.media.session.MediaSessionCompat.QueueItem> carQueue = new java.util.ArrayList<>();
        carQueue.add(new android.support.v4.media.session.MediaSessionCompat.QueueItem(qdesc.build(), 0));
        session.setQueue(carQueue);
        session.setQueueTitle("播放队列");
        prevMetadata = metadata;`,
  ],
  // ② updateTitles：只更新歌词，绝不触碰标准标题/歌手/专辑字段
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
        prevMetadata.putLong("ucar.media.metadata.LYRICS_STATUS", 0L);
      }
      if (data.containsKey("title")) {
        // 逐句歌词走 uCar 单句字段（vivo v() 做法），不再写标准标题字段，
        // 否则蓝牙歌词一开，车机标题就会被刷成歌词行
        prevMetadata.putString("ucar.media.metadata.LYRICS_LINE", data.getString("title"));
      }
      // 不写 TITLE / ARTIST / ALBUM：歌名歌手由 UCAR_* / DISPLAY_* 固定，专辑保持原值
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
  // ⑥ MusicService：暴露 session token 给 CarMediaBrowserService
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
  // ⑧ updatePlaybackState：把当前队列项标为活动项
  [
    'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java',
    `        PlaybackStateCompat.Builder pb = new PlaybackStateCompat.Builder();
        pb.setActions(actions);
        pb.setState(playback.getState(), playback.getPosition(), playback.getRate());`,
    `        PlaybackStateCompat.Builder pb = new PlaybackStateCompat.Builder();
        pb.setActions(actions);
        pb.setActiveQueueItemId(0);
        pb.setState(playback.getState(), playback.getPosition(), playback.getRate());`,
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
