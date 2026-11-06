package com.salt.music;

import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.session.MediaControllerCompat;
import android.support.v4.media.session.MediaSessionCompat;

import androidx.media.MediaBrowserServiceCompat;

import com.guichaguri.trackplayer.service.MusicService;

import java.util.ArrayList;
import java.util.List;

/**
 * ICCOA 智慧车联开放联盟《车机投屏-媒体应用接入标准 1.0.16》Page 3-15 的车机媒体应用接入。
 *
 * 车机通过 android.media.browse.MediaBrowserService 绑定本应用，读取媒体树（onLoadChildren）
 * 与播放队列（MediaSessionCompat.getQueue），据此渲染车机端的浏览页和播放器页。
 * PDF Page 10：MediaDescription 的 setTitle = 标题、setSubtitle = 副标题；
 * vivo 官方 APK 实证：歌曲项与 QueueItem 的 subtitle 都是歌手名。
 *
 * 本服务不新建 MediaSession，而是复用 MusicService 现有会话的 token；
 * Callback / PlaybackState / setQueue 均由播放服务侧提供，这里只负责协议要求的
 * 绑定、媒体树、搜索与页面数据。
 */
public class CarMediaBrowserService extends MediaBrowserServiceCompat {

    private static final String ROOT_ID = "SALT_MUSIC_ROOT";
    private static final String FOLDER_ID = "SALT_MUSIC_PLAYING";
    private static final String CURRENT_ID = "SALT_MUSIC_CURRENT";

    @Override
    public void onCreate() {
        super.onCreate();
        attachSession();
    }

    /** setSessionToken 只能成功调用一次，重复调用会抛 IllegalStateException。 */
    private void attachSession() {
        MediaSessionCompat.Token token = MusicService.carSessionToken;
        if (token == null) return;
        try {
            setSessionToken(token);
        } catch (IllegalStateException ignored) {
            // 已在 onCreate 设置过，忽略
        }
    }

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        // 协议 Page 4：始终返回非 null BrowserRoot；Page 11：开启搜索
        attachSession();
        Bundle extras = new Bundle();
        extras.putBoolean("android.media.browse.SEARCH_SUPPORTED", true);
        return new BrowserRoot(ROOT_ID, extras);
    }

    /** 从播放队列取当前曲目的描述，保证媒体树与播放器页显示的是同一份数据。 */
    private MediaDescriptionCompat currentDescription() {
        MediaSessionCompat.Token token = MusicService.carSessionToken;
        if (token == null) return null;
        try {
            MediaControllerCompat controller = new MediaControllerCompat(this, token);
            List<MediaSessionCompat.QueueItem> queue = controller.getQueue();
            if (queue != null && !queue.isEmpty()) return queue.get(0).getDescription();
        } catch (Exception ignored) {
            // 播放服务尚未启动或跨进程异常
        }
        return null;
    }

    /** PDF Page 10：可播放项带 title / subtitle(歌手) / iconUri。 */
    private MediaBrowserCompat.MediaItem buildCurrentItem() {
        MediaDescriptionCompat desc = currentDescription();
        MediaDescriptionCompat.Builder builder = new MediaDescriptionCompat.Builder();
        builder.setMediaId(CURRENT_ID);
        if (desc != null) {
            builder.setTitle(desc.getTitle());
            builder.setSubtitle(desc.getSubtitle());
            builder.setIconUri(desc.getIconUri());
        } else {
            builder.setTitle("当前播放");
        }
        return new MediaBrowserCompat.MediaItem(builder.build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE);
    }

    private List<MediaBrowserCompat.MediaItem> childrenFor(String parentId) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        if (ROOT_ID.equals(parentId)) {
            // 协议 Page 5：根子级项必须是可浏览项
            items.add(new MediaBrowserCompat.MediaItem(
                new MediaDescriptionCompat.Builder()
                    .setMediaId(FOLDER_ID)
                    .setTitle("正在播放")
                    .build(),
                MediaBrowserCompat.MediaItem.FLAG_BROWSABLE));
        } else if (FOLDER_ID.equals(parentId)) {
            items.add(buildCurrentItem());
        }
        return items;
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowserCompat.MediaItem>> result) {
        result.sendResult(childrenFor(parentId));
    }

    /** 协议 Page 6：带 options 的重载（分页）；本项目队列只有当前曲目，无下一页。 */
    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowserCompat.MediaItem>> result, Bundle options) {
        result.sendResult(childrenFor(parentId));
    }

    /** 协议 Page 11：提供搜索结果上下文。 */
    @Override
    public void onSearch(String query, Bundle extras, Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        if (query != null && !query.isEmpty()) items.add(buildCurrentItem());
        result.sendResult(items);
    }
}
