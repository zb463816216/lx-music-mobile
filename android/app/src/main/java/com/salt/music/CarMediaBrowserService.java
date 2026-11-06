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
 * ICCOA 智慧车联《媒体应用接入标准 1.0.16》Page 3-15 的车机媒体应用接入。
 *
 * PDF Page 7「浏览界面示例」：车机把 onLoadChildren 返回的媒体项渲染成
 * 「封面 + 标题(歌名) + 副标题(歌手)」的列表；Page 11「播放器界面示例」：
 * 标题/副标题/封面/收藏与播放模式按钮，由 MediaSession 的 Metadata 与状态字段驱动。
 *
 * 本服务不新建 MediaSession，复用 MusicService 现有会话的 token；
 * Callback / PlaybackState / setQueue 由播放服务侧提供。
 */
public class CarMediaBrowserService extends MediaBrowserServiceCompat {

    private static final String ROOT_ID = "SALT_MUSIC_ROOT";
    private static final String FOLDER_PLAYING = "SALT_MUSIC_PLAYING";
    private static final String FOLDER_RECENT = "SALT_MUSIC_RECENT";
    private static final String FOLDER_FAVORITE = "SALT_MUSIC_FAVORITE";
    private static final String ITEM_CURRENT = "SALT_MUSIC_CURRENT";

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
            // 已在 onCreate 设置过
        }
    }

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        // 协议 Page 4/11：始终返回非 null BrowserRoot，并声明支持搜索
        attachSession();
        Bundle extras = new Bundle();
        extras.putBoolean("android.media.browse.SEARCH_SUPPORTED", true);
        return new BrowserRoot(ROOT_ID, extras);
    }

    /** PDF Page 10：MediaDescription 的其他配置（ucar.media.bundle.*）+ Page 6 分页信息。 */
    private Bundle itemExtras() {
        Bundle b = new Bundle();
        b.putString("ucar.media.bundle.VIP", "0");
        b.putString("ucar.media.bundle.IS_PLAYING", "1");
        b.putString("ucar.media.bundle.FAVORITE_STATE", "0");
        b.putString("ucar.media.bundle.COLLECT_STATE", "0");
        b.putString("ucar.media.bundle.IS_RADIO", "0");
        // 本项目队列只有当前曲目，单页返回
        b.putBoolean("ucar.media.bundle.HAS_MORE", false);
        b.putInt("ucar.media.bundle.NEXT_PAGE_INDEX", 0);
        b.putInt("ucar.media.bundle.REMAIN_SIZE", 0);
        return b;
    }

    /** 从播放队列取当前曲目的描述，保证媒体树与播放器页显示同一份数据。 */
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

    /** PDF Page 7/10：可播放项 title=歌名、subtitle=歌手、iconUri=封面。 */
    private MediaBrowserCompat.MediaItem buildCurrentItem() {
        MediaDescriptionCompat desc = currentDescription();
        MediaDescriptionCompat.Builder b = new MediaDescriptionCompat.Builder();
        b.setMediaId(ITEM_CURRENT);
        if (desc != null) {
            b.setTitle(desc.getTitle());
            b.setSubtitle(desc.getSubtitle());
            b.setIconUri(desc.getIconUri());
        } else {
            b.setTitle("当前播放");
        }
        b.setExtras(itemExtras());
        return new MediaBrowserCompat.MediaItem(b.build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE);
    }

    private MediaBrowserCompat.MediaItem folder(String mediaId, String title, String subtitle) {
        MediaDescriptionCompat.Builder b = new MediaDescriptionCompat.Builder();
        b.setMediaId(mediaId);
        b.setTitle(title);
        b.setSubtitle(subtitle);
        b.setExtras(itemExtras());
        return new MediaBrowserCompat.MediaItem(b.build(), MediaBrowserCompat.MediaItem.FLAG_BROWSABLE);
    }

    private List<MediaBrowserCompat.MediaItem> childrenFor(String parentId) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        if (ROOT_ID.equals(parentId)) {
            // 协议 Page 5：根子级项必须是可浏览项
            items.add(folder(FOLDER_PLAYING, "正在播放", "当前播放队列"));
            items.add(folder(FOLDER_RECENT, "最近播放", "最近听过的歌曲"));
            items.add(folder(FOLDER_FAVORITE, "我的收藏", "收藏的歌曲"));
        } else if (FOLDER_PLAYING.equals(parentId)
                || FOLDER_RECENT.equals(parentId)
                || FOLDER_FAVORITE.equals(parentId)) {
            items.add(buildCurrentItem());
        }
        return items;
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowserCompat.MediaItem>> result) {
        result.sendResult(childrenFor(parentId));
    }

    /** 协议 Page 6/7：带 options 的重载，读取分页页码与父项描述。 */
    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowserCompat.MediaItem>> result, Bundle options) {
        if (options != null) {
            options.getInt("ucar.media.bundle.PAGE_INDEX", 0);
            options.getParcelable("ucar.media.bundle.MEDIA_DESCRIPTION");
        }
        result.sendResult(childrenFor(parentId));
    }

    /** 协议 Page 11：搜索结果上下文。 */
    @Override
    public void onSearch(String query, Bundle extras, Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        if (query != null && !query.isEmpty()) items.add(buildCurrentItem());
        result.sendResult(items);
    }
}
