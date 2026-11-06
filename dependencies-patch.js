// 修补依赖源码以使构建的依赖恢复正常工作

const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.join(__dirname, './')

// ============================ 车机接入：按 ICCOA 1.0.16 补齐播放队列与页面数据 ============================
// 根因（PDF Page 10 / 14 + vivo 官方 APK 反编译实证）：
//   车机播放器页的「副标题」读的是**播放队列项/媒体项的 MediaDescription.setSubtitle()**，
//   不是 MediaSession metadata 的槽位。vivo 的歌曲项与 QueueItem 都是
//   setTitle(歌名) + setSubtitle(歌手)，且车机一绑定 onGetRoot 就立刻 session.setQueue()。
//   本 fork 其实自带 Track.toQueueItem()（subtitle=artist、iconUri=artwork），
//   但**全工程从未调用 session.setQueue()**，是死代码；车机拿不到队列，
//   只能回落到 metadata 的 ALBUM（专辑），于是副标题一直显示专辑。
//
// 本补丁按协议补上：
//   ① 切歌时 session.setQueue()，队列项副标题=歌手（PDF Page 14）
//   ⑧ PlaybackState 标记 activeQueueItemId，让车机把队列项与当前播放关联
//   配合 CarMediaBrowserService 提供真实媒体树 / 搜索 / MediaItem 副标题（PDF Page 4-11）
//
// 元数据部分保持前几轮实车验证有效的结论：
//   DISPLAY_TITLE=歌名 / DISPLAY_SUBTITLE=歌手 / GENRE=歌名 / ALBUM=歌手（通用槽位兜底），
//   歌词只走 ucar.media.metadata.LYRICS_WHOLE（带时间戳 LRC，车机自行滚动），
//   updateArtwork 基于 prevMetadata 增量更新（否则封面异步加载会冲掉全部字段）。
//   updateTitles 绝不写 ALBUM，避免逐句事件把副标题覆盖回专辑。
// ❌ 不再用 A2DP / MediaBrowserService 绑定状态做分流（两者实车都判不准）；
// ❌ 不写 UCAR_TITLE/UCAR_ARTIST（vivo APK 无此字符串）/ LYRICS_LINE / 标准 LYRICS 等未验证字段。
// ======================================================================================================
const patchs = [
  // ① updateMetadata：字段 + 播放队列（关键：车机播放页副标题来自 QueueItem 的 subtitle）
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
        // ICCOA Page 14：下发播放队列；QueueItem 的 subtitle 即歌手，车机播放页据此显示
        android.support.v4.media.MediaDescriptionCompat.Builder qdesc = new android.support.v4.media.MediaDescriptionCompat.Builder();
        qdesc.setMediaId("0");
        qdesc.setTitle(track.title);
        qdesc.setSubtitle(track.artist);
        if (track.artwork != null) qdesc.setIconUri(track.artwork);
        java.util.List<android.support.v4.media.session.MediaSessionCompat.QueueItem> carQueue = new java.util.ArrayList<>();
        carQueue.add(new android.support.v4.media.session.MediaSessionCompat.QueueItem(qdesc.build(), 0));
        session.setQueue(carQueue);
        prevMetadata = metadata;`,
  ],
  // ② updateTitles：整首歌词走 LYRICS_WHOLE；逐句只写 TITLE/ARTIST；绝不碰 ALBUM
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
  // ⑧ updatePlaybackState：把当前队列项标为活动项，车机才能把队列与正在播放关联起来
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
